//! The training walk of a river tree on the supports (REFACTOR_PLAN 3-3-4).
//!
//! In plan B the device solves one river tree (a 5 card board, ~27 nodes) for every river card the user picks, so
//! `Solver::iterate` on such a tree takes this walk instead of the general one:
//!
//! * **Support-wide vectors.**  Every node of a river tree has the same board, so player p's reach is nonzero only on
//!   one list of combos, the support (`Solver::support` of p's nodes: p's starting range off the board).  Reaches and
//!   values are vectors over that list (`k` ~500-700 for real ranges) instead of all 1,326 combos.  A value of a combo
//!   outside p's support never reaches a regret of p (it is multiplied by a reach of 0 or dropped), which is why the
//!   general walk can afford to compute it and this walk can skip it.
//! * **No allocation per node.**  The reaches, values and strategies of every node are buffers made once, with the
//!   walk.  A training iteration of a tree without chance nodes visits each node once, and a node's strategy depends
//!   only on its own regrets, so the walk is two passes: the strategies and reaches top-down (nodes in index order,
//!   parents first), the values and regret updates bottom-up.
//! * **Showdowns over both supports.**  The hands sorted by strength (`Strength::order`) are cut down to the combos in
//!   either support once, with their index in each support (or the zero slot past its end).
//!
//! The arithmetic is the general walk's (`Part::walk` with `Mode::Train`), in the same order, on the same values;
//! terms the general walk adds for combos outside a support are exact zeros.  The regrets and strategy sums are
//! therefore bit for bit those of the general walk (tests in `postflop.rs`: `river_walk_*`), and it keeps them in
//! the same layout (`na * k` over the node's support), so everything else (`finalize_avg`, `exploitability`,
//! `evaluate`, checkpoints) is unchanged and still uses the general walk.
use crate::engine::regret_match;
use crate::postflop::{blocked, ct, mask_of, PKind, Tree, NC};

/// The combos of one showdown table that are in either support, in `Strength::order` (ascending strength).
struct Showdown {
    /// the two cards of each entry
    cards: Vec<(u8, u8)>,
    /// per player: the entry's index in that player's support (`k`, the zero slot, if it is not in it)
    idx: [Vec<u32>; 2],
    /// start of every group of equal strength, and the number of entries at the end
    starts: Vec<u32>,
}

pub(crate) struct RiverWalk {
    /// per player: the support's size `k`; reach and value vectors have `k + 1` entries, the last one a zero slot
    k: [usize; 2],
    /// per player and support entry: its cards
    cards: [Vec<(u8, u8)>; 2],
    /// per player and support entry: the index of the same combo in the other player's support, or the other's `k`
    cross: [Vec<u32>; 2],
    /// per table of the tree (`Tree::tables`); `None` for a table no showdown uses
    showdowns: Vec<Option<Showdown>>,
    /// per node and player: the reach vector (index into `reach`) the node is reached with
    reach_of: Vec<[u32; 2]>,
    reach: Vec<Vec<f32>>,
    /// per node and player: the counterfactual value of every support entry
    val: Vec<[Vec<f32>; 2]>,
    /// per decision node: the strategy of this iteration, `na * k` of the actor
    sigma: Vec<Vec<f32>>,
    /// a showdown's opponent reach per entry
    scratch: Vec<f64>,
}

/// Can the river walk train this tree: a 5 card board, no chance node and no all-in run-out.
pub(crate) fn applies(tree: &Tree) -> bool {
    tree.board.len() == 5 && tree.nodes.iter().all(|n| matches!(n.kind, PKind::Decision { .. } | PKind::Fold { .. } | PKind::Showdown { .. }))
}

