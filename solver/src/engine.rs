//! Generic n-player *vector-form* CFR+ engine.
//!
//! Every player holds one of `k` abstract hands ("classes").  A node's reach is
//! kept as a vector `r_q[h]` per player (probability that q takes the path's
//! actions with hand h).  Because hands of different players block each other
//! (card removal), the probability that player q "gets here" given that hero
//! holds `a` is `m_q[a] = sum_b P_q[a][b] * r_q[b]`, where `P_q[a][b]` is the
//! probability that q holds b given hero holds a (rows are normalised).
//!
//! Terminal payoffs (net chips for the hand):
//!   * Fold   – last player standing wins `pot - inv`, every other loses `inv`.
//!   * Showdown(x, y) – two contestants; the other players folded earlier.
//!       u_x(a,b) = pot * s(a,b) - inv_x,   u_y(b,a) = pot * (1 - s(a,b)) - inv_y
//!     where s is the pot share (raw equity for all-in, a realisation model otherwise).
//!     The two "class" matrices hold `P * s` for each side so a showdown is two mat-vecs.
//!
//! Multi-player CFR has no Nash guarantee, but is zero-sum overall and behaves
//! well in practice (see docs/07-preflop-model.md).  For two players this is
//! plain CFR+ with linear averaging.

pub const MAXP: usize = 6;

pub struct Class {
    /// rows = x hands, cols = y hands: P_y[a][b] * s_x(a,b)
    pub a: Vec<f32>,
    /// rows = y hands, cols = x hands: P_x[b][a] * s_y(b,a)
    pub b: Vec<f32>,
}

pub enum Kind {
    Decision { player: usize, children: Vec<usize> },
    Fold { winner: usize },
    Showdown { x: usize, y: usize, class: usize },
    /// Three players see the flop.  `p` is ordered out-of-position first (earliest
    /// post-flop actor) to in-position last.  Each player's share of the pot is the
    /// average of the three heads-up shares:  S_i = (s_ij + s_ik) / 3  (zero-sum).
    Showdown3 { p: [usize; 3], class: usize },
}

pub struct Node {
    pub kind: Kind,
    /// chips each player has invested when the node is reached
    pub inv: [f32; MAXP],
    /// the player whose bet / raise is being answered (display only)
    pub aggressor: Option<usize>,
}

impl Node {
    pub fn pot(&self) -> f32 {
        self.inv.iter().sum()
    }
}

pub struct Game {
    pub n_players: usize,
    pub k: usize,
    /// per player q: row-normalised `P_q[a][b]` (k*k)
    pub pm: Vec<Vec<f32>>,
    /// per player: prior over hands (sums to 1)
    pub prior: Vec<Vec<f32>>,
    pub classes: Vec<Class>,
    pub nodes: Vec<Node>,
    /// raw all-in equity table (k*k) for display statistics
    pub raw_eq: Option<Vec<f32>>,
}

/// Build the row-normalised blocker matrix `P[a][b] ∝ compat[a][b] * prior[b]`.
pub fn build_pm(k: usize, compat: &[f32], prior: &[f32]) -> Vec<f32> {
    let mut pm = vec![0f32; k * k];
    for a in 0..k {
        let mut s = 0f64;
        for b in 0..k {
            s += (compat[a * k + b] * prior[b]) as f64;
        }
        if s > 0.0 {
            for b in 0..k {
                pm[a * k + b] = (compat[a * k + b] as f64 * prior[b] as f64 / s) as f32;
            }
        }
    }
    pm
}

#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0f32; 8];
    let ca = a.chunks_exact(8);
    let cb = b.chunks_exact(8);
    let (ra, rb) = (ca.remainder(), cb.remainder());
    for (x, y) in ca.zip(cb) {
        for i in 0..8 {
            acc[i] += x[i] * y[i];
        }
    }
    let mut s: f32 = acc.iter().sum();
    for (x, y) in ra.iter().zip(rb) {
        s += x * y;
    }
    s
}

