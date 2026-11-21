// The river subtrees of a training walk on the GPU (REFACTOR_PLAN 4-6, step 2 of docs/16 §4: a measure only).
//
// The same computation as `river::train_subtree` (solver/src/river.rs): regret matching and reaches, folds,
// showdowns, and at each decision its value and the regret and strategy-sum updates of sim-cfr+ / alt-cfr+ /
// alt-dcfr.  One thread block trains one subtree at a time (the blocks stay resident and take every gridDim-th job);
// its threads share the hands of the supports (hand j: thread j % BLOCK).
//
// The subtree is walked depth first, as a list of operations the host made (`TgJob::ops`): DOWN at a decision
// (regret matching, the children's reaches), then its children, then UP (its value and updates); a terminal's value.
// The reach and value vectors live in slots of the block's scratch that the host assigned so that a slot is reused
// once nothing reads it any more: the vectors in use are those of the current path, not of the whole subtree, which
// keeps the scratch of the resident blocks within the L2 cache.
//
// The sums over the opponent's hands (folds, showdowns) are not added in the CPU's order, so the results are close to
// the CPU's, not bit for bit (docs/16 §3); every per-hand step rounds as on the CPU (no FMA contraction: build.rs
// passes --fmad=false).
//
// Layout: see `gpu_bench::gpu` (solver/src/gpu_bench.rs), which builds the arrays.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cuda_runtime.h>

#ifdef TG_ACC_DOUBLE
typedef double acc_t;
#define TG_ACC_NAME "f64"
#else
typedef float acc_t;
#define TG_ACC_NAME "f32"
#endif

#ifndef TG_BLOCK
#define TG_BLOCK 256
#endif
#define BLOCK TG_BLOCK
#ifndef TG_MINB
#define TG_MINB 4
#endif
// nodes of one river subtree, at most; operations (a decision has two)
#define NMAX 64
#define OPMAX 128
#define MAXA 6
#define NWARP (BLOCK / 32)
// tiles of 32 entries of a showdown, at most (C(47, 2) = 1,081 combos avoid a 5 card board)
#define TMAX 34
// an operation: the node's local index, and for a decision whether it is its UP (else its DOWN)
#define OP_UP 0x80

struct TgPlan { uint32_t k[2], cards[2], cross[2], sd, ne, clist, pad; };
// kind 0 decision, 1 fold (`player` = the winner), 2 showdown; rs / vs: the reach / value slots per player
struct TgNode { uint8_t kind, player, na, pad; uint32_t child; float inv[2]; float pot; uint16_t rs[2], vs[2]; uint32_t pad2; uint64_t reg, ss; };
struct TgJob { uint32_t plan, node, n, ops, nops, pad; uint32_t inp[2], out[2]; };

struct TgBatch {
    const TgPlan* plans; uint32_t nplans;
    const uint16_t* pcards; uint32_t npcards;
    const uint32_t* pcross; uint32_t npcross;
    const uint32_t* pclist_off;
    const uint16_t* ent_cards; const uint32_t* ent_u32; uint32_t nent;
    const uint32_t* clist_ent; uint32_t nclist;
    const uint32_t* sclist_off; const uint32_t* sclist; uint32_t nsclist;
    const TgNode* nodes; uint32_t nnodes;
    const uint16_t* children; uint32_t nchildren;
    const uint8_t* ops; uint32_t nops;
    const float* regret; uint64_t nregret;
    const float* ssum; uint64_t nssum;
    const float* input; uint64_t ninput;
    uint64_t noutput;
    const TgJob* jobs[2]; uint32_t njobs[2]; uint32_t nwalks;
    uint32_t max_slots, ks, emax;
};

// what the kernel reads (device pointers)
struct Dev {
    const TgPlan* plans; const uint16_t* pcards; const uint32_t* pcross; const uint32_t* pclist_off;
    const uint16_t* ent_cards; const uint32_t* ent_u32; const uint32_t* clist_ent;
    const uint32_t* sclist_off; const uint32_t* sclist;
    const TgNode* nodes; const uint16_t* children; const uint8_t* ops;
    float* regret; float* ssum; const float* input; float* output; float* scratch;
    uint64_t scr_stride; uint32_t ks, emax;
};