impl RiverWalk {
    /// `prior` are the solver's starting ranges (zero on the board); `support_of_node(i)` the support the solver
    /// keeps the regrets of decision node `i` over, which must be its actor's support here.
    pub(crate) fn new<'s>(tree: &Tree, prior: &[Vec<f32>; 2], support_of_node: impl Fn(usize) -> &'s [u16]) -> RiverWalk {
        assert!(applies(tree), "not a river tree");
        let board = mask_of(&tree.board);
        let cards = &ct().cards;
        let sup: [Vec<u16>; 2] = [0, 1].map(|p| (0..NC).filter(|&h| prior[p][h] != 0.0 && !blocked(board, h)).map(|h| h as u16).collect());
        let k = [sup[0].len(), sup[1].len()];
        // combo -> index in each support (k = not in it)
        let mut pos = [vec![k[0] as u32; NC], vec![k[1] as u32; NC]];
        for p in 0..2 {
            for (j, &h) in sup[p].iter().enumerate() {
                pos[p][h as usize] = j as u32;
            }
        }
        let cross = [0, 1].map(|p| sup[p].iter().map(|&h| pos[1 - p][h as usize]).collect::<Vec<u32>>());
        let sup_cards = [0, 1].map(|p| sup[p].iter().map(|&h| cards[h as usize]).collect::<Vec<_>>());

        let mut showdowns: Vec<Option<Showdown>> = (0..tree.tables.len()).map(|_| None).collect();
        let n = tree.nodes.len();
        let mut reach_of = vec![[u32::MAX; 2]; n];
        let mut reach: Vec<Vec<f32>> = Vec::new();
        for p in 0..2 {
            let mut r = vec![0f32; k[p] + 1];
            for (j, &h) in sup[p].iter().enumerate() {
                r[j] = prior[p][h as usize];
            }
            reach.push(r);
        }
        reach_of[0] = [0, 1];
        let mut sigma = vec![Vec::new(); n];
        for i in 0..n {
            assert!(reach_of[i][0] != u32::MAX, "nodes are numbered parents first");
            match &tree.nodes[i].kind {
                PKind::Decision { player, children, .. } => {
                    let p = *player as usize;
                    assert_eq!(support_of_node(i), &sup[p][..], "the solver keeps node {} over its actor's support", i);
                    sigma[i] = vec![0f32; children.len() * k[p]];
                    for &c in children {
                        let c = c as usize;
                        assert!(c > i, "nodes are numbered parents first");
                        let mut r = reach_of[i];
                        r[p] = reach.len() as u32;
                        reach.push(vec![0f32; k[p] + 1]);
                        reach_of[c] = r;
                    }
                }
                PKind::Showdown { table } => {
                    let t = *table as usize;
                    if showdowns[t].is_none() {
                        let st = &tree.tables[t];
                        let mut sd = Showdown { cards: Vec::new(), idx: [Vec::new(), Vec::new()], starts: Vec::new() };
                        for g in 0..st.starts.len() - 1 {
                            let first = sd.cards.len();
                            for &h in &st.order[st.starts[g] as usize..st.starts[g + 1] as usize] {
                                let (i0, i1) = (pos[0][h as usize], pos[1][h as usize]);
                                if i0 as usize == k[0] && i1 as usize == k[1] {
                                    continue;
                                }
                                sd.cards.push(cards[h as usize]);
                                sd.idx[0].push(i0);
                                sd.idx[1].push(i1);
                            }
                            if sd.cards.len() > first {
                                sd.starts.push(first as u32);
                            }
                        }
                        sd.starts.push(sd.cards.len() as u32);
                        showdowns[t] = Some(sd);
                    }
                }
                _ => {}
            }
        }
        let val = (0..n).map(|_| [vec![0f32; k[0] + 1], vec![0f32; k[1] + 1]]).collect();
        let scratch = vec![0f64; showdowns.iter().flatten().map(|s| s.cards.len()).max().unwrap_or(0)];
        RiverWalk { k, cards: sup_cards, cross, showdowns, reach_of, reach, val, sigma, scratch }
    }

    /// One CFR+ iteration (`t`: the weight of this iteration in the strategy average).  `regret` / `ssum` / `locks` /
    /// `has_avg` are the solver's (see `Solver`).
    pub(crate) fn train(&mut self, tree: &Tree, regret: &mut [Vec<f32>], ssum: &mut [Vec<f32>], locks: &[Option<Vec<f32>>], has_avg: &[bool], t: f32) {
        let n = tree.nodes.len();
        // strategies and reaches, parents first
        for i in 0..n {
            let PKind::Decision { player, children, .. } = &tree.nodes[i].kind else { continue };
            let p = *player as usize;
            let (k, na) = (self.k[p], children.len());
            let sigma = &mut self.sigma[i];
            match &locks[i] {
                Some(l) => {
                    // the support's entries of the locked strategy (na * NC)
                    let sup = &self.cards[p];
                    for a in 0..na {
                        for j in 0..k {
                            let (c0, c1) = sup[j];
                            sigma[a * k + j] = l[a * NC + ct().index(c0, c1)];
                        }
                    }
                }
                None => regret_match(&regret[i], na, k, sigma),
            }
            let from = self.reach_of[i][p] as usize;
            for (a, &c) in children.iter().enumerate() {
                let to = self.reach_of[c as usize][p] as usize;
                let mut out = std::mem::take(&mut self.reach[to]);
                let (rp, s) = (&self.reach[from][..k], &self.sigma[i][a * k..(a + 1) * k]);
                for ((o, &r), &x) in out[..k].iter_mut().zip(rp).zip(s) {
                    *o = r * x;
                }
                self.reach[to] = out;
            }
        }
        // values and regrets, children first
        for i in (0..n).rev() {
            let node = &tree.nodes[i];
            let pot_total = tree.cfg.pot + node.inv[0] + node.inv[1];
            let mut v = std::mem::take(&mut self.val[i]);
            match &node.kind {
                PKind::Fold { winner } => {
                    let w = *winner as usize;
                    let l = 1 - w;
                    let (rw, rl) = (&self.reach[self.reach_of[i][w] as usize], &self.reach[self.reach_of[i][l] as usize]);
                    let (gain, loss) = (pot_total - node.inv[w], -node.inv[l]);
                    self.compat_mass(w, rl, &mut v[w]);
                    v[w][..self.k[w]].iter_mut().for_each(|x| *x *= gain);
                    self.compat_mass(l, rw, &mut v[l]);
                    v[l][..self.k[l]].iter_mut().for_each(|x| *x *= loss);
                }
                PKind::Showdown { table } => {
                    let sd = self.showdowns[*table as usize].as_ref().expect("showdown table");
                    for p in 0..2 {
                        let ro = &self.reach[self.reach_of[i][1 - p] as usize];
                        showdown(sd, p, ro, pot_total, node.inv[p], &mut self.scratch, &mut v[p]);
                    }
                }
                PKind::Decision { player, children, .. } => {
                    let p = *player as usize;
                    let o = 1 - p;
                    let (k, ko, na) = (self.k[p], self.k[o], children.len());
                    let sigma = &self.sigma[i];
                    // the opponent's values add up, the actor's are weighted by the strategy (first action: 0 + x = x)
                    v[o][..ko].iter_mut().for_each(|x| *x = 0.0);
                    v[p][..k].iter_mut().for_each(|x| *x = 0.0);
                    for (a, &c) in children.iter().enumerate() {
                        let cv = &self.val[c as usize];
                        for (x, &y) in v[o][..ko].iter_mut().zip(&cv[o][..ko]) {
                            *x += y;
                        }
                        for ((x, &y), &s) in v[p][..k].iter_mut().zip(&cv[p][..k]).zip(&sigma[a * k..(a + 1) * k]) {
                            *x += s * y;
                        }
                    }
                    if locks[i].is_none() {
                        let reg = &mut regret[i];
                        for (a, &c) in children.iter().enumerate() {
                            let cv = &self.val[c as usize][p][..k];
                            for ((r, &y), &x) in reg[a * k..(a + 1) * k].iter_mut().zip(cv).zip(&v[p][..k]) {
                                *r = (*r + y - x).max(0.0);
                            }
                        }
                        if has_avg[i] {
                            let rp = &self.reach[self.reach_of[i][p] as usize][..k];
                            let ss = &mut ssum[i];
                            for a in 0..na {
                                for ((s, &r), &x) in ss[a * k..(a + 1) * k].iter_mut().zip(rp).zip(&sigma[a * k..(a + 1) * k]) {
                                    *s += t * r * x;
                                }
                            }
                        }
                    }
                }
                _ => unreachable!("river trees have no chance nodes"),
            }
            self.val[i] = v;
        }
    }

    /// `out[j]` (player p's support entry j) = the opponent's reach `ro` on the combos that share no card with it,
    /// as `compat_mass` (same order: the opponent's support ascending, zeros skipped).
    fn compat_mass(&self, p: usize, ro: &[f32], out: &mut [f32]) {
        let o = 1 - p;
        let mut total = 0f64;
        let mut card_all = [0f64; 52];
        for (&(a, b), &r) in self.cards[o].iter().zip(&ro[..self.k[o]]) {
            let rv = r as f64;
            if rv != 0.0 {
                total += rv;
                card_all[a as usize] += rv;
                card_all[b as usize] += rv;
            }
        }
        for ((x, &(a, b)), &c) in out[..self.k[p]].iter_mut().zip(&self.cards[p]).zip(&self.cross[p]) {
            *x = (total - card_all[a as usize] - card_all[b as usize] + ro[c as usize] as f64) as f32;
        }
    }
}