#[inline]
pub fn matvec(mat: &[f32], x: &[f32], k: usize, out: &mut [f32]) {
    for a in 0..k {
        out[a] = dot(&mat[a * k..(a + 1) * k], x);
    }
}

pub fn regret_match(regret: &[f32], na: usize, k: usize, sigma: &mut [f32]) {
    for h in 0..k {
        let mut s = 0f32;
        for a in 0..na {
            s += regret[a * k + h].max(0.0);
        }
        if s > 1e-12 {
            for a in 0..na {
                sigma[a * k + h] = regret[a * k + h].max(0.0) / s;
            }
        } else {
            for a in 0..na {
                sigma[a * k + h] = 1.0 / na as f32;
            }
        }
    }
}

#[derive(Clone, Copy)]
enum Mode {
    Train(f32),
    Eval,
    Br(usize),
}

struct State {
    r: Vec<f32>,
    m: Vec<f32>,
}

/// Per decision node report produced by `Solver::evaluate`.
#[derive(Clone, Default)]
pub struct NodeEval {
    pub player: usize,
    /// own reach r_p(h)
    pub weight: Vec<f32>,
    /// average strategy, na*k
    pub freq: Vec<f32>,
    /// conditional EV (net chips) of each action, na*k
    pub ev: Vec<f32>,
    /// raw equity vs the aggressor's range (random hand if none), k
    pub eq: Vec<f32>,
    /// probability that the action sequence leading here happens (all players' ranges)
    pub reach: f32,
}

pub struct Solver<'g> {
    g: &'g Game,
    pub regret: Vec<Vec<f32>>,
    pub ssum: Vec<Vec<f32>>,
    pub avg: Vec<Vec<f32>>,
    pub iters: u32,
    /// Training-time "logit tremble": with total probability `explore` every action is
    /// additionally played proportionally to exp(lambda * EV).  This keeps off-path
    /// subtrees trained against a *sensible* (EV-structured) deviating range, which
    /// avoids degenerate equilibria such as "nobody ever flat-calls because the untrained
    /// squeeze response is punishing".  Switch it off for the final averaging phase.
    pub explore: f32,
    pub lambda: f32,
    qlast: Vec<Vec<f32>>,
}

impl<'g> Solver<'g> {
    pub fn new(g: &'g Game) -> Self {
        let mut regret = Vec::with_capacity(g.nodes.len());
        let mut ssum = Vec::with_capacity(g.nodes.len());
        let mut qlast = Vec::with_capacity(g.nodes.len());
        for n in &g.nodes {
            if let Kind::Decision { children, .. } = &n.kind {
                regret.push(vec![0f32; children.len() * g.k]);
                ssum.push(vec![0f32; children.len() * g.k]);
                qlast.push(vec![0f32; children.len() * g.k]);
            } else {
                regret.push(Vec::new());
                ssum.push(Vec::new());
                qlast.push(Vec::new());
            }
        }
        Solver { g, regret, ssum, avg: Vec::new(), iters: 0, explore: 0.0, lambda: 4.0, qlast }
    }

    /// Forget the strategy sums (keeps regrets) so the next phase averages from scratch.
    pub fn reset_average(&mut self) {
        for v in self.ssum.iter_mut() {
            for x in v.iter_mut() {
                *x = 0.0;
            }
        }
        self.iters = 0;
    }

    fn fresh_state(&self) -> State {
        let (n, k) = (self.g.n_players, self.g.k);
        let r = vec![1f32; n * k];
        let mut m = vec![0f32; n * k];
        for q in 0..n {
            matvec(&self.g.pm[q], &r[q * k..(q + 1) * k], k, &mut m[q * k..(q + 1) * k]);
        }
        State { r, m }
    }

