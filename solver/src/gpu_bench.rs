//! The GPU prototype of REFACTOR_PLAN 4-6, step 2 (`docs/16` §4): the river subtrees of one training walk, trained by
//! themselves from the same state on the CPU (`river::train_subtree`) and, with the Cargo feature `cuda`, on the GPU
//! (`cuda/bench_river.cu`), to compare the time and the regrets.  A measure only (`bench_gpu`): the solver does not
//! use it.
//!
//! The reaches are real: a solver trains a few iterations, then `Solver::capture_river_inputs` records the reaches
//! every river subtree is entered with in one more iteration.  The bench then repeats that iteration's river part
//! (same reaches, same `t` / DCFR discounts) on its own copy of the river regrets and strategy sums.
use crate::postflop::{dcfr_discounts, RiverInput, Solver, Tree, Update, NC};
use crate::river::{self, RiverPlans, SubScratch, SubTrain};
use std::sync::Arc;
use std::time::Instant;

/// One walk's river subtrees: the player it updates (`None`: both) and, per subtree, its root and the two reaches cut
/// to the supports of its board (`k` entries each).
pub struct Walk {
    pub train_only: Option<usize>,
    pub jobs: Vec<(u32, [Vec<f32>; 2])>,
}

pub struct Bench<'a> {
    pub tree: &'a Tree,
    plans: Arc<RiverPlans>,
    has_avg: Vec<bool>,
    subtree_end: Vec<u32>,
    /// the solver's regrets / strategy sums; the nodes outside the river subtrees are emptied
    pub regret: Vec<Vec<f32>>,
    pub ssum: Vec<Vec<f32>>,
    pub walks: Vec<Walk>,
    t: f32,
    dcfr: Option<(f32, f32, f32)>,
    /// the river subtree roots of the walks, ascending
    pub roots: Vec<u32>,
}

/// What a run of the walks returns: per walk and job, the root values of the updated players, cut to the supports.
pub type RootValues = Vec<Vec<[Vec<f32>; 2]>>;

