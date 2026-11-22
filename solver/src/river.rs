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
use crate::postflop::{blocked, ct, mask_of, PKind, Strength, Tree, NC};
use std::collections::HashMap;

/// The combos of one showdown table that are in either support, in `Strength::order` (ascending strength).
pub(crate) struct Showdown {
    /// the two cards of each entry
    cards: Vec<(u8, u8)>,
    /// per player: the entry's index in that player's support (`k`, the zero slot, if it is not in it)
    idx: [Vec<u32>; 2],
    /// start of every group of equal strength, and the number of entries at the end
    starts: Vec<u32>,
}

impl Showdown {
    /// The entries of `st` that are in either support (`pos[p][combo]`: the index in p's support, `k[p]` if not in it).
    fn cut(st: &Strength, pos: &[Vec<u32>; 2], k: [usize; 2]) -> Showdown {
        let cards = &ct().cards;
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
        sd
    }
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
                        showdowns[t] = Some(Showdown::cut(&tree.tables[t], &pos, k));
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
    /// `has_avg` are the solver's (see `Solver`).  `train_only: Some(q)` is one walk of an alternating update: only q's
    /// values, regrets and strategy sums (REFACTOR_PLAN 4-1); `dcfr` its DCFR discounts, as `train_subtree` takes them
    /// (the device re-solves the river with `alt-dcfr`, REFACTOR_PLAN 3-3-4).  `None`, `None` is the simultaneous CFR+.
    #[allow(clippy::too_many_arguments)] // the solver's state, the iteration's weight and how it updates
    pub(crate) fn train(&mut self, tree: &Tree, regret: &mut [Vec<f32>], ssum: &mut [Vec<f32>], locks: &[Option<Vec<f32>>], has_avg: &[bool], t: f32, train_only: Option<usize>, dcfr: Option<(f32, f32, f32)>) {
        let n = tree.nodes.len();
        let wants = |q: usize| train_only.is_none_or(|o| o == q);
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
            // what a terminal pays out (the pot minus the rake, as the general walk pays it)
            let pot_total = tree.cfg.pot_paid(node.inv);
            let mut v = std::mem::take(&mut self.val[i]);
            match &node.kind {
                PKind::Fold { winner } => {
                    let w = *winner as usize;
                    let l = 1 - w;
                    let (rw, rl) = (&self.reach[self.reach_of[i][w] as usize], &self.reach[self.reach_of[i][l] as usize]);
                    let (gain, loss) = (pot_total - node.inv[w], -node.inv[l]);
                    if wants(w) {
                        self.compat_mass(w, rl, &mut v[w]);
                        v[w][..self.k[w]].iter_mut().for_each(|x| *x *= gain);
                    }
                    if wants(l) {
                        self.compat_mass(l, rw, &mut v[l]);
                        v[l][..self.k[l]].iter_mut().for_each(|x| *x *= loss);
                    }
                }
                PKind::Showdown { table } => {
                    let sd = self.showdowns[*table as usize].as_ref().expect("showdown table");
                    for p in (0..2).filter(|&p| wants(p)) {
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
                    if wants(o) {
                        v[o][..ko].iter_mut().for_each(|x| *x = 0.0);
                        for &c in children {
                            for (x, &y) in v[o][..ko].iter_mut().zip(&self.val[c as usize][o][..ko]) {
                                *x += y;
                            }
                        }
                    }
                    if wants(p) {
                        v[p][..k].iter_mut().for_each(|x| *x = 0.0);
                        for (a, &c) in children.iter().enumerate() {
                            for ((x, &y), &s) in v[p][..k].iter_mut().zip(&self.val[c as usize][p][..k]).zip(&sigma[a * k..(a + 1) * k]) {
                                *x += s * y;
                            }
                        }
                    }
                    if wants(p) && locks[i].is_none() {
                        let reg = &mut regret[i];
                        for (a, &c) in children.iter().enumerate() {
                            let cv = &self.val[c as usize][p][..k];
                            for ((r, &y), &x) in reg[a * k..(a + 1) * k].iter_mut().zip(cv).zip(&v[p][..k]) {
                                *r = match dcfr {
                                    None => (*r + y - x).max(0.0),
                                    Some((pos, neg, _)) => *r * if *r > 0.0 { pos } else { neg } + (y - x),
                                };
                            }
                        }
                        if has_avg[i] {
                            let rp = &self.reach[self.reach_of[i][p] as usize][..k];
                            let ss = &mut ssum[i];
                            for a in 0..na {
                                for ((s, &r), &x) in ss[a * k..(a + 1) * k].iter_mut().zip(rp).zip(&sigma[a * k..(a + 1) * k]) {
                                    match dcfr {
                                        None => *s += t * r * x,
                                        Some((_, _, keep)) => *s = *s * keep + r * x,
                                    }
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

// ------------------------------------------------------------------ river subtrees of a bigger tree (REFACTOR_PLAN 4-2)
//
// A tree with chance nodes (a flop or turn tree) has a river subtree under every river card: a 5 card board, decisions,
// folds and showdowns, as a river tree.  More than 99% of the nodes of a 49 x 48 flop tree are in those subtrees, and
// the general walk trains them over 1,326 wide vectors.  `train_subtree` trains one of them over the supports, with the
// same arithmetic in the same order as the general walk (as `RiverWalk` does for a river tree), so the regrets and
// strategy sums stay bit for bit the same.  Its reaches come from above (the general walk's, at the river card), and
// it returns the values the general walk would return at the subtree's root on the supports, and 0 elsewhere: a value
// of a combo outside a player's support at the river board is either 0 in the general walk too (the combo is on the
// board) or of a combo outside the player's range, which no regret or strategy sum ever reads.

/// The supports of the two players on one 5 card board of a tree, and the board's showdown table cut to them.
pub(crate) struct BoardPlan {
    k: [usize; 2],
    sup: [Vec<u16>; 2],
    cards: [Vec<(u8, u8)>; 2],
    cross: [Vec<u32>; 2],
    showdown: Option<Showdown>,
}

impl BoardPlan {
    fn new(tree: &Tree, prior: &[Vec<f32>; 2], board: u64, table: Option<usize>) -> BoardPlan {
        let cards = &ct().cards;
        let sup: [Vec<u16>; 2] = [0, 1].map(|p| (0..NC).filter(|&h| prior[p][h] != 0.0 && !blocked(board, h)).map(|h| h as u16).collect());
        let k = [sup[0].len(), sup[1].len()];
        let mut pos = [vec![k[0] as u32; NC], vec![k[1] as u32; NC]];
        for p in 0..2 {
            for (j, &h) in sup[p].iter().enumerate() {
                pos[p][h as usize] = j as u32;
            }
        }
        let cross = [0, 1].map(|p| sup[p].iter().map(|&h| pos[1 - p][h as usize]).collect::<Vec<u32>>());
        let sup_cards = [0, 1].map(|p| sup[p].iter().map(|&h| cards[h as usize]).collect::<Vec<_>>());
        let showdown = table.map(|t| Showdown::cut(&tree.tables[t], &pos, k));
        BoardPlan { k, sup, cards: sup_cards, cross, showdown }
    }

    /// as `RiverWalk::compat_mass`
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

/// The river subtrees of a tree with chance nodes that `train_subtree` can walk, and their boards' plans.
pub(crate) struct RiverPlans {
    /// per node: the index in `plans` of a river subtree's root (the child of a river chance node), `u32::MAX` otherwise
    pub(crate) plan_of: Vec<u32>,
    plans: Vec<BoardPlan>,
}

impl RiverPlans {
    /// `None` for a tree with no river subtree under a chance node (e.g. a river tree, which `RiverWalk` trains).
    pub(crate) fn new(tree: &Tree, prior: &[Vec<f32>; 2], subtree_end: &[u32]) -> Option<RiverPlans> {
        if tree.board.len() >= 5 {
            return None;
        }
        let n = tree.nodes.len();
        let mut plan_of = vec![u32::MAX; n];
        let mut plans = Vec::new();
        let mut by_board: HashMap<u64, u32> = HashMap::new();
        for node in &tree.nodes {
            let PKind::Chance { children, .. } = &node.kind else { continue };
            for &c in children {
                let c = c as usize;
                let root = &tree.nodes[c];
                if root.board.len() != 5 {
                    continue;
                }
                // only decisions, folds and showdowns below (no chance node, no all-in run-out)
                let end = subtree_end[c] as usize;
                if !tree.nodes[c..end].iter().all(|x| matches!(x.kind, PKind::Decision { .. } | PKind::Fold { .. } | PKind::Showdown { .. })) {
                    continue;
                }
                let board = mask_of(&root.board);
                let table = tree.nodes[c..end].iter().find_map(|x| match x.kind {
                    PKind::Showdown { table } => Some(table as usize),
                    _ => None,
                });
                let id = *by_board.entry(board).or_insert_with(|| {
                    plans.push(BoardPlan::new(tree, prior, board, table));
                    (plans.len() - 1) as u32
                });
                if table.is_some() && plans[id as usize].showdown.is_none() {
                    plans[id as usize].showdown = table.map(|t| {
                        let p = &plans[id as usize];
                        let mut pos = [vec![p.k[0] as u32; NC], vec![p.k[1] as u32; NC]];
                        for q in 0..2 {
                            for (j, &h) in p.sup[q].iter().enumerate() {
                                pos[q][h as usize] = j as u32;
                            }
                        }
                        Showdown::cut(&tree.tables[t], &pos, p.k)
                    });
                }
                plan_of[c] = id;
            }
        }
        if plans.is_empty() {
            None
        } else {
            Some(RiverPlans { plan_of, plans })
        }
    }
}

/// What a training walk of a river subtree needs besides the tree and the regrets.
pub(crate) struct SubTrain<'a> {
    pub(crate) tree: &'a Tree,
    pub(crate) plans: &'a RiverPlans,
    pub(crate) has_avg: &'a [bool],
    /// the weight of this iteration in a CFR+ strategy average
    pub(crate) t: f32,
    /// an alternating walk: the player it updates (and computes the values of)
    pub(crate) train_only: Option<usize>,
    /// a DCFR walk: (positive regrets, negative regrets, strategy sums) discounts
    pub(crate) dcfr: Option<(f32, f32, f32)>,
}

/// Buffers of `train_subtree`, kept by a walk from one subtree to the next.
#[derive(Default)]
pub(crate) struct SubScratch {
    reach: Vec<Vec<f32>>,
    reach_of: Vec<[u32; 2]>,
    val: Vec<[Vec<f32>; 2]>,
    sigma: Vec<Vec<f32>>,
    rv: Vec<f64>,
}

fn sized(v: &mut Vec<f32>, n: usize) {
    v.clear();
    v.resize(n, 0.0);
}

/// Train the river subtree of `root` (a root of `ctx.plans`; its nodes are `root..end`) entered with the 1,326 wide
/// reaches `r` (the combos with the river card may be in them: they are off the supports); `regret` / `ssum` hold the
/// nodes from `base` on (as a `Part` of the general walk).  The values of both players at `root` (1,326 wide; nothing off
/// the supports, nothing for the player an alternating walk does not update) go to `out`: `out[p][h] += w * value` with
/// `Some(w)` (what a chance node's `add_scaled` adds, in the same expression), `out[p][h] = value` with `None`.
#[allow(clippy::too_many_arguments)] // the subtree, where its regrets are, its reaches, its buffers and where its values go
pub(crate) fn train_subtree(ctx: &SubTrain, root: usize, end: usize, base: usize, regret: &mut [Vec<f32>], ssum: &mut [Vec<f32>], r: [&[f32]; 2], sc: &mut SubScratch, out: &mut [Vec<f32>; 2], w: Option<f32>) {
    let tree = ctx.tree;
    let plan = &ctx.plans.plans[ctx.plans.plan_of[root] as usize];
    let k = plan.k;
    let n = end - root;
    let wants = |q: usize| ctx.train_only.is_none_or(|o| o == q);
    // reaches: the root's two, then one per (decision, action) for the actor; the other player's is shared
    sc.reach_of.clear();
    sc.reach_of.resize(n, [u32::MAX; 2]);
    let mut used = 0usize;
    let mut take = |sc: &mut SubScratch, len: usize| -> u32 {
        if sc.reach.len() <= used {
            sc.reach.push(Vec::new());
        }
        sized(&mut sc.reach[used], len);
        used += 1;
        (used - 1) as u32
    };
    for p in 0..2 {
        let id = take(sc, k[p] + 1);
        let dst = &mut sc.reach[id as usize];
        for (j, &h) in plan.sup[p].iter().enumerate() {
            dst[j] = r[p][h as usize];
        }
        sc.reach_of[0][p] = id;
    }
    if sc.sigma.len() < n {
        sc.sigma.resize_with(n, Vec::new);
    }
    if sc.val.len() < n {
        sc.val.resize_with(n, || [Vec::new(), Vec::new()]);
    }
    // strategies and reaches, parents first
    for li in 0..n {
        let i = root + li;
        let PKind::Decision { player, children, .. } = &tree.nodes[i].kind else { continue };
        let p = *player as usize;
        let (kp, na) = (k[p], children.len());
        debug_assert_eq!(regret[i - base].len(), na * kp, "node {} keeps its regrets over its actor's support", i);
        let mut sigma = std::mem::take(&mut sc.sigma[li]);
        sized(&mut sigma, na * kp);
        regret_match(&regret[i - base], na, kp, &mut sigma);
        let from = sc.reach_of[li][p] as usize;
        for (a, &c) in children.iter().enumerate() {
            let lc = c as usize - root;
            let to = take(sc, kp + 1);
            let mut out = std::mem::take(&mut sc.reach[to as usize]);
            for ((o, &rr), &x) in out[..kp].iter_mut().zip(&sc.reach[from][..kp]).zip(&sigma[a * kp..(a + 1) * kp]) {
                *o = rr * x;
            }
            sc.reach[to as usize] = out;
            let mut ro = sc.reach_of[li];
            ro[p] = to;
            sc.reach_of[lc] = ro;
        }
        sc.sigma[li] = sigma;
    }
    let rv_len = plan.showdown.as_ref().map_or(0, |s| s.cards.len());
    if sc.rv.len() < rv_len {
        sc.rv.resize(rv_len, 0.0);
    }
    // values and regrets, children first
    for li in (0..n).rev() {
        let i = root + li;
        let node = &tree.nodes[i];
        let pot_total = tree.cfg.pot_paid(node.inv);
        let mut v = std::mem::take(&mut sc.val[li]);
        for p in 0..2 {
            sized(&mut v[p], k[p] + 1);
        }
        match &node.kind {
            PKind::Fold { winner } => {
                let w = *winner as usize;
                let l = 1 - w;
                let (rw, rl) = (&sc.reach[sc.reach_of[li][w] as usize], &sc.reach[sc.reach_of[li][l] as usize]);
                if wants(w) {
                    let gain = pot_total - node.inv[w];
                    plan.compat_mass(w, rl, &mut v[w]);
                    v[w][..k[w]].iter_mut().for_each(|x| *x *= gain);
                }
                if wants(l) {
                    let loss = -node.inv[l];
                    plan.compat_mass(l, rw, &mut v[l]);
                    v[l][..k[l]].iter_mut().for_each(|x| *x *= loss);
                }
            }
            PKind::Showdown { .. } => {
                let sd = plan.showdown.as_ref().expect("the board's showdown table");
                for p in (0..2).filter(|&p| wants(p)) {
                    let ro = &sc.reach[sc.reach_of[li][1 - p] as usize];
                    showdown(sd, p, ro, pot_total, node.inv[p], &mut sc.rv, &mut v[p]);
                    v[p][k[p]] = 0.0; // the zero slot (entries outside p's support write there)
                }
            }
            PKind::Decision { player, children, .. } => {
                let p = *player as usize;
                let o = 1 - p;
                let (kp, ko, na) = (k[p], k[o], children.len());
                let sigma = &sc.sigma[li];
                // the opponent's values add up, the actor's are weighted by the strategy (from 0, as the general walk)
                if wants(o) {
                    for &c in children {
                        let cv = &sc.val[c as usize - root][o];
                        v[o][..ko].iter_mut().zip(&cv[..ko]).for_each(|(x, &y)| *x += y);
                    }
                }
                if wants(p) {
                    for (a, &c) in children.iter().enumerate() {
                        let cv = &sc.val[c as usize - root][p];
                        for ((x, &y), &s) in v[p][..kp].iter_mut().zip(&cv[..kp]).zip(&sigma[a * kp..(a + 1) * kp]) {
                            *x += s * y;
                        }
                    }
                    let reg = &mut regret[i - base];
                    for (a, &c) in children.iter().enumerate() {
                        let cv = &sc.val[c as usize - root][p][..kp];
                        for ((rg, &y), &x) in reg[a * kp..(a + 1) * kp].iter_mut().zip(cv).zip(&v[p][..kp]) {
                            *rg = match ctx.dcfr {
                                None => (*rg + y - x).max(0.0),
                                Some((pos, neg, _)) => *rg * if *rg > 0.0 { pos } else { neg } + (y - x),
                            };
                        }
                    }
                    if ctx.has_avg[i] {
                        let rp = &sc.reach[sc.reach_of[li][p] as usize][..kp];
                        let ss = &mut ssum[i - base];
                        for a in 0..na {
                            for ((s, &rr), &x) in ss[a * kp..(a + 1) * kp].iter_mut().zip(rp).zip(&sigma[a * kp..(a + 1) * kp]) {
                                *s = match ctx.dcfr {
                                    None => *s + ctx.t * rr * x,
                                    Some((_, _, keep)) => *s * keep + rr * x,
                                };
                            }
                        }
                    }
                }
            }
            _ => unreachable!("river subtrees have no chance nodes or run-outs"),
        }
        sc.val[li] = v;
    }
    for p in (0..2).filter(|&p| wants(p)) {
        let (dst, val) = (&mut out[p], &sc.val[0][p]);
        match w {
            Some(w) => {
                for (j, &h) in plan.sup[p].iter().enumerate() {
                    dst[h as usize] += w * val[j];
                }
            }
            None => {
                for (j, &h) in plan.sup[p].iter().enumerate() {
                    dst[h as usize] = val[j];
                }
            }
        }
    }
}