struct Run { const TgJob* jobs; uint32_t njobs; int train_only; float t; int dcfr; float pos, neg, keep; };

struct Ctx {
    Dev d;
    TgJob* jobs[2]; uint32_t njobs[2];
    uint64_t nregret, nssum, noutput;
    int grid, per_sm;
    size_t smem;
    cudaEvent_t e0, e1;
    char info[320];
};

// DOWN at a decision of NA actions: regret matching, the children's reaches (`to[a]`, zero slot at kp)
template <int NA>
__device__ __forceinline__ void down(const float* __restrict__ reg, uint32_t kp, const float* from, float* const* to, uint32_t tid) {
    for (uint32_t j = tid; j <= kp; j += BLOCK) {
        if (j == kp) {
#pragma unroll
            for (int a = 0; a < NA; a++) to[a][kp] = 0.f;
            continue;
        }
        float s[NA];
        float sum = 0.f;
#pragma unroll
        for (int a = 0; a < NA; a++) { s[a] = fmaxf(reg[(uint64_t)a * kp + j], 0.f); sum += s[a]; }
        const float rr = from[j];
        if (sum > 1e-12f) {
#pragma unroll
            for (int a = 0; a < NA; a++) to[a][j] = rr * (s[a] / sum);
        } else {
#pragma unroll
            for (int a = 0; a < NA; a++) to[a][j] = rr * (1.f / (float)NA);
        }
    }
}

// UP at a decision of NA actions, for its actor: the value, the regret and strategy-sum updates
template <int NA>
__device__ __forceinline__ void up_actor(float* __restrict__ reg, float* __restrict__ ss, uint32_t kp, const float* rp, const float* const* cvp, float* v, const Run& r, uint32_t tid) {
    for (uint32_t j = tid; j < kp; j += BLOCK) {
        float s[NA], g[NA];
        float sum = 0.f;
#pragma unroll
        for (int a = 0; a < NA; a++) { g[a] = reg[(uint64_t)a * kp + j]; s[a] = fmaxf(g[a], 0.f); sum += s[a]; }
        if (sum > 1e-12f) {
#pragma unroll
            for (int a = 0; a < NA; a++) s[a] = s[a] / sum;
        } else {
#pragma unroll
            for (int a = 0; a < NA; a++) s[a] = 1.f / (float)NA;
        }
        float cv[NA];
        float x = 0.f;
#pragma unroll
        for (int a = 0; a < NA; a++) { cv[a] = cvp[a][j]; x += s[a] * cv[a]; }
        v[j] = x;
#pragma unroll
        for (int a = 0; a < NA; a++) {
            const float y = cv[a];
            reg[(uint64_t)a * kp + j] = r.dcfr ? g[a] * (g[a] > 0.f ? r.pos : r.neg) + (y - x) : fmaxf(g[a] + y - x, 0.f);
        }
        if (ss) {
            const float rr = rp[j];
#pragma unroll
            for (int a = 0; a < NA; a++) {
                float* q = ss + (uint64_t)a * kp + j;
                *q = r.dcfr ? *q * r.keep + rr * s[a] : *q + r.t * rr * s[a];
            }
        }
    }
}

__device__ __forceinline__ acc_t warp_incl(acc_t x, uint32_t lane) {
#pragma unroll
    for (int off = 1; off < 32; off <<= 1) {
        const acc_t y = __shfl_up_sync(0xffffffffu, x, off);
        if ((int)lane >= off) x += y;
    }
    return x;
}

__device__ __forceinline__ acc_t warp_sum(acc_t x) {
#pragma unroll
    for (int off = 16; off > 0; off >>= 1) x += __shfl_xor_sync(0xffffffffu, x, off);
    return x;
}