impl<'a> Bench<'a> {
    /// From a solver that has trained (`capture` came from its last `capture_river_inputs`).
    pub fn new(mut s: Solver<'a>, capture: Vec<RiverInput>) -> Bench<'a> {
        let (plans, has_avg, subtree_end) = s.river_parts().map(|(p, h, e)| (p, h.to_vec(), e.to_vec())).expect("a tree with river subtrees");
        let tree = s.tree;
        let t = (s.iters - s.avg_start()) as f32;
        let dcfr = (s.update() == Update::AltDcfr).then(|| dcfr_discounts(s.iters));
        let mut walks: Vec<Walk> = Vec::new();
        for inp in capture {
            let w = match walks.iter().position(|w| w.train_only == inp.train_only) {
                Some(w) => w,
                None => {
                    walks.push(Walk { train_only: inp.train_only, jobs: Vec::new() });
                    walks.len() - 1
                }
            };
            let plan = &plans.plans[plans.plan_of[inp.root as usize] as usize];
            let cut = [0, 1].map(|p| plan.sup[p].iter().map(|&h| inp.reach[p][h as usize]).collect::<Vec<f32>>());
            walks[w].jobs.push((inp.root, cut));
        }
        walks.sort_by_key(|w| w.train_only.map_or(0, |p| p + 1));
        for w in &mut walks {
            w.jobs.sort_by_key(|j| j.0);
        }
        let mut roots: Vec<u32> = walks.iter().flat_map(|w| w.jobs.iter().map(|j| j.0)).collect();
        roots.sort_unstable();
        roots.dedup();
        // keep only the river subtrees' regrets and strategy sums
        let mut regret = std::mem::take(&mut s.regret);
        let mut ssum = std::mem::take(&mut s.ssum);
        let mut keep = vec![false; tree.nodes.len()];
        for &r in &roots {
            keep[r as usize..subtree_end[r as usize] as usize].iter_mut().for_each(|x| *x = true);
        }
        for (i, k) in keep.iter().enumerate() {
            if !k {
                regret[i] = Vec::new();
                ssum[i] = Vec::new();
            }
        }
        drop(s);
        Bench { tree, plans, has_avg, subtree_end, regret, ssum, walks, t, dcfr, roots }
    }

    pub fn subtrees(&self) -> usize {
        self.roots.len()
    }

    /// bytes of the river subtrees' regrets and strategy sums
    pub fn state_bytes(&self) -> usize {
        self.regret.iter().chain(&self.ssum).map(|v| v.len() * 4).sum()
    }

    /// Run every walk once on the CPU with `threads` threads (`river::train_subtree`); seconds per walk and the root
    /// values.
    pub fn cpu_walks(&mut self, threads: usize) -> (Vec<f64>, RootValues) {
        let mut secs = Vec::new();
        let mut values = Vec::new();
        for w in 0..self.walks.len() {
            let t0 = Instant::now();
            let v = self.cpu_walk(w, threads.max(1));
            secs.push(t0.elapsed().as_secs_f64());
            values.push(v);
        }
        (secs, values)
    }

    fn cpu_walk(&mut self, w: usize, threads: usize) -> Vec<[Vec<f32>; 2]> {
        let walk = &self.walks[w];
        let ctx = SubTrain { tree: self.tree, plans: &self.plans, has_avg: &self.has_avg, t: self.t, train_only: walk.train_only, dcfr: self.dcfr };
        // each job's subtree as its own slices (the subtrees are disjoint node ranges, roots ascending)
        type Part<'p> = (usize, usize, usize, &'p mut [Vec<f32>], &'p mut [Vec<f32>]);
        let mut parts: Vec<Part> = Vec::with_capacity(walk.jobs.len());
        let (mut rr, mut rs): (&mut [Vec<f32>], &mut [Vec<f32>]) = (&mut self.regret[..], &mut self.ssum[..]);
        let mut at = 0usize;
        for (ji, (root, _)) in walk.jobs.iter().enumerate() {
            let (root, end) = (*root as usize, self.subtree_end[*root as usize] as usize);
            let (_, r) = std::mem::take(&mut rr).split_at_mut(root - at);
            let (sub_r, r) = r.split_at_mut(end - root);
            rr = r;
            let (_, s) = std::mem::take(&mut rs).split_at_mut(root - at);
            let (sub_s, s) = s.split_at_mut(end - root);
            rs = s;
            at = end;
            parts.push((ji, root, end, sub_r, sub_s));
        }
        let plans = &self.plans;
        let run = |chunk: Vec<Part>| -> Vec<(usize, [Vec<f32>; 2])> {
            let mut sc = SubScratch::default();
            let mut full = [vec![0f32; NC], vec![0f32; NC]];
            let mut r = [vec![0f32; NC], vec![0f32; NC]];
            let mut done = Vec::with_capacity(chunk.len());
            for (ji, root, end, reg, ss) in chunk {
                let plan = &plans.plans[plans.plan_of[root] as usize];
                let cut = &walk.jobs[ji].1;
                for p in 0..2 {
                    r[p].iter_mut().for_each(|x| *x = 0.0);
                    for (j, &h) in plan.sup[p].iter().enumerate() {
                        r[p][h as usize] = cut[p][j];
                    }
                }
                river::train_subtree(&ctx, root, end, root, reg, ss, [&r[0], &r[1]], &mut sc, &mut full, None);
                let vals = [0, 1].map(|p| if walk.train_only.is_none_or(|o| o == p) { plan.sup[p].iter().map(|&h| full[p][h as usize]).collect() } else { Vec::new() });
                done.push((ji, vals));
            }
            done
        };
        let mut out: Vec<Option<[Vec<f32>; 2]>> = (0..walk.jobs.len()).map(|_| None).collect();
        if threads == 1 {
            for (ji, v) in run(parts) {
                out[ji] = Some(v);
            }
        } else {
            // round robin, so that every thread gets subtrees of every turn card
            let mut chunks: Vec<Vec<Part>> = (0..threads).map(|_| Vec::new()).collect();
            for (n, p) in parts.into_iter().enumerate() {
                chunks[n % threads].push(p);
            }
            std::thread::scope(|s| {
                let hs: Vec<_> = chunks.into_iter().map(|c| s.spawn(|| run(c))).collect();
                for h in hs {
                    for (ji, v) in h.join().expect("bench thread") {
                        out[ji] = Some(v);
                    }
                }
            });
        }
        out.into_iter().map(|v| v.expect("every job ran")).collect()
    }
}

/// max |a - b| / max |b| of one vector (`None` if `b` is all 0 or empty): how far apart two results of a node are,
/// relative to the node's largest magnitude.
pub fn node_diff(a: &[f32], b: &[f32]) -> Option<f64> {
    let scale = b.iter().fold(0f64, |m, &v| m.max((v as f64).abs()));
    if scale == 0.0 {
        return None;
    }
    Some(a.iter().zip(b).fold(0f64, |m, (&p, &q)| m.max((p as f64 - q as f64).abs())) / scale)
}

/// The river subtrees on the GPU (`cuda/bench_river.cu`): the layout the kernel reads, and the calls.
#[cfg(feature = "cuda")]
pub mod gpu {
    use super::*;
    use crate::postflop::PKind;
    use std::ffi::c_void;