/// Player p's showdown values against the opponent's reach `ro` (indexed by the opponent's support, zero slot at the
/// end): `pot_total * share - inv * mass`, with `share` and `mass` as `showdown` computes them.  Entries of p's
/// support get their value; entries outside it write to p's zero slot (`out[k]`), which nothing reads.  `rv` is
/// scratch space for the opponent's reach per entry (at least as long as the entries).
fn showdown(sd: &Showdown, p: usize, ro: &[f32], pot_total: f32, inv: f32, rv: &mut [f64], out: &mut [f32]) {
    let rv = &mut rv[..sd.cards.len()];
    let mut total = 0f64;
    let mut card_all = [0f64; 52];
    for ((x, &(a, b)), &io) in rv.iter_mut().zip(&sd.cards).zip(&sd.idx[1 - p]) {
        let r = ro[io as usize] as f64;
        *x = r;
        if r != 0.0 {
            total += r;
            card_all[a as usize] += r;
            card_all[b as usize] += r;
        }
    }
    let mine = &sd.idx[p];
    let mut cum_total = 0f64;
    let mut cum_card = [0f64; 52];
    let mut gc = [0f64; 52];
    for g in sd.starts.windows(2) {
        let (s, e) = (g[0] as usize, g[1] as usize);
        let (cards, rv, mine) = (&sd.cards[s..e], &rv[s..e], &mine[s..e]);
        let mut gt = 0f64;
        for (&(a, b), &r) in cards.iter().zip(rv) {
            gt += r;
            gc[a as usize] += r;
            gc[b as usize] += r;
        }
        for ((&(a, b), &r), &im) in cards.iter().zip(rv).zip(mine) {
            let (a, b) = (a as usize, b as usize);
            let lower = cum_total - cum_card[a] - cum_card[b];
            let tie = gt - gc[a] - gc[b] + r;
            let share = (lower + 0.5 * tie) as f32;
            let mass = (total - card_all[a] - card_all[b] + r) as f32;
            out[im as usize] = pot_total * share - inv * mass;
        }
        for (&(a, b), &r) in cards.iter().zip(rv) {
            cum_total += r;
            cum_card[a as usize] += r;
            cum_card[b as usize] += r;
            gc[a as usize] = 0.0;
            gc[b as usize] = 0.0;
        }
    }
}