#ifdef TG_PROFILE
// cycles of thread 0 of each block per phase: setup, down, fold, showdown, up, output
__device__ unsigned long long tg_prof[6];
#define PROF_START unsigned long long _pt = clock64(); unsigned long long _pc[6] = {0, 0, 0, 0, 0, 0};
#define PROF(i) do { const unsigned long long _n = clock64(); _pc[i] += _n - _pt; _pt = _n; } while (0)
#define PROF_END if (tid == 0) for (int _i = 0; _i < 6; _i++) atomicAdd(&tg_prof[_i], _pc[_i]);
#else
#define PROF_START
#define PROF(i)
#define PROF_END
#endif

__global__ void __launch_bounds__(BLOCK, TG_MINB) train_kernel(Dev d, Run r) {
    // showdowns: rv, T, P, sized to the batch's largest showdown (`Dev::emax`)
    extern __shared__ unsigned char dyn[];
    acc_t* rv = (acc_t*)dyn;
    acc_t* T = rv + d.emax;
    acc_t* P = T + d.emax + 1;
    // folds: the opponent's reach per card, then per warp
    __shared__ acc_t acc[53 + NWARP];
    // showdowns: per tile of 32 entries, its total and then the total before it
    __shared__ acc_t ttot[TMAX];
    __shared__ acc_t toff[TMAX + 1];
    // the subtree: its nodes, their children (local indices), its operations
    __shared__ TgNode sn[NMAX];
    __shared__ uint8_t sch[NMAX][MAXA];
    __shared__ uint8_t sop[OPMAX];
    const uint32_t tid = threadIdx.x, warp = tid / 32, lane = tid % 32;
    const uint32_t ks = d.ks;
    float* scr = d.scratch + (uint64_t)blockIdx.x * d.scr_stride;
#define SLOT(s) (scr + (uint64_t)(s) * ks)
    const bool want[2] = {r.train_only < 0 || r.train_only == 0, r.train_only < 0 || r.train_only == 1};
    PROF_START
    for (uint32_t jb = blockIdx.x; jb < r.njobs; jb += gridDim.x) {
        const TgJob job = r.jobs[jb];
        const TgPlan pl = d.plans[job.plan];
        const uint32_t n = job.n;
        const uint32_t k[2] = {pl.k[0], pl.k[1]};
        for (uint32_t li = tid; li < n; li += BLOCK) {
            const TgNode x = d.nodes[job.node + li];
            sn[li] = x;
            if (x.kind == 0) for (uint32_t a = 0; a < x.na; a++) sch[li][a] = (uint8_t)d.children[x.child + a];
        }
        for (uint32_t i = tid; i < job.nops; i += BLOCK) sop[i] = d.ops[job.ops + i];
        for (int p = 0; p < 2; p++) {
            float* dst = SLOT(p); // the root's reach slots are 0 and 1
            for (uint32_t j = tid; j <= k[p]; j += BLOCK) dst[j] = j < k[p] ? d.input[job.inp[p] + j] : 0.f;
        }
        __syncthreads();
        PROF(0);
        // a DOWN since the last barrier: its reaches are read across hands by the next fold or showdown
        bool fresh = false;
        for (uint32_t oi = 0; oi < job.nops; oi++) {
            const uint32_t op = sop[oi], li = op & 0x7f;
            const TgNode& nn = sn[li];
            if (nn.kind != 0 && fresh) {
                __syncthreads();
                fresh = false;
            }
            if (nn.kind == 0 && !(op & OP_UP)) {
                // DOWN (each thread its own hands: no barrier)
                const uint32_t p = nn.player, na = nn.na, kp = k[p];
                const float* reg = d.regret + nn.reg;
                const float* from = SLOT(nn.rs[p]);
                float* to[MAXA];
#pragma unroll
                for (int a = 0; a < MAXA; a++) to[a] = a < (int)na ? SLOT(sn[sch[li][a]].rs[p]) : nullptr;
                switch (na) {
                    case 2: down<2>(reg, kp, from, to, tid); break;
                    case 3: down<3>(reg, kp, from, to, tid); break;
                    case 4: down<4>(reg, kp, from, to, tid); break;
                    case 5: down<5>(reg, kp, from, to, tid); break;
                    default: down<MAXA>(reg, kp, from, to, tid); break;
                }
                fresh = true;
                PROF(1);
            } else if (nn.kind == 0) {
                // UP (each thread its own hands)
                const uint32_t p = nn.player, o = 1 - p, na = nn.na, kp = k[p], ko = k[o];
                if (want[o]) {
                    float* v = SLOT(nn.vs[o]);
                    for (uint32_t j = tid; j < ko; j += BLOCK) {
                        float x = 0.f;
                        for (uint32_t a = 0; a < na; a++) x += SLOT(sn[sch[li][a]].vs[o])[j];
                        v[j] = x;
                    }
                }
                if (want[p]) {
                    float* reg = d.regret + nn.reg;
                    float* ss = nn.ss != ~0ull ? d.ssum + nn.ss : nullptr;
                    const float* rp = SLOT(nn.rs[p]);
                    float* v = SLOT(nn.vs[p]);
                    const float* cvp[MAXA];
#pragma unroll
                    for (int a = 0; a < MAXA; a++) cvp[a] = a < (int)na ? SLOT(sn[sch[li][a]].vs[p]) : nullptr;
                    switch (na) {
                        case 2: up_actor<2>(reg, ss, kp, rp, cvp, v, r, tid); break;
                        case 3: up_actor<3>(reg, ss, kp, rp, cvp, v, r, tid); break;
                        case 4: up_actor<4>(reg, ss, kp, rp, cvp, v, r, tid); break;
                        case 5: up_actor<5>(reg, ss, kp, rp, cvp, v, r, tid); break;
                        default: up_actor<MAXA>(reg, ss, kp, rp, cvp, v, r, tid); break;
                    }
                }
                PROF(4);
            } else if (nn.kind == 1) {
                // a fold: the opponent's reach per card (a warp per card, over the support's entries with it), then
                // each hand's compatible mass = total - its two cards + the hand itself
                const uint32_t w = nn.player;
                for (uint32_t q = 0; q < 2; q++) {
                    if (!want[q]) continue;
                    const uint32_t o = 1 - q;
                    const float* ro = SLOT(nn.rs[o]);
                    const uint32_t* so = d.sclist_off + ((uint64_t)job.plan * 2 + o) * 53;
                    acc_t wt = 0;
                    for (uint32_t c = warp; c < 52; c += NWARP) {
                        acc_t x = 0;
                        for (uint32_t i = so[c] + lane; i < so[c + 1]; i += 32) x += (acc_t)ro[d.sclist[i]];
                        x = warp_sum(x);
                        if (lane == 0) acc[c] = x;
                        wt += x;
                    }
                    if (lane == 0) acc[53 + warp] = wt;
                    __syncthreads();
                    acc_t total = 0;
#pragma unroll
                    for (int i = 0; i < NWARP; i++) total += acc[53 + i];
                    total *= (acc_t)0.5; // every combo is in two cards' lists
                    const float f = q == w ? nn.pot - nn.inv[w] : -nn.inv[q];
                    const uint16_t* qc = d.pcards + pl.cards[q];
                    const uint32_t* cross = d.pcross + pl.cross[q];
                    float* v = SLOT(nn.vs[q]);
                    for (uint32_t j = tid; j < k[q]; j += BLOCK) {
                        const uint16_t c = qc[j];
                        const float m = (float)(total - acc[c & 0xff] - acc[c >> 8] + (acc_t)ro[cross[j]]);
                        v[j] = m * f;
                    }
                    // `acc` is rewritten, and `ro` (read across hands) may be a slot the next operation writes
                    __syncthreads();
                }
                PROF(2);
            } else {
                // a showdown
                const uint32_t ne = pl.ne, ntiles = (ne + 31) / 32;
                const uint16_t* ec = d.ent_cards + pl.sd;
                const uint32_t* eu = d.ent_u32 + (uint64_t)pl.sd * 8;
                const uint32_t* coff = d.pclist_off + (uint64_t)job.plan * 53;
                const uint32_t* cent = d.clist_ent + pl.clist;
                for (uint32_t p = 0; p < 2; p++) {
                    if (!want[p]) continue;
                    const uint32_t o = 1 - p;
                    const float* ro = SLOT(nn.rs[o]);
                    // A: the opponent's reach per entry, and its prefix within each tile of 32 entries (a warp per tile)
                    for (uint32_t t = warp; t < ntiles; t += NWARP) {
                        const uint32_t e = t * 32 + lane;
                        const acc_t x = e < ne ? (acc_t)ro[eu[e * 8 + o]] : (acc_t)0;
                        const acc_t incl = warp_incl(x, lane);
                        if (e < ne) { rv[e] = x; T[e] = incl - x; }
                        if (lane == 31) ttot[t] = incl;
                    }
                    __syncthreads();
                    // B: the tiles' offsets (the last warp), each card's prefix over its entries (a warp per card)
                    if (warp == NWARP - 1) {
                        acc_t carry = 0;
                        for (uint32_t t0 = 0; t0 < ntiles; t0 += 32) {
                            const uint32_t t = t0 + lane;
                            const acc_t x = t < ntiles ? ttot[t] : (acc_t)0;
                            const acc_t incl = warp_incl(x, lane) + carry;
                            if (t < ntiles) toff[t] = incl - x;
                            carry = __shfl_sync(0xffffffffu, incl, 31);
                        }
                        if (lane == 0) toff[ntiles] = carry;
                    }
                    for (uint32_t c = warp; c < 52; c += NWARP) {
                        const uint32_t a = coff[c], b = coff[c + 1] - 1;
                        acc_t carry = 0;
                        for (uint32_t i0 = a; i0 < b; i0 += 32) {
                            const uint32_t i = i0 + lane;
                            const acc_t x = i < b ? rv[cent[i]] : (acc_t)0;
                            const acc_t incl = warp_incl(x, lane) + carry;
                            if (i < b) P[i] = incl - x;
                            carry = __shfl_sync(0xffffffffu, incl, 31);
                        }
                        if (lane == 0) P[b] = carry;
                    }
                    __syncthreads();
                    // C: the values (TT(g): the opponent's reach on the entries before g)
#define TT(g) ((g) < ne ? T[g] + toff[(g) >> 5] : toff[ntiles])
                    const acc_t total = toff[ntiles];
                    float* v = SLOT(nn.vs[p]);
                    const float pot = nn.pot, inv = nn.inv[p];
                    for (uint32_t e = tid; e < ne; e += BLOCK) {
                        const uint32_t* u = eu + e * 8;
                        const uint32_t ip = u[p];
                        if (ip >= k[p]) continue;
                        const uint16_t c = ec[e];
                        const uint32_t ca = c & 0xff, cb = c >> 8;
                        const acc_t x = rv[e];
                        const acc_t tg = TT(u[2]);
                        const acc_t lower = tg - P[u[4]] - P[u[6]];
                        const acc_t tie = (TT(u[3]) - tg) - (P[u[5]] - P[u[4]]) - (P[u[7]] - P[u[6]]) + x;
                        const float share = (float)(lower + (acc_t)0.5 * tie);
                        const float mass = (float)(total - P[coff[ca + 1] - 1] - P[coff[cb + 1] - 1] + x);
                        v[ip] = pot * share - inv * mass;
                    }
#undef TT
                    // the values were written across hands; rv / T / P are rewritten
                    __syncthreads();
                }
                PROF(3);
            }
        }
        for (int p = 0; p < 2; p++) {
            if (!want[p]) continue;
            const float* v = SLOT(sn[0].vs[p]);
            for (uint32_t j = tid; j < k[p]; j += BLOCK) d.output[job.out[p] + j] = v[j];
        }
        // the next job rewrites the nodes and the slots
        __syncthreads();
        PROF(5);
    }
    PROF_END
#undef SLOT
}