    /// per board: support sizes and where its arrays start (`TgPlan` of the kernel)
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct TgPlan {
        k: [u32; 2],
        cards: [u32; 2],
        cross: [u32; 2],
        sd: u32,
        ne: u32,
        clist: u32,
        pad: u32,
    }

    /// one node of a river subtree (`TgNode`): kind 0 decision, 1 fold (`player` = the winner), 2 showdown
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct TgNode {
        kind: u8,
        player: u8,
        na: u8,
        pad: u8,
        child: u32,
        inv: [f32; 2],
        pot: f32,
        /// the slots of its reaches and values, per player
        rs: [u16; 2],
        vs: [u16; 2],
        pad2: u32,
        reg: u64,
        ss: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct TgJob {
        plan: u32,
        node: u32,
        n: u32,
        /// its operations (`ops`, depth first)
        ops: u32,
        nops: u32,
        pad: u32,
        inp: [u32; 2],
        out: [u32; 2],
    }

    #[repr(C)]
    struct TgBatch {
        plans: *const TgPlan,
        nplans: u32,
        pcards: *const u16,
        npcards: u32,
        pcross: *const u32,
        npcross: u32,
        pclist_off: *const u32,
        ent_cards: *const u16,
        ent_u32: *const u32,
        nent: u32,
        clist_ent: *const u32,
        nclist: u32,
        sclist_off: *const u32,
        sclist: *const u32,
        nsclist: u32,
        nodes: *const TgNode,
        nnodes: u32,
        children: *const u16,
        nchildren: u32,
        ops: *const u8,
        nops: u32,
        regret: *const f32,
        nregret: u64,
        ssum: *const f32,
        nssum: u64,
        input: *const f32,
        ninput: u64,
        noutput: u64,
        jobs: [*const TgJob; 2],
        njobs: [u32; 2],
        nwalks: u32,
        max_slots: u32,
        ks: u32,
        emax: u32,
    }

    extern "C" {
        fn tg_create(b: *const TgBatch, err: *mut u8, errlen: i32) -> *mut c_void;
        fn tg_run(ctx: *mut c_void, walk: u32, train_only: i32, t: f32, dcfr: i32, pos: f32, neg: f32, keep: f32) -> f32;
        fn tg_download(ctx: *mut c_void, regret: *mut f32, ssum: *mut f32, output: *mut f32) -> i32;
        fn tg_info(ctx: *mut c_void, buf: *mut u8, len: i32) -> i32;
        fn tg_free(ctx: *mut c_void);
    }

    /// The slots of a block's scratch (reach and value vectors): a slot is taken when a vector is made and given back
    /// once nothing reads it any more.
    struct Slots {
        free: Vec<u16>,
        next: u16,
    }

    impl Slots {
        fn get(&mut self) -> u16 {
            self.free.pop().unwrap_or_else(|| {
                self.next += 1;
                self.next - 1
            })
        }
        fn put(&mut self, s: u16) {
            self.free.push(s);
        }
    }

    /// The operations of the subtree of local node `li` (`root` + `li` in the tree) depth first, entered with the reach
    /// slots `rs`; sets the slots of its nodes.  A decision: DOWN (takes a slot per child for the actor's reach), its
    /// children, UP (takes its value slots; gives back the children's reach and value slots).  A terminal: takes its
    /// value slots.  A slot is given back only after the operations that read it across hands (folds, showdowns), which
    /// end with a barrier in the kernel; the other operations read and write only their own hands.
    fn visit(tree: &Tree, root: usize, li: usize, rs: [u16; 2], nodes: &mut [TgNode], al: &mut Slots, ops: &mut Vec<u8>) {
        nodes[li].rs = rs;
        match &tree.nodes[root + li].kind {
            PKind::Decision { player, children, .. } => {
                let p = *player as usize;
                let kids: Vec<usize> = children.iter().map(|&c| c as usize - root).collect();
                let mine: Vec<u16> = kids.iter().map(|_| al.get()).collect();
                ops.push(li as u8);
                for (&c, &s) in kids.iter().zip(&mine) {
                    let mut r = rs;
                    r[p] = s;
                    visit(tree, root, c, r, nodes, al, ops);
                }
                for s in mine {
                    al.put(s);
                }
                nodes[li].vs = [al.get(), al.get()];
                ops.push(li as u8 | 0x80);
                for &c in &kids {
                    al.put(nodes[c].vs[0]);
                    al.put(nodes[c].vs[1]);
                }
            }
            _ => {
                nodes[li].vs = [al.get(), al.get()];
                ops.push(li as u8);
            }
        }
    }

    /// The river subtrees of a `Bench`, uploaded: the regrets and strategy sums stay on the GPU between walks.
    pub struct Gpu {
        ctx: *mut c_void,
        /// per root (as `Bench::roots`): where its nodes' regrets / strategy sums are in the flat arrays
        reg_at: Vec<Vec<(u32, u64, u64)>>,
        nregret: usize,
        nssum: usize,
        /// per walk and job: where its root values are in the output, and the support sizes
        out_at: Vec<Vec<([u32; 2], [usize; 2])>>,
        noutput: usize,
        pub upload_secs: f64,
        pub info: String,
    }

    impl Drop for Gpu {
        fn drop(&mut self) {
            // SAFETY: `ctx` came from `tg_create` and is freed once
            unsafe { tg_free(self.ctx) }
        }
    }

    impl Gpu {
        pub fn new(b: &Bench) -> Result<Gpu, String> {
            let t0 = Instant::now();
            let tree = b.tree;
            let plans = &b.plans;
            // boards: every plan the roots use
            let mut plan_id = vec![u32::MAX; plans.plans.len()];
            let (mut tp, mut pcards, mut pcross, mut pclist_off, mut ent_cards, mut ent_u32, mut clist_ent) = (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
            let mut kmax = 0usize;
            let (mut sclist_off, mut sclist): (Vec<u32>, Vec<u32>) = (Vec::new(), Vec::new());
            for &r in &b.roots {
                let pi = plans.plan_of[r as usize] as usize;
                if plan_id[pi] != u32::MAX {
                    continue;
                }
                plan_id[pi] = tp.len() as u32;
                let pl = &plans.plans[pi];
                kmax = kmax.max(pl.k[0]).max(pl.k[1]);
                let mut g = TgPlan { k: [pl.k[0] as u32, pl.k[1] as u32], ..Default::default() };
                for p in 0..2 {
                    // per card, the support entries with it (for the folds)
                    let mut lists: Vec<Vec<u32>> = vec![Vec::new(); 52];
                    for (j, &(a, c)) in pl.cards[p].iter().enumerate() {
                        lists[a as usize].push(j as u32);
                        lists[c as usize].push(j as u32);
                    }
                    for l in &lists {
                        sclist_off.push(sclist.len() as u32);
                        sclist.extend_from_slice(l);
                    }
                    sclist_off.push(sclist.len() as u32);
                    g.cards[p] = pcards.len() as u32;
                    pcards.extend(pl.cards[p].iter().map(|&(a, c)| a as u16 | (c as u16) << 8));
                    g.cross[p] = pcross.len() as u32;
                    pcross.extend_from_slice(&pl.cross[p]);
                }
                g.sd = ent_cards.len() as u32;
                g.clist = clist_ent.len() as u32;
                if let Some(sd) = &pl.showdown {
                    let ne = sd.cards.len();
                    g.ne = ne as u32;
                    // group of each entry
                    let mut gs = vec![0u32; ne];
                    let mut ge = vec![0u32; ne];
                    for w in sd.starts.windows(2) {
                        for e in w[0]..w[1] {
                            gs[e as usize] = w[0];
                            ge[e as usize] = w[1];
                        }
                    }
                    // per card, the entries with it (ascending), laid out with one more slot for the total
                    let mut lists: Vec<Vec<u32>> = vec![Vec::new(); 52];
                    for (e, &(a, c)) in sd.cards.iter().enumerate() {
                        lists[a as usize].push(e as u32);
                        lists[c as usize].push(e as u32);
                    }
                    let mut off = [0u32; 53];
                    for c in 0..52 {
                        off[c + 1] = off[c] + lists[c].len() as u32 + 1;
                    }
                    pclist_off.extend_from_slice(&off);
                    for l in &lists {
                        clist_ent.extend_from_slice(l);
                        clist_ent.push(u32::MAX);
                    }
                    // per entry and card: the list positions of the first entry of its group and the first after it
                    let pos = |c: usize, bound: u32| -> u32 { off[c] + lists[c].partition_point(|&x| x < bound) as u32 };
                    for (e, &(a, c)) in sd.cards.iter().enumerate() {
                        ent_cards.push(a as u16 | (c as u16) << 8);
                        let (a, c) = (a as usize, c as usize);
                        ent_u32.extend_from_slice(&[sd.idx[0][e], sd.idx[1][e], gs[e], ge[e], pos(a, gs[e]), pos(a, ge[e]), pos(c, gs[e]), pos(c, ge[e])]);
                    }
                } else {
                    pclist_off.extend_from_slice(&[0u32; 53]);
                }
                tp.push(g);
            }
            // nodes, regrets, strategy sums, per root
            let (mut nodes, mut children, mut regret, mut ssum): (Vec<TgNode>, Vec<u16>, Vec<f32>, Vec<f32>) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
            let mut node_at = Vec::with_capacity(b.roots.len());
            let mut reg_at = Vec::with_capacity(b.roots.len());
            let (mut ops, mut ops_at): (Vec<u8>, Vec<(u32, u32)>) = (Vec::new(), Vec::with_capacity(b.roots.len()));
            let mut max_slots = 0usize;
            for &r in &b.roots {
                let (root, end) = (r as usize, b.subtree_end[r as usize] as usize);
                let n = end - root;
                if n > 64 {
                    return Err(format!("a river subtree of {} nodes (NMAX of the kernel: 64)", n));
                }
                node_at.push(nodes.len() as u32);
                let base = nodes.len();
                nodes.resize(base + n, TgNode::default());
                let mut at = Vec::new();
                for li in 0..n {
                    let i = root + li;
                    let node = &tree.nodes[i];
                    let mut g = nodes[base + li];
                    g.inv = node.inv;
                    g.pot = tree.cfg.pot_paid(node.inv);
                    g.reg = u64::MAX;
                    g.ss = u64::MAX;
                    match &node.kind {
                        PKind::Decision { player, children: ch, .. } => {
                            if !(2..=6).contains(&ch.len()) {
                                return Err("a decision with fewer than 2 or more than 6 actions (MAXA of the kernel)".into());
                            }
                            g.kind = 0;
                            g.player = *player;
                            g.na = ch.len() as u8;
                            g.child = children.len() as u32;
                            children.extend(ch.iter().map(|&c| (c as usize - root) as u16));
                            g.reg = regret.len() as u64;
                            regret.extend_from_slice(&b.regret[i]);
                            if b.has_avg[i] && !b.ssum[i].is_empty() {
                                g.ss = ssum.len() as u64;
                                ssum.extend_from_slice(&b.ssum[i]);
                            }
                            at.push((i as u32, g.reg, g.ss));
                        }
                        PKind::Fold { winner } => {
                            g.kind = 1;
                            g.player = *winner;
                        }
                        PKind::Showdown { .. } => g.kind = 2,
                        _ => return Err("a river subtree with a chance node".into()),
                    }
                    nodes[base + li] = g;
                }
                // the operations depth first, and the slots
                ops_at.push((ops.len() as u32, 0u32));
                let mut al = Slots { free: Vec::new(), next: 0 };
                let root_rs = [al.get(), al.get()];
                visit(tree, root, 0, root_rs, &mut nodes[base..base + n], &mut al, &mut ops);
                ops_at.last_mut().expect("this root").1 = ops.len() as u32 - ops_at.last().expect("this root").0;
                if ops_at.last().expect("this root").1 as usize > 128 {
                    return Err("a river subtree of more than 128 operations (OPMAX of the kernel)".into());
                }
                max_slots = max_slots.max(al.next as usize);
                reg_at.push(at);
            }
            // jobs and their reaches, per walk
            let (mut input, mut out_at, mut jobs) = (Vec::new(), Vec::new(), Vec::new());
            let mut noutput = 0usize;
            for w in &b.walks {
                let (mut js, mut oa) = (Vec::new(), Vec::new());
                for (root, cut) in &w.jobs {
                    let ri = b.roots.binary_search(root).expect("a root");
                    let pl = &plans.plans[plans.plan_of[*root as usize] as usize];
                    let mut j = TgJob { plan: plan_id[plans.plan_of[*root as usize] as usize], node: node_at[ri], n: b.subtree_end[*root as usize] - root, ops: ops_at[ri].0, nops: ops_at[ri].1, ..Default::default() };
                    for p in 0..2 {
                        j.inp[p] = input.len() as u32;
                        input.extend_from_slice(&cut[p]);
                        j.out[p] = noutput as u32;
                        noutput += pl.k[p];
                    }
                    oa.push((j.out, pl.k));
                    js.push(j);
                }
                jobs.push(js);
                out_at.push(oa);
            }
            if jobs.len() > 2 {
                return Err("more than two walks".into());
            }
            let ks = (kmax + 1).div_ceil(32) * 32;
            let batch = TgBatch {
                plans: tp.as_ptr(),
                nplans: tp.len() as u32,
                pcards: pcards.as_ptr(),
                npcards: pcards.len() as u32,
                pcross: pcross.as_ptr(),
                npcross: pcross.len() as u32,
                pclist_off: pclist_off.as_ptr(),
                ent_cards: ent_cards.as_ptr(),
                ent_u32: ent_u32.as_ptr(),
                nent: ent_cards.len() as u32,
                clist_ent: clist_ent.as_ptr(),
                nclist: clist_ent.len() as u32,
                sclist_off: sclist_off.as_ptr(),
                sclist: sclist.as_ptr(),
                nsclist: sclist.len() as u32,
                nodes: nodes.as_ptr(),
                nnodes: nodes.len() as u32,
                children: children.as_ptr(),
                nchildren: children.len() as u32,
                ops: ops.as_ptr(),
                nops: ops.len() as u32,
                regret: regret.as_ptr(),
                nregret: regret.len() as u64,
                ssum: ssum.as_ptr(),
                nssum: ssum.len() as u64,
                input: input.as_ptr(),
                ninput: input.len() as u64,
                noutput: noutput as u64,
                jobs: [jobs[0].as_ptr(), jobs.get(1).map_or(std::ptr::null(), |j| j.as_ptr())],
                njobs: [jobs[0].len() as u32, jobs.get(1).map_or(0, |j| j.len() as u32)],
                nwalks: jobs.len() as u32,
                max_slots: max_slots as u32,
                ks: ks as u32,
                emax: tp.iter().map(|p| p.ne).max().unwrap_or(0) + 1,
            };
            let mut err = vec![0u8; 512];
            // SAFETY: every pointer of `batch` points into a live Vec of the stated length; `tg_create` copies them to
            // the GPU before it returns and keeps none
            let ctx = unsafe { tg_create(&batch, err.as_mut_ptr(), err.len() as i32) };
            if ctx.is_null() {
                let n = err.iter().position(|&c| c == 0).unwrap_or(err.len());
                return Err(String::from_utf8_lossy(&err[..n]).into_owned());
            }
            let mut info = vec![0u8; 512];
            // SAFETY: `ctx` is live; `info` has the stated length
            let n = unsafe { tg_info(ctx, info.as_mut_ptr(), info.len() as i32) }.max(0) as usize;
            let info = format!("{}; {} subtrees, {} nodes, {} slots x {} per block, {} entries", String::from_utf8_lossy(&info[..n]), b.roots.len(), nodes.len(), max_slots, ks, ent_cards.len());
            Ok(Gpu { ctx, reg_at, nregret: regret.len(), nssum: ssum.len(), out_at, noutput, upload_secs: t0.elapsed().as_secs_f64(), info })
        }

        /// Run walk `w` of the bench once: milliseconds of the kernel.
        pub fn walk(&mut self, b: &Bench, w: usize) -> Result<f64, String> {
            let walk = &b.walks[w];
            let (pos, neg, keep) = b.dcfr.unwrap_or((1.0, 1.0, 1.0));
            // SAFETY: `ctx` is live
            let ms = unsafe { tg_run(self.ctx, w as u32, walk.train_only.map_or(-1, |p| p as i32), b.t, b.dcfr.is_some() as i32, pos, neg, keep) };
            if ms < 0.0 {
                return Err(format!("tg_run failed ({})", ms));
            }
            Ok(ms as f64)
        }

        /// How far the GPU's regrets, strategy sums and root values (of the last run of each walk) are from the bench's
        /// (the CPU's), as `node_diff`: (the largest, vectors compared) for each.
        pub fn compare(&mut self, b: &Bench, values: &RootValues) -> Result<[(f64, usize); 3], String> {
            let mut reg = vec![0f32; self.nregret];
            let mut ss = vec![0f32; self.nssum];
            let mut out = vec![0f32; self.noutput];
            // SAFETY: the buffers have the lengths the context was made with
            let rc = unsafe { tg_download(self.ctx, reg.as_mut_ptr(), ss.as_mut_ptr(), out.as_mut_ptr()) };
            if rc != 0 {
                return Err(format!("tg_download failed ({})", rc));
            }
            let mut d = [(0f64, 0usize); 3];
            let mut add = |k: usize, x: &[f32], y: &[f32]| {
                if let Some(v) = node_diff(x, y) {
                    d[k].0 = d[k].0.max(v);
                    d[k].1 += 1;
                }
            };
            for at in &self.reg_at {
                for &(i, r, s) in at {
                    let i = i as usize;
                    add(0, &reg[r as usize..r as usize + b.regret[i].len()], &b.regret[i]);
                    if s != u64::MAX {
                        add(1, &ss[s as usize..s as usize + b.ssum[i].len()], &b.ssum[i]);
                    }
                }
            }
            for (oa, vw) in self.out_at.iter().zip(values) {
                for ((o, k), vj) in oa.iter().zip(vw) {
                    for p in 0..2 {
                        if !vj[p].is_empty() {
                            add(2, &out[o[p] as usize..o[p] as usize + k[p]], &vj[p]);
                        }
                    }
                }
            }
            Ok(d)
        }
    }
}