    pub fn iterate(&mut self) {
        self.iters += 1;
        let t = self.iters as f32;
        let mut st = self.fresh_state();
        let mut out = vec![0f32; self.g.n_players * self.g.k];
        let mut none: Vec<Option<NodeEval>> = Vec::new();
        self.walk(0, &mut st, &mut out, Mode::Train(t), &mut none);
    }

    /// Freeze the average strategy (falls back to the current regret-matching
    /// strategy for hands that never reach a node).
    pub fn finalize_avg(&mut self) {
        let k = self.g.k;
        self.avg = Vec::with_capacity(self.g.nodes.len());
        for (i, n) in self.g.nodes.iter().enumerate() {
            if let Kind::Decision { children, .. } = &n.kind {
                let na = children.len();
                let mut fb = vec![0f32; na * k];
                regret_match(&self.regret[i], na, k, &mut fb);
                let mut sg = vec![0f32; na * k];
                for h in 0..k {
                    let mut s = 0f32;
                    for a in 0..na {
                        s += self.ssum[i][a * k + h];
                    }
                    for a in 0..na {
                        sg[a * k + h] = if s > 1e-20 { self.ssum[i][a * k + h] / s } else { fb[a * k + h] };
                    }
                }
                self.avg.push(sg);
            } else {
                self.avg.push(Vec::new());
            }
        }
    }

    /// EV of each player at the root under the average strategy (needs `finalize_avg`).
    pub fn root_values(&mut self) -> Vec<f32> {
        let (n, k) = (self.g.n_players, self.g.k);
        let mut st = self.fresh_state();
        let mut out = vec![0f32; n * k];
        let mut none = Vec::new();
        self.walk(0, &mut st, &mut out, Mode::Eval, &mut none);
        (0..n).map(|p| dot(&self.g.prior[p], &out[p * k..(p + 1) * k])).collect()
    }

    /// Best-response gain per player against everybody else's average strategy,
    /// in chips (needs `finalize_avg`).  For 2-player zero-sum games the sum of
    /// the gains is the exploitability.
    pub fn br_gaps(&mut self) -> Vec<f32> {
        let (n, k) = (self.g.n_players, self.g.k);
        let vals = self.root_values();
        let mut gaps = Vec::new();
        for p in 0..n {
            let mut st = self.fresh_state();
            let mut out = vec![0f32; n * k];
            let mut none = Vec::new();
            self.walk(0, &mut st, &mut out, Mode::Br(p), &mut none);
            let br = dot(&self.g.prior[p], &out[p * k..(p + 1) * k]);
            gaps.push((br - vals[p]).max(0.0));
        }
        gaps
    }

    /// Full per-node report under the average strategy (needs `finalize_avg`).
    pub fn evaluate(&mut self) -> Vec<Option<NodeEval>> {
        let (n, k) = (self.g.n_players, self.g.k);
        let mut st = self.fresh_state();
        let mut out = vec![0f32; n * k];
        let mut ev: Vec<Option<NodeEval>> = vec![None; self.g.nodes.len()];
        self.walk(0, &mut st, &mut out, Mode::Eval, &mut ev);
        ev
    }