template <typename T>
static cudaError_t up(T** dst, const T* src, uint64_t n) {
    *dst = nullptr;
    cudaError_t e = cudaMalloc((void**)dst, (n ? n : 1) * sizeof(T));
    if (e != cudaSuccess || n == 0) return e;
    return cudaMemcpy(*dst, src, n * sizeof(T), cudaMemcpyHostToDevice);
}

#define TRY(x) do { cudaError_t _e = (x); if (_e != cudaSuccess) { snprintf(err, errlen, "%s: %s", #x, cudaGetErrorString(_e)); return nullptr; } } while (0)

extern "C" void* tg_create(const TgBatch* b, char* err, int errlen) {
    if ((b->emax + 31) / 32 > TMAX) { snprintf(err, errlen, "a showdown of %u entries", b->emax); return nullptr; }
    Ctx* c = new Ctx();
    Dev& d = c->d;
    TRY(up((TgPlan**)&d.plans, b->plans, b->nplans));
    TRY(up((uint16_t**)&d.pcards, b->pcards, b->npcards));
    TRY(up((uint32_t**)&d.pcross, b->pcross, b->npcross));
    TRY(up((uint32_t**)&d.pclist_off, b->pclist_off, (uint64_t)b->nplans * 53));
    TRY(up((uint16_t**)&d.ent_cards, b->ent_cards, b->nent));
    TRY(up((uint32_t**)&d.ent_u32, b->ent_u32, (uint64_t)b->nent * 8));
    TRY(up((uint32_t**)&d.clist_ent, b->clist_ent, b->nclist));
    TRY(up((uint32_t**)&d.sclist_off, b->sclist_off, (uint64_t)b->nplans * 2 * 53));
    TRY(up((uint32_t**)&d.sclist, b->sclist, b->nsclist));
    TRY(up((TgNode**)&d.nodes, b->nodes, b->nnodes));
    TRY(up((uint16_t**)&d.children, b->children, b->nchildren));
    TRY(up((uint8_t**)&d.ops, b->ops, b->nops));
    TRY(up((float**)&d.regret, b->regret, b->nregret));
    TRY(up((float**)&d.ssum, b->ssum, b->nssum));
    TRY(up((float**)&d.input, b->input, b->ninput));
    TRY(cudaMalloc((void**)&d.output, (b->noutput ? b->noutput : 1) * sizeof(float)));
    for (uint32_t w = 0; w < 2; w++) {
        c->njobs[w] = w < b->nwalks ? b->njobs[w] : 0;
        TRY(up(&c->jobs[w], b->jobs[w], c->njobs[w]));
    }
    int dev = 0, sms = 0, per_sm = 0;
    TRY(cudaGetDevice(&dev));
    TRY(cudaDeviceGetAttribute(&sms, cudaDevAttrMultiProcessorCount, dev));
    d.emax = b->emax;
    c->smem = (size_t)(4 * b->emax + 53) * sizeof(acc_t); // rv, T, P
    TRY(cudaOccupancyMaxActiveBlocksPerMultiprocessor(&per_sm, train_kernel, BLOCK, c->smem));
    if (per_sm < 1) per_sm = 1;
    // TG_PER_SM=<n> in the environment: fewer blocks per SM (experiments)
    if (const char* e = getenv("TG_PER_SM")) { const int x = atoi(e); if (x > 0 && x < per_sm) per_sm = x; }
    c->per_sm = per_sm;
    c->grid = sms * per_sm;
    d.ks = b->ks;
    d.scr_stride = (uint64_t)b->max_slots * b->ks;
    TRY(cudaMalloc((void**)&d.scratch, (uint64_t)c->grid * d.scr_stride * sizeof(float)));
    c->nregret = b->nregret; c->nssum = b->nssum; c->noutput = b->noutput;
    TRY(cudaEventCreate(&c->e0));
    TRY(cudaEventCreate(&c->e1));
    cudaDeviceProp prop;
    TRY(cudaGetDeviceProperties(&prop, dev));
    size_t fr = 0, tot = 0;
    cudaMemGetInfo(&fr, &tot);
    snprintf(c->info, sizeof c->info, "%s, %d SMs x %d blocks of %d, sums in %s, %zu B dynamic smem, scratch %.1f MB (L2 %.0f MB), VRAM free %.2f / %.2f GB after upload",
             prop.name, sms, per_sm, BLOCK, TG_ACC_NAME, c->smem, (double)c->grid * d.scr_stride * 4 / 1e6, prop.l2CacheSize / 1e6, fr / 1e9, tot / 1e9);
    return c;
}