    fn terminal(&self, ni: usize, st: &State, out: &mut [f32]) {
        let g = self.g;
        let (n, k) = (g.n_players, g.k);
        let node = &g.nodes[ni];
        let pot = node.pot();
        // out[q][h] = -inv_q * prod_{q' != q} m_q'[h]  (the "everybody else" payoff)
        let mut prod_except = [0f32; MAXP];
        for h in 0..k {
            for q in 0..n {
                let mut p = 1f32;
                for q2 in 0..n {
                    if q2 != q {
                        p *= st.m[q2 * k + h];
                    }
                }
                prod_except[q] = p;
            }
            for q in 0..n {
                out[q * k + h] = -node.inv[q] * prod_except[q];
            }
        }
        match &node.kind {
            Kind::Fold { winner } => {
                let w = *winner;
                for h in 0..k {
                    let mut p = 1f32;
                    for q2 in 0..n {
                        if q2 != w {
                            p *= st.m[q2 * k + h];
                        }
                    }
                    out[w * k + h] = (pot - node.inv[w]) * p;
                }
            }
            Kind::Showdown { x, y, class } => {
                let (x, y) = (*x, *y);
                let cl = &g.classes[*class];
                let mut tmp = vec![0f32; k];
                // folded-player factor F(h) = prod_{q not in {x,y}} m_q[h]
                let mut f = vec![1f32; k];
                for q in 0..n {
                    if q != x && q != y {
                        for h in 0..k {
                            f[h] *= st.m[q * k + h];
                        }
                    }
                }
                matvec(&cl.a, &st.r[y * k..(y + 1) * k], k, &mut tmp);
                for h in 0..k {
                    out[x * k + h] = f[h] * (pot * tmp[h] - node.inv[x] * st.m[y * k + h]);
                }
                matvec(&cl.b, &st.r[x * k..(x + 1) * k], k, &mut tmp);
                for h in 0..k {
                    out[y * k + h] = f[h] * (pot * tmp[h] - node.inv[y] * st.m[x * k + h]);
                }
            }
            Kind::Showdown3 { p: trio, class } => {
                let cl = &g.classes[*class];
                let mut f = vec![1f32; k];
                for q in 0..n {
                    if !trio.contains(&q) {
                        for h in 0..k {
                            f[h] *= st.m[q * k + h];
                        }
                    }
                }
                // s[i][h] accumulates sum_j (Mat_ij r_j)(h) * m_third(h), for trio slot i
                let mut sacc = [vec![0f32; k], vec![0f32; k], vec![0f32; k]];
                let mut tmp = vec![0f32; k];
                for &(oi, ii) in &[(0usize, 1usize), (0, 2), (1, 2)] {
                    let (oop, ip) = (trio[oi], trio[ii]);
                    let third = trio[3 - oi - ii];
                    // IP hand vs OOP range
                    matvec(&cl.a, &st.r[oop * k..(oop + 1) * k], k, &mut tmp);
                    for h in 0..k {
                        sacc[ii][h] += tmp[h] * st.m[third * k + h];
                    }
                    // OOP hand vs IP range
                    matvec(&cl.b, &st.r[ip * k..(ip + 1) * k], k, &mut tmp);
                    for h in 0..k {
                        sacc[oi][h] += tmp[h] * st.m[third * k + h];
                    }
                }
                for slot in 0..3 {
                    let i = trio[slot];
                    let (j, l) = (trio[(slot + 1) % 3], trio[(slot + 2) % 3]);
                    for h in 0..k {
                        out[i * k + h] = f[h] * (pot / 3.0 * sacc[slot][h] - node.inv[i] * st.m[j * k + h] * st.m[l * k + h]);
                    }
                }
            }
            Kind::Decision { .. } => unreachable!(),
        }
    }