extern "C" float tg_run(void* ctx, uint32_t walk, int train_only, float t, int dcfr, float pos, float neg, float keep) {
    Ctx* c = (Ctx*)ctx;
    if (walk > 1 || c->njobs[walk] == 0) return -1.f;
    Run r{c->jobs[walk], c->njobs[walk], train_only, t, dcfr, pos, neg, keep};
#ifdef TG_PROFILE
    unsigned long long z[6] = {0, 0, 0, 0, 0, 0};
    cudaMemcpyToSymbol(tg_prof, z, sizeof z);
#endif
    cudaEventRecord(c->e0);
    train_kernel<<<c->grid, BLOCK, c->smem>>>(c->d, r);
    cudaEventRecord(c->e1);
    if (cudaEventSynchronize(c->e1) != cudaSuccess || cudaGetLastError() != cudaSuccess) return -2.f;
    float ms = 0.f;
    cudaEventElapsedTime(&ms, c->e0, c->e1);
#ifdef TG_PROFILE
    cudaMemcpyFromSymbol(z, tg_prof, sizeof z);
    double all = 0;
    for (int i = 0; i < 6; i++) all += (double)z[i];
    fprintf(stderr, "profile walk %u: setup %.1f%%, down %.1f%%, fold %.1f%%, showdown %.1f%%, up %.1f%%, output %.1f%%\n", walk,
            100 * z[0] / all, 100 * z[1] / all, 100 * z[2] / all, 100 * z[3] / all, 100 * z[4] / all, 100 * z[5] / all);
#endif
    return ms;
}

extern "C" int tg_download(void* ctx, float* regret, float* ssum, float* output) {
    Ctx* c = (Ctx*)ctx;
    if (cudaMemcpy(regret, c->d.regret, c->nregret * sizeof(float), cudaMemcpyDeviceToHost) != cudaSuccess) return 1;
    if (c->nssum && cudaMemcpy(ssum, c->d.ssum, c->nssum * sizeof(float), cudaMemcpyDeviceToHost) != cudaSuccess) return 2;
    if (cudaMemcpy(output, c->d.output, c->noutput * sizeof(float), cudaMemcpyDeviceToHost) != cudaSuccess) return 3;
    return 0;
}

extern "C" int tg_info(void* ctx, char* buf, int len) {
    return snprintf(buf, len, "%s", ((Ctx*)ctx)->info);
}

extern "C" void tg_free(void* ctx) {
    Ctx* c = (Ctx*)ctx;
    if (!c) return;
    Dev& d = c->d;
    const void* ps[] = {d.plans, d.pcards, d.pcross, d.pclist_off, d.ent_cards, d.ent_u32, d.clist_ent, d.sclist_off, d.sclist, d.nodes, d.children, d.ops, d.regret, d.ssum, d.input, d.output, d.scratch, c->jobs[0], c->jobs[1]};
    for (const void* p : ps) if (p) cudaFree((void*)p);
    cudaEventDestroy(c->e0);
    cudaEventDestroy(c->e1);
    delete c;
}