    fn walk(&mut self, ni: usize, st: &mut State, out: &mut [f32], mode: Mode, ev: &mut Vec<Option<NodeEval>>) {
        let g: &'g Game = self.g;
        let (n, k) = (g.n_players, g.k);
        let node = &g.nodes[ni];
        let (p, children) = match &node.kind {
            Kind::Decision { player, children } => (*player, children),
            _ => {
                self.terminal(ni, st, out);
                return;
            }
        };
        let na = children.len();
        let mut sigma = vec![0f32; na * k];
        match mode {
            Mode::Train(_) => {
                regret_match(&self.regret[ni], na, k, &mut sigma);
                if self.explore > 0.0 && na <= 8 {
                    let (eps, lam) = (self.explore, self.lambda);
                    for h in 0..k {
                        let mut mx = f32::MIN;
                        for a in 0..na {
                            mx = mx.max(self.qlast[ni][a * k + h]);
                        }
                        let mut ex = [0f32; 8];
                        let mut tot = 0f32;
                        for a in 0..na {
                            ex[a] = ((self.qlast[ni][a * k + h] - mx) * lam).exp();
                            tot += ex[a];
                        }
                        for a in 0..na {
                            sigma[a * k + h] = (1.0 - eps) * sigma[a * k + h] + eps * ex[a] / tot;
                        }
                    }
                }
            }
            _ => sigma.copy_from_slice(&self.avg[ni]),
        }
        let old_r: Vec<f32> = st.r[p * k..(p + 1) * k].to_vec();
        let old_m: Vec<f32> = st.m[p * k..(p + 1) * k].to_vec();
        let z: Vec<f32> = (0..k)
            .map(|h| (0..n).filter(|&q| q != p).map(|q| st.m[q * k + h]).product::<f32>())
            .collect();
        let mut acc = vec![0f32; n * k];
        let mut child_p = vec![0f32; na * k];
        let mut child_out = vec![0f32; n * k];
        for a in 0..na {
            for h in 0..k {
                st.r[p * k + h] = old_r[h] * sigma[a * k + h];
            }
            matvec(&g.pm[p], &st.r[p * k..(p + 1) * k], k, &mut st.m[p * k..(p + 1) * k]);
            self.walk(children[a], st, &mut child_out, mode, ev);
            for q in 0..n {
                if q != p {
                    for h in 0..k {
                        acc[q * k + h] += child_out[q * k + h];
                    }
                }
            }
            child_p[a * k..(a + 1) * k].copy_from_slice(&child_out[p * k..(p + 1) * k]);
        }
        st.r[p * k..(p + 1) * k].copy_from_slice(&old_r);
        st.m[p * k..(p + 1) * k].copy_from_slice(&old_m);

        out[..n * k].copy_from_slice(&acc);
        let mut own = vec![0f32; k];
        for h in 0..k {
            own[h] = match mode {
                Mode::Br(bp) if bp == p => (0..na).map(|a| child_p[a * k + h]).fold(f32::MIN, f32::max),
                _ => (0..na).map(|a| sigma[a * k + h] * child_p[a * k + h]).sum(),
            };
        }
        out[p * k..(p + 1) * k].copy_from_slice(&own);

        match mode {
            Mode::Train(t) => {
                for a in 0..na {
                    for h in 0..k {
                        let i = a * k + h;
                        if z[h] > 1e-9 {
                            self.qlast[ni][i] = child_p[i] / z[h];
                        }
                        self.regret[ni][i] = (self.regret[ni][i] + child_p[i] - own[h]).max(0.0);
                        self.ssum[ni][i] += t * old_r[h] * sigma[i];
                    }
                }
            }
            Mode::Eval => {
                if ev.len() == g.nodes.len() {
                    let mut e = NodeEval { player: p, weight: old_r.clone(), freq: sigma.clone(), ..Default::default() };
                    e.ev = vec![0f32; na * k];
                    for a in 0..na {
                        for h in 0..k {
                            e.ev[a * k + h] = if z[h] > 1e-12 { child_p[a * k + h] / z[h] } else { 0.0 };
                        }
                    }
                    e.reach = (0..n).map(|q| dot(&g.prior[q], &st.r[q * k..(q + 1) * k])).product();
                    if let Some(eq) = &g.raw_eq {
                        let mut v = vec![0.5f32; k];
                        let opp = node.aggressor.unwrap_or((p + 1) % n);
                        for h in 0..k {
                            let mut num = 0f64;
                            let mut den = 0f64;
                            for b in 0..k {
                                let w = g.pm[opp][h * k + b] as f64
                                    * if node.aggressor.is_some() { st.r[opp * k + b] as f64 } else { 1.0 };
                                num += w * eq[h * k + b] as f64;
                                den += w;
                            }
                            if den > 1e-12 {
                                v[h] = (num / den) as f32;
                            }
                        }
                        e.eq = v;
                    }
                    ev[ni] = Some(e);
                }
            }
            Mode::Br(_) => {}
        }
    }
}
