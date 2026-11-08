//! Heads-up postflop solver (flop -> turn -> river) over the 1,326 starting hands.
//!
//! * vector-form CFR+ (linear averaging), two players: 0 = out of position, 1 = in position
//! * chance nodes use a *stratified sample* of the turn / river cards; each sampled card carries the
//!   weight `(N_rem / K) / (N_rem - 4)` so that the sample is an unbiased estimate of the full deal
//! * all-in before the river is valued over the real run-outs (turn: all rivers, flop: a fixed sample)
//! * river showdowns are O(n): hands sorted by strength + prefix sums, with exact card removal
//!
//! Payoffs are "share of the final pot minus chips put in postflop"; the initial pot `pot` therefore
//! belongs to nobody, and `v0 + v1 = pot` at every terminal (constant sum).
use crate::engine::regret_match;
use crate::eval::eval7;
use crate::rng::Rng;
use std::collections::HashMap;
use std::sync::OnceLock;

pub const NC: usize = 1326;

// ------------------------------------------------------------------ combos

pub struct ComboTable {
    pub cards: Vec<(u8, u8)>,
    idx: Vec<u16>,
    /// for every card the combos that contain it
    pub by_card: Vec<Vec<u16>>,
}

static CT: OnceLock<ComboTable> = OnceLock::new();

pub fn ct() -> &'static ComboTable {
    CT.get_or_init(|| {
        let mut cards = Vec::with_capacity(NC);
        let mut idx = vec![0u16; 52 * 52];
        let mut by_card = vec![Vec::new(); 52];
        for a in 0..52u8 {
            for b in (a + 1)..52u8 {
                let i = cards.len() as u16;
                idx[a as usize * 52 + b as usize] = i;
                idx[b as usize * 52 + a as usize] = i;
                by_card[a as usize].push(i);
                by_card[b as usize].push(i);
                cards.push((a, b));
            }
        }
        ComboTable { cards, idx, by_card }
    })
}

impl ComboTable {
    pub fn index(&self, a: u8, b: u8) -> usize {
        self.idx[a as usize * 52 + b as usize] as usize
    }
}

pub fn mask_of(cards: &[u8]) -> u64 {
    cards.iter().fold(0u64, |m, &c| m | (1u64 << c))
}

#[inline]
pub fn blocked(mask: u64, h: usize) -> bool {
    let (a, b) = ct().cards[h];
    (mask >> a) & 1 == 1 || (mask >> b) & 1 == 1
}

fn zero_card(r: &[f32], card: u8) -> Vec<f32> {
    let mut v = r.to_vec();
    for &h in &ct().by_card[card as usize] {
        v[h as usize] = 0.0;
    }
    v
}

// ------------------------------------------------------------------ showdown

/// Hands that do not collide with a complete 5 card board, sorted by strength (ascending),
/// with the start offsets of every group of equal strength.
pub struct Strength {
    pub order: Vec<u16>,
    pub starts: Vec<u32>,
    pub mask: u64,
}

impl Strength {
    pub fn new(board: &[u8; 5]) -> Strength {
        let cards = &ct().cards;
        let mask = mask_of(board);
        let mut v: Vec<(u32, u16)> = Vec::with_capacity(1100);
        for h in 0..NC {
            let (a, b) = cards[h];
            if (mask >> a) & 1 == 1 || (mask >> b) & 1 == 1 {
                continue;
            }
            v.push((eval7(&[a, b, board[0], board[1], board[2], board[3], board[4]]), h as u16));
        }
        v.sort_unstable();
        let mut order = Vec::with_capacity(v.len());
        let mut starts = Vec::new();
        let mut prev = u32::MAX;
        for (i, &(s, h)) in v.iter().enumerate() {
            if i == 0 || s != prev {
                starts.push(i as u32);
                prev = s;
            }
            order.push(h);
        }
        starts.push(v.len() as u32);
        Strength { order, starts, mask }
    }
}

/// For every hand `h` of the board: `share[h] = sum_b r[b] * (1 if h beats b, 1/2 if tie)` and
/// `mass[h] = sum_b r[b]` over opponent hands `b` that do not share a card with `h`.
/// `r` must be zero on combos that collide with the board.
pub fn showdown(st: &Strength, r: &[f32], share: &mut [f32], mass: &mut [f32]) {
    let cards = &ct().cards;
    let mut total = 0f64;
    let mut card_all = [0f64; 52];
    for &h in &st.order {
        let rv = r[h as usize] as f64;
        if rv != 0.0 {
            let (a, b) = cards[h as usize];
            total += rv;
            card_all[a as usize] += rv;
            card_all[b as usize] += rv;
        }
    }
    let mut cum_total = 0f64;
    let mut cum_card = [0f64; 52];
    let mut gc = [0f64; 52];
    for g in 0..st.starts.len() - 1 {
        let (s, e) = (st.starts[g] as usize, st.starts[g + 1] as usize);
        let mut gt = 0f64;
        for &h in &st.order[s..e] {
            let rv = r[h as usize] as f64;
            let (a, b) = cards[h as usize];
            gt += rv;
            gc[a as usize] += rv;
            gc[b as usize] += rv;
        }
        for &h in &st.order[s..e] {
            let hv = h as usize;
            let (a, b) = (cards[hv].0 as usize, cards[hv].1 as usize);
            let rv = r[hv] as f64;
            let lower = cum_total - cum_card[a] - cum_card[b];
            let tie = gt - gc[a] - gc[b] + rv;
            share[hv] = (lower + 0.5 * tie) as f32;
            mass[hv] = (total - card_all[a] - card_all[b] + rv) as f32;
        }
        for &h in &st.order[s..e] {
            let hv = h as usize;
            let (a, b) = (cards[hv].0 as usize, cards[hv].1 as usize);
            let rv = r[hv] as f64;
            cum_total += rv;
            cum_card[a] += rv;
            cum_card[b] += rv;
            gc[a] = 0.0;
            gc[b] = 0.0;
        }
    }
}

/// `out[h] = sum of r[b] over b that does not share a card with h` for hands that avoid the board.
pub fn compat_mass(board_mask: u64, r: &[f32], out: &mut [f32]) {
    let cards = &ct().cards;
    let mut total = 0f64;
    let mut card_all = [0f64; 52];
    for h in 0..NC {
        let rv = r[h] as f64;
        if rv != 0.0 {
            let (a, b) = cards[h];
            total += rv;
            card_all[a as usize] += rv;
            card_all[b as usize] += rv;
        }
    }
    for h in 0..NC {
        let (a, b) = cards[h];
        out[h] = if (board_mask >> a) & 1 == 1 || (board_mask >> b) & 1 == 1 {
            0.0
        } else {
            (total - card_all[a as usize] - card_all[b as usize] + r[h] as f64) as f32
        };
    }
}

// ------------------------------------------------------------------ tree

#[derive(Clone, Debug)]
pub struct Config {
    /// pot before the first postflop action
    pub pot: f32,
    /// effective stack behind at the start of the flop
    pub stack: f32,
    /// bet sizes (fraction of the pot) per street: flop, turn, river
    pub bets: [Vec<f32>; 3],
    /// a raise goes to `raise_mult` x the bet it faces
    pub raise_mult: f32,
    /// a bet / raise of at least this fraction of the remaining stack becomes an all-in
    pub allin_ratio: f32,
    pub allow_allin: bool,
    /// per street: may a bet be raised to `raise_mult` x (otherwise only the all-in raise exists)
    pub raise_sizes: [bool; 3],
    pub turn_cards: usize,
    pub river_cards: usize,
    /// fixed number of sampled run-outs used to value an all-in on the flop
    pub flop_runouts: usize,
    pub seed: u64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            pot: 5.5,
            stack: 97.5,
            bets: [vec![0.33, 0.75], vec![0.66], vec![0.5, 1.0]],
            raise_mult: 3.0,
            allin_ratio: 0.67,
            allow_allin: true,
            raise_sizes: [true, false, false],
            turn_cards: 6,
            river_cards: 2,
            flop_runouts: 120,
            seed: 7,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ActInfo {
    /// 0 fold, 1 check / call, 2 bet / raise, 3 all-in
    pub kind: u8,
    /// the actor's total investment on this street after the action (call: the matched amount)
    pub amount: f32,
}

pub enum PKind {
    Decision { player: u8, acts: Vec<ActInfo>, children: Vec<u32> },
    Chance { cards: Vec<u8>, children: Vec<u32>, weight: f32 },
    Fold { winner: u8 },
    Showdown { table: u32 },
    AllIn { tables: Vec<u32>, weight: f32 },
}

pub struct PNode {
    pub kind: PKind,
    /// chips each player has put in postflop
    pub inv: [f32; 2],
    /// 0 flop, 1 turn, 2 river
    pub street: u8,
    pub board: Vec<u8>,
    /// probability of the chance path leading here (product of 1/K over the dealt cards)
    pub chance_p: f32,
}

pub struct Tree {
    pub nodes: Vec<PNode>,
    pub tables: Vec<Strength>,
    pub cfg: Config,
    pub board: Vec<u8>,
}

#[derive(Clone)]
struct St {
    board: Vec<u8>,
    street: u8,
    inv: [f32; 2],
    sinv: [f32; 2],
    to_act: u8,
    raises: u8,
    acted: u8,
    chance_p: f32,
}

struct Builder {
    cfg: Config,
    nodes: Vec<PNode>,
    tables: Vec<Strength>,
    table_ids: HashMap<u64, u32>,
    flop_runouts: Vec<u32>,
    rng: Rng,
}

fn round_q(x: f32) -> f32 {
    (x * 4.0).round() / 4.0
}

/// stratified sample of `k` cards from the unseen ones (sorted by rank, one random card per stratum)
pub fn pick_cards(board: &[u8], k: usize, rng: &mut Rng) -> Vec<u8> {
    let mut rem: Vec<u8> = (0..52u8).filter(|c| !board.contains(c)).collect();
    rem.sort_by_key(|&c| std::cmp::Reverse((c >> 2, c & 3)));
    if k >= rem.len() {
        return rem;
    }
    let n = rem.len();
    (0..k)
        .map(|i| {
            let (lo, hi) = (i * n / k, (i + 1) * n / k);
            rem[lo + rng.below((hi - lo) as u32) as usize]
        })
        .collect()
}

impl Builder {
    fn table(&mut self, board5: &[u8]) -> u32 {
        let key = mask_of(board5);
        if let Some(&i) = self.table_ids.get(&key) {
            return i;
        }
        let b: [u8; 5] = [board5[0], board5[1], board5[2], board5[3], board5[4]];
        self.tables.push(Strength::new(&b));
        let i = (self.tables.len() - 1) as u32;
        self.table_ids.insert(key, i);
        i
    }

    fn push(&mut self, kind: PKind, st: &St, inv: [f32; 2]) -> u32 {
        self.nodes.push(PNode { kind, inv, street: st.street, board: st.board.clone(), chance_p: st.chance_p });
        (self.nodes.len() - 1) as u32
    }

    fn end_street(&mut self, st: &St, inv: [f32; 2], allin: bool) -> u32 {
        let blen = st.board.len();
        if blen == 5 && (allin || st.street == 2) {
            let t = self.table(&st.board.clone());
            return self.push(PKind::Showdown { table: t }, st, inv);
        }
        if allin {
            // run-outs: turn -> every river card, flop -> a fixed sample of (turn, river) pairs
            let (tables, weight) = if blen == 4 {
                let rivers: Vec<u8> = (0..52u8).filter(|c| !st.board.contains(c)).collect();
                let w = 1.0 / (rivers.len() as f32 - 4.0);
                let ts = rivers
                    .iter()
                    .map(|&c| {
                        let mut b = st.board.clone();
                        b.push(c);
                        self.table(&b)
                    })
                    .collect();
                (ts, w)
            } else {
                if self.flop_runouts.is_empty() {
                    let mut rem: Vec<u8> = (0..52u8).filter(|c| !st.board.contains(c)).collect();
                    let mut ids = Vec::new();
                    let mut seen = std::collections::HashSet::new();
                    while ids.len() < self.cfg.flop_runouts.min(1176) {
                        for i in 0..2 {
                            let j = i + self.rng.below((rem.len() - i) as u32) as usize;
                            rem.swap(i, j);
                        }
                        let key = (rem[0].min(rem[1]), rem[0].max(rem[1]));
                        if !seen.insert(key) {
                            continue;
                        }
                        let mut b = st.board.clone();
                        b.push(rem[0]);
                        b.push(rem[1]);
                        ids.push(self.table(&b));
                    }
                    self.flop_runouts = ids;
                }
                let s = self.flop_runouts.len() as f32;
                (self.flop_runouts.clone(), (1176.0 / s) / 990.0)
            };
            return self.push(PKind::AllIn { tables, weight }, st, inv);
        }
        // betting round over, deal the next street
        let me = self.push(PKind::Chance { cards: vec![], children: vec![], weight: 0.0 }, st, inv);
        let k = if st.street == 0 { self.cfg.turn_cards } else { self.cfg.river_cards };
        let mut rng = Rng::new(self.cfg.seed ^ mask_of(&st.board) ^ ((st.street as u64) << 56));
        let cards = pick_cards(&st.board, k, &mut rng);
        let n_rem = 52 - st.board.len();
        let weight = (n_rem as f32 / cards.len() as f32) / (n_rem as f32 - 4.0);
        let mut children = Vec::new();
        for &c in &cards {
            let mut b = st.board.clone();
            b.push(c);
            let next = St { board: b, street: st.street + 1, inv, sinv: [0.0, 0.0], to_act: 0, raises: 0, acted: 0, chance_p: st.chance_p / cards.len() as f32 };
            children.push(self.node(next));
        }
        self.nodes[me as usize].kind = PKind::Chance { cards, children, weight };
        me
    }

    fn node(&mut self, st: St) -> u32 {
        let p = st.to_act as usize;
        let o = 1 - p;
        let pot_now = self.cfg.pot + st.inv[0] + st.inv[1];
        let rem = self.cfg.stack - st.inv[p];
        let facing = st.sinv[o] - st.sinv[p];

        enum Out {
            Fold,
            End { inv: [f32; 2], allin: bool },
            Next(St),
        }
        let mut acts: Vec<(ActInfo, Out)> = Vec::new();
        let bet_to = |add: f32, st: &St, kind: u8| -> (ActInfo, Out) {
            let mut inv = st.inv;
            let mut sinv = st.sinv;
            inv[p] += add;
            sinv[p] += add;
            (ActInfo { kind, amount: sinv[p] }, Out::Next(St { inv, sinv, to_act: o as u8, raises: st.raises + 1, acted: st.acted + 1, ..st.clone() }))
        };

        if facing > 1e-6 {
            acts.push((ActInfo { kind: 0, amount: st.sinv[p] }, Out::Fold));
            let call = facing.min(rem);
            let mut inv = st.inv;
            inv[p] += call;
            let allin = inv[0] >= self.cfg.stack - 1e-3 || inv[1] >= self.cfg.stack - 1e-3;
            acts.push((ActInfo { kind: 1, amount: st.sinv[p] + call }, Out::End { inv, allin }));
            if rem > facing + 1e-3 && st.raises <= 2 {
                let mut allin_done = false;
                if st.raises == 1 && self.cfg.raise_sizes[st.street as usize] {
                    let target = round_q(self.cfg.raise_mult * st.sinv[o]);
                    let add = target - st.sinv[p];
                    if add > facing && add < self.cfg.allin_ratio * rem {
                        acts.push(bet_to(add, &st, 2));
                    } else if self.cfg.allow_allin {
                        acts.push(bet_to(rem, &st, 3)); // the raise would be (nearly) all-in anyway
                        allin_done = true;
                    }
                }
                if self.cfg.allow_allin && !allin_done {
                    acts.push(bet_to(rem, &st, 3));
                }
            }
        } else {
            let mut inv = st.inv;
            inv[p] += 0.0;
            if st.acted >= 1 {
                acts.push((ActInfo { kind: 1, amount: st.sinv[p] }, Out::End { inv, allin: false }));
            } else {
                acts.push((ActInfo { kind: 1, amount: st.sinv[p] }, Out::Next(St { to_act: o as u8, acted: st.acted + 1, ..st.clone() })));
            }
            let mut seen: Vec<f32> = Vec::new();
            for &f in &self.cfg.bets[st.street as usize].clone() {
                let mut amt = round_q(f * pot_now).max(1.0);
                let mut kind = 2;
                if amt >= self.cfg.allin_ratio * rem {
                    amt = rem;
                    kind = 3;
                    if !self.cfg.allow_allin {
                        continue;
                    }
                }
                if seen.iter().any(|&x| (x - amt).abs() < 1e-3) {
                    continue;
                }
                seen.push(amt);
                acts.push(bet_to(amt, &st, kind));
            }
        }

        let me = self.push(PKind::Fold { winner: 0 }, &st, st.inv);
        let mut infos = Vec::new();
        let mut children = Vec::new();
        for (info, out) in acts {
            let child = match out {
                Out::Fold => self.push(PKind::Fold { winner: o as u8 }, &st, st.inv),
                Out::End { inv, allin } => self.end_street(&st, inv, allin),
                Out::Next(n) => self.node(n),
            };
            infos.push(info);
            children.push(child);
        }
        self.nodes[me as usize].kind = PKind::Decision { player: p as u8, acts: infos, children };
        me
    }
}

pub fn build_tree(cfg: &Config, board: &[u8]) -> Tree {
    assert!((3..=5).contains(&board.len()));
    let mut b = Builder { cfg: cfg.clone(), nodes: Vec::new(), tables: Vec::new(), table_ids: HashMap::new(), flop_runouts: Vec::new(), rng: Rng::new(cfg.seed ^ 0xF10F) };
    let street = (board.len() - 3) as u8;
    let st = St { board: board.to_vec(), street, inv: [0.0, 0.0], sinv: [0.0, 0.0], to_act: 0, raises: 0, acted: 0, chance_p: 1.0 };
    b.node(st);
    Tree { nodes: b.nodes, tables: b.tables, cfg: cfg.clone(), board: board.to_vec() }
}

// ------------------------------------------------------------------ solver

#[derive(Clone, Copy)]
enum Mode {
    Train(f32),
    Eval,
    Br(usize),
}

struct Res {
    v: [Vec<f32>; 2],
    m: [Vec<f32>; 2],
}

impl Res {
    fn zero(mass: bool) -> Res {
        let z = || vec![0f32; NC];
        let zm = || if mass { vec![0f32; NC] } else { Vec::new() };
        Res { v: [z(), z()], m: [zm(), zm()] }
    }
    fn add_scaled(&mut self, o: &Res, w: f32) {
        for p in 0..2 {
            for h in 0..NC {
                self.v[p][h] += w * o.v[p][h];
            }
            if !self.m[p].is_empty() {
                for h in 0..NC {
                    self.m[p][h] += w * o.m[p][h];
                }
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct NodeEval {
    pub player: u8,
    /// the acting player's reach (range weight) at this node
    pub weight: Vec<f32>,
    /// average strategy, na * NC
    pub freq: Vec<f32>,
    /// expected final result per action, in chips, conditional on the hand and on reaching the node
    pub ev: Vec<f32>,
    /// all-in equity against the opponent's range at this node
    pub eq: Vec<f32>,
    /// probability that the line is played (both ranges, chance path included)
    pub reach: f32,
}

pub struct Solver<'a> {
    pub tree: &'a Tree,
    pub regret: Vec<Vec<f32>>,
    pub ssum: Vec<Vec<f32>>,
    pub avg: Vec<Vec<f32>>,
    pub iters: u32,
    /// iteration at which the strategy average was (re)started
    avg_start: u32,
    pub prior: [Vec<f32>; 2],
    extra: HashMap<u64, Strength>,
    z0: f64,
}

impl<'a> Solver<'a> {
    /// `ranges[p][h]` = weight (0..1) of combo `h` in player p's range at the start of the flop.
    pub fn new(tree: &'a Tree, ranges: &[Vec<f32>; 2]) -> Self {
        let fm = mask_of(&tree.board);
        let mut prior = [ranges[0].clone(), ranges[1].clone()];
        for p in 0..2 {
            for h in 0..NC {
                if blocked(fm, h) {
                    prior[p][h] = 0.0;
                }
            }
        }
        let mut regret = Vec::new();
        let mut ssum = Vec::new();
        for n in &tree.nodes {
            if let PKind::Decision { children, .. } = &n.kind {
                regret.push(vec![0f32; children.len() * NC]);
                ssum.push(vec![0f32; children.len() * NC]);
            } else {
                regret.push(Vec::new());
                ssum.push(Vec::new());
            }
        }
        let mut cm = vec![0f32; NC];
        compat_mass(fm, &prior[1], &mut cm);
        let z0: f64 = (0..NC).map(|h| prior[0][h] as f64 * cm[h] as f64).sum();
        Solver { tree, regret, ssum, avg: Vec::new(), iters: 0, avg_start: 0, prior, extra: HashMap::new(), z0 }
    }

    /// Forget the strategy sums (keeps the regrets): early iterations are far from equilibrium and
    /// would otherwise keep dragging the average, so the average is restarted part-way through.
    pub fn reset_average(&mut self) {
        for v in self.ssum.iter_mut() {
            v.iter_mut().for_each(|x| *x = 0.0);
        }
        self.avg_start = self.iters;
    }

    pub fn iterate(&mut self) {
        self.iters += 1;
        let t = (self.iters - self.avg_start) as f32;
        let (r0, r1) = (self.prior[0].clone(), self.prior[1].clone());
        let mut none = Vec::new();
        self.walk(0, &r0, &r1, Mode::Train(t), &mut none, false);
    }

    pub fn finalize_avg(&mut self) {
        self.avg = Vec::with_capacity(self.tree.nodes.len());
        for (i, n) in self.tree.nodes.iter().enumerate() {
            if let PKind::Decision { children, .. } = &n.kind {
                let na = children.len();
                let mut fb = vec![0f32; na * NC];
                regret_match(&self.regret[i], na, NC, &mut fb);
                let mut sg = vec![0f32; na * NC];
                for h in 0..NC {
                    let s: f32 = (0..na).map(|a| self.ssum[i][a * NC + h]).sum();
                    for a in 0..na {
                        sg[a * NC + h] = if s > 1e-20 { self.ssum[i][a * NC + h] / s } else { fb[a * NC + h] };
                    }
                }
                self.avg.push(sg);
            } else {
                self.avg.push(Vec::new());
            }
        }
    }

    /// value of each player at the root under the average strategy (chips, incl. the share of the initial pot)
    pub fn root_values(&mut self) -> [f32; 2] {
        let (r0, r1) = (self.prior[0].clone(), self.prior[1].clone());
        let mut none = Vec::new();
        let res = self.walk(0, &r0, &r1, Mode::Eval, &mut none, true);
        self.value(&res, 0)
    }

    fn value(&self, res: &Res, _unused: usize) -> [f32; 2] {
        let mut out = [0f32; 2];
        for p in 0..2 {
            let num: f64 = (0..NC).map(|h| self.prior[p][h] as f64 * res.v[p][h] as f64).sum();
            let z: f64 = (0..NC).map(|h| self.prior[p][h] as f64 * res.m[p][h] as f64).sum();
            out[p] = if z > 0.0 { (num / z) as f32 } else { 0.0 };
        }
        out
    }

    /// Sum of both best-response gains in chips (0 at equilibrium).
    pub fn exploitability(&mut self) -> f32 {
        let base = self.root_values();
        let mut gain = 0f32;
        for p in 0..2 {
            let (r0, r1) = (self.prior[0].clone(), self.prior[1].clone());
            let mut none = Vec::new();
            let res = self.walk(0, &r0, &r1, Mode::Br(p), &mut none, true);
            let br = self.value(&res, p)[p];
            gain += (br - base[p]).max(0.0);
        }
        gain
    }

    pub fn evaluate(&mut self) -> Vec<Option<NodeEval>> {
        let (r0, r1) = (self.prior[0].clone(), self.prior[1].clone());
        let mut ev: Vec<Option<NodeEval>> = vec![None; self.tree.nodes.len()];
        self.walk(0, &r0, &r1, Mode::Eval, &mut ev, true);
        ev
    }

    /// all-in equity of player `p`'s whole starting range against the other's, on the flop board
    pub fn range_equity(&mut self, p: usize) -> f32 {
        let board = self.tree.board.clone();
        let r_opp = self.prior[1 - p].clone();
        let eq = self.equity_vs(&board, &r_opp);
        let w = &self.prior[p];
        let (mut num, mut den) = (0f64, 0f64);
        for h in 0..NC {
            num += w[h] as f64 * eq[h] as f64;
            den += w[h] as f64;
        }
        if den > 0.0 { (num / den) as f32 } else { 0.5 }
    }

    fn strength_for(&mut self, board5: &[u8]) -> &Strength {
        let key = mask_of(board5);
        self.extra.entry(key).or_insert_with(|| Strength::new(&[board5[0], board5[1], board5[2], board5[3], board5[4]]))
    }

    /// all-in equity of every hand against `r_opp` on the node's board
    fn equity_vs(&mut self, board: &[u8], r_opp: &[f32]) -> Vec<f32> {
        let mut share = vec![0f32; NC];
        let mut mass = vec![0f32; NC];
        let mut s_acc = vec![0f64; NC];
        let mut m_acc = vec![0f64; NC];
        let bm = mask_of(board);
        let mut boards: Vec<Vec<u8>> = Vec::new();
        match board.len() {
            5 => boards.push(board.to_vec()),
            4 => {
                for c in 0..52u8 {
                    if (bm >> c) & 1 == 0 {
                        let mut b = board.to_vec();
                        b.push(c);
                        boards.push(b);
                    }
                }
            }
            _ => {
                let mut rng = Rng::new(99);
                let mut rem: Vec<u8> = (0..52u8).filter(|c| (bm >> c) & 1 == 0).collect();
                for _ in 0..80 {
                    for i in 0..2 {
                        let j = i + rng.below((rem.len() - i) as u32) as usize;
                        rem.swap(i, j);
                    }
                    let mut b = board.to_vec();
                    b.push(rem[0]);
                    b.push(rem[1]);
                    boards.push(b);
                }
            }
        }
        for b in &boards {
            let m5 = mask_of(b);
            let mut r = r_opp.to_vec();
            for h in 0..NC {
                if blocked(m5, h) {
                    r[h] = 0.0;
                }
            }
            let st = self.strength_for(b);
            for &h in &st.order {
                share[h as usize] = 0.0;
                mass[h as usize] = 0.0;
            }
            showdown(st, &r, &mut share, &mut mass);
            for &h in &st.order {
                s_acc[h as usize] += share[h as usize] as f64;
                m_acc[h as usize] += mass[h as usize] as f64;
            }
        }
        (0..NC).map(|h| if m_acc[h] > 0.0 { (s_acc[h] / m_acc[h]) as f32 } else { 0.5 }).collect()
    }

    fn walk(&mut self, ni: usize, r0: &[f32], r1: &[f32], mode: Mode, ev: &mut Vec<Option<NodeEval>>, want_mass: bool) -> Res {
        let tree: &'a Tree = self.tree;
        let node = &tree.nodes[ni];
        let pot_total = tree.cfg.pot + node.inv[0] + node.inv[1];
        let need_mass = want_mass || !matches!(mode, Mode::Train(_));
        match &node.kind {
            PKind::Fold { winner } => {
                let w = *winner as usize;
                let l = 1 - w;
                let bm = mask_of(&node.board);
                let mut res = Res::zero(true);
                let rs = [r0, r1];
                compat_mass(bm, rs[l], &mut res.m[w]);
                compat_mass(bm, rs[w], &mut res.m[l]);
                for h in 0..NC {
                    res.v[w][h] = (pot_total - node.inv[w]) * res.m[w][h];
                    res.v[l][h] = -node.inv[l] * res.m[l][h];
                }
                res
            }
            PKind::Showdown { table } => {
                let st = &tree.tables[*table as usize];
                let mut res = Res::zero(true);
                let rs = [r0, r1];
                let mut share = vec![0f32; NC];
                for p in 0..2 {
                    showdown(st, rs[1 - p], &mut share, &mut res.m[p]);
                    for &h in &st.order {
                        let h = h as usize;
                        res.v[p][h] = pot_total * share[h] - node.inv[p] * res.m[p][h];
                    }
                }
                res
            }
            PKind::AllIn { tables, weight } => {
                let mut res = Res::zero(true);
                let rs = [r0, r1];
                let mut share = vec![0f32; NC];
                let mut mass = vec![0f32; NC];
                let bm = mask_of(&node.board);
                for &ti in tables {
                    let st = &tree.tables[ti as usize];
                    let fresh = st.mask & !bm; // the cards of the run-out
                    for p in 0..2 {
                        let mut r = rs[1 - p].to_vec();
                        for h in 0..NC {
                            if blocked(fresh, h) {
                                r[h] = 0.0;
                            }
                        }
                        showdown(st, &r, &mut share, &mut mass);
                        for &h in &st.order {
                            let h = h as usize;
                            res.v[p][h] += weight * (pot_total * share[h] - node.inv[p] * mass[h]);
                            res.m[p][h] += weight * mass[h];
                        }
                    }
                }
                res
            }
            PKind::Chance { cards, children, weight } => {
                let mut acc = Res::zero(need_mass);
                for (&c, &ch) in cards.iter().zip(children.iter()) {
                    let (a0, a1) = (zero_card(r0, c), zero_card(r1, c));
                    let res = self.walk(ch as usize, &a0, &a1, mode, ev, want_mass);
                    acc.add_scaled(&res, *weight);
                }
                acc
            }
            PKind::Decision { player, children, .. } => {
                let p = *player as usize;
                let o = 1 - p;
                let na = children.len();
                let rp: &[f32] = if p == 0 { r0 } else { r1 };
                let ro: &[f32] = if p == 0 { r1 } else { r0 };
                let mut sigma = vec![0f32; na * NC];
                match mode {
                    Mode::Train(_) => regret_match(&self.regret[ni], na, NC, &mut sigma),
                    Mode::Br(bp) if bp == p => {}
                    _ => sigma.copy_from_slice(&self.avg[ni]),
                }
                let mut cfv_p = vec![0f32; NC];
                let mut cfv_o = vec![0f32; NC];
                let mut m_p = if need_mass { vec![0f32; NC] } else { Vec::new() };
                let mut m_o = if need_mass { vec![0f32; NC] } else { Vec::new() };
                let mut child_p: Vec<Vec<f32>> = Vec::with_capacity(na);
                let mut best: Option<Vec<f32>> = None;
                for a in 0..na {
                    let new_rp: Vec<f32> = (0..NC).map(|h| rp[h] * sigma[a * NC + h]).collect();
                    let res = if p == 0 { self.walk(children[a] as usize, &new_rp, ro, mode, ev, want_mass) } else { self.walk(children[a] as usize, ro, &new_rp, mode, ev, want_mass) };
                    for h in 0..NC {
                        cfv_o[h] += res.v[o][h];
                    }
                    if need_mass {
                        for h in 0..NC {
                            m_o[h] += res.m[o][h];
                        }
                        if a == 0 {
                            m_p.copy_from_slice(&res.m[p]);
                        }
                    }
                    match mode {
                        Mode::Br(bp) if bp == p => {
                            let b = best.get_or_insert_with(|| vec![f32::MIN; NC]);
                            for h in 0..NC {
                                b[h] = b[h].max(res.v[p][h]);
                            }
                        }
                        _ => {
                            for h in 0..NC {
                                cfv_p[h] += sigma[a * NC + h] * res.v[p][h];
                            }
                        }
                    }
                    child_p.push(res.v[p].clone());
                }
                if let Some(b) = best {
                    cfv_p = b;
                }
                match mode {
                    Mode::Train(t) => {
                        for a in 0..na {
                            for h in 0..NC {
                                let i = a * NC + h;
                                self.regret[ni][i] = (self.regret[ni][i] + child_p[a][h] - cfv_p[h]).max(0.0);
                                self.ssum[ni][i] += t * rp[h] * sigma[i];
                            }
                        }
                    }
                    Mode::Eval if ev.len() == tree.nodes.len() => {
                        let mut e = NodeEval { player: p as u8, weight: rp.to_vec(), freq: sigma.clone(), ..Default::default() };
                        e.ev = vec![0f32; na * NC];
                        for a in 0..na {
                            for h in 0..NC {
                                e.ev[a * NC + h] = if m_p[h] > 1e-12 { child_p[a][h] / m_p[h] } else { 0.0 };
                            }
                        }
                        let mut cm = vec![0f32; NC];
                        compat_mass(mask_of(&node.board), ro, &mut cm);
                        let pair: f64 = (0..NC).map(|h| rp[h] as f64 * cm[h] as f64).sum();
                        e.reach = (node.chance_p as f64 * pair / self.z0.max(1e-30)) as f32;
                        if e.reach > 1e-5 {
                            e.eq = self.equity_vs(&node.board, ro);
                        }
                        ev[ni] = Some(e);
                    }
                    _ => {}
                }
                let mut res = Res::zero(false);
                res.v[p] = cfv_p;
                res.v[o] = cfv_o;
                if need_mass {
                    res.m[p] = m_p;
                    res.m[o] = m_o;
                } else {
                    res.m = [Vec::new(), Vec::new()];
                }
                res
            }
        }
    }
}

// ------------------------------------------------------------------ summary statistics

/// combo weighted action mix of a decision node: (action kinds, amounts, mix)
pub fn node_mix(tree: &Tree, ev: &[Option<NodeEval>], node: usize) -> Option<(Vec<ActInfo>, Vec<f32>)> {
    if let PKind::Decision { acts, .. } = &tree.nodes[node].kind {
        let e = ev[node].as_ref()?;
        let na = acts.len();
        let mut mix = vec![0f64; na];
        let mut tot = 0f64;
        for h in 0..NC {
            let w = e.weight[h] as f64;
            tot += w;
            for a in 0..na {
                mix[a] += w * e.freq[a * NC + h] as f64;
            }
        }
        if tot <= 0.0 {
            return None;
        }
        return Some((acts.clone(), mix.iter().map(|x| (*x / tot) as f32).collect()));
    }
    None
}

/// the flop level numbers used by the aggregate report (JSON object text)
pub fn flop_stats(tree: &Tree, ev: &[Option<NodeEval>], eq_oop: f32, eq_ip: f32, expl_pct: f32) -> String {
    let fmt = |v: &[f32]| v.iter().map(|x| format!("{:.4}", x)).collect::<Vec<_>>().join(",");
    let mut s = format!("{{\"eqOop\":{:.4},\"eqIp\":{:.4},\"exploit\":{:.3}", eq_oop, eq_ip, expl_pct);
    if let Some((acts, mix)) = node_mix(tree, ev, 0) {
        let kinds: Vec<String> = acts.iter().map(|a| format!("[{},{:.2}]", a.kind, a.amount)).collect();
        s += &format!(",\"oopActs\":[{}],\"oop\":[{}]", kinds.join(","), fmt(&mix));
        if let PKind::Decision { children, .. } = &tree.nodes[0].kind {
            // IP's decision after OOP checks (first action = check)
            let c = children[0] as usize;
            if let Some((acts2, mix2)) = node_mix(tree, ev, c) {
                let kinds2: Vec<String> = acts2.iter().map(|a| format!("[{},{:.2}]", a.kind, a.amount)).collect();
                s += &format!(",\"ipActs\":[{}],\"ipVsCheck\":[{}]", kinds2.join(","), fmt(&mix2));
            }
        }
    }
    s.push('}');
    s
}

// ------------------------------------------------------------------ export

/// EV loss code: 1/64 bb steps up to 3.1 bb, then 1 bb steps (up to ~58 bb)
pub fn encode_loss(loss: f32) -> u8 {
    let l = loss.max(0.0);
    if l < 3.125 {
        (l * 64.0).round() as u8
    } else {
        (200.0 + (l - 3.125).round()).min(255.0) as u8
    }
}

pub fn decode_loss(c: u8) -> f32 {
    if c < 200 {
        c as f32 / 64.0
    } else {
        3.125 + (c - 200) as f32
    }
}

/// Binary file for one flop (see docs/03-solution-format.md, "TSP1").
pub fn export(tree: &Tree, ev: &[Option<NodeEval>], min_reach: f32) -> Vec<u8> {
    // keep decision nodes that are played, chance nodes that lead to something kept
    let n = tree.nodes.len();
    let mut keep = vec![false; n];
    fn mark(t: &Tree, ev: &[Option<NodeEval>], i: usize, min: f32, keep: &mut Vec<bool>) -> bool {
        match &t.nodes[i].kind {
            PKind::Decision { children, .. } => {
                let ok = ev[i].as_ref().map(|e| e.reach >= min).unwrap_or(false);
                if !ok {
                    return false;
                }
                keep[i] = true;
                for &c in children {
                    mark(t, ev, c as usize, min, keep);
                }
                true
            }
            PKind::Chance { children, .. } => {
                let mut any = false;
                for &c in children {
                    any |= mark(t, ev, c as usize, min, keep);
                }
                keep[i] = any;
                any
            }
            _ => false,
        }
    }
    mark(tree, ev, 0, min_reach, &mut keep);

    let mut order = Vec::new();
    let mut id = vec![-1i32; n];
    fn dfs(t: &Tree, keep: &[bool], i: usize, order: &mut Vec<usize>, id: &mut Vec<i32>) {
        if !keep[i] {
            return;
        }
        id[i] = order.len() as i32;
        order.push(i);
        match &t.nodes[i].kind {
            PKind::Decision { children, .. } | PKind::Chance { children, .. } => {
                for &c in children {
                    dfs(t, keep, c as usize, order, id);
                }
            }
            _ => {}
        }
    }
    dfs(tree, &keep, 0, &mut order, &mut id);

    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(b"TSP1");
    b.push(2);
    b.push(tree.board.len() as u8);
    b.extend_from_slice(&tree.board);
    b.extend_from_slice(&tree.cfg.pot.to_le_bytes());
    b.extend_from_slice(&tree.cfg.stack.to_le_bytes());
    b.extend_from_slice(&(order.len() as u16).to_le_bytes());
    let child_code = |c: u32| -> i32 {
        let ci = c as usize;
        if keep[ci] {
            return id[ci];
        }
        match &tree.nodes[ci].kind {
            PKind::Fold { .. } => -1,
            PKind::Showdown { .. } => -3,
            PKind::AllIn { .. } => -4,
            _ => -2,
        }
    };
    for &i in &order {
        let node = &tree.nodes[i];
        b.push(node.street);
        b.extend_from_slice(&node.inv[0].to_le_bytes());
        b.extend_from_slice(&node.inv[1].to_le_bytes());
        match &node.kind {
            PKind::Decision { player, acts, children } => {
                let e = ev[i].as_ref().unwrap();
                b.push(0);
                b.push(*player);
                b.extend_from_slice(&e.reach.to_le_bytes());
                b.push(children.len() as u8);
                for (a, &c) in acts.iter().zip(children.iter()) {
                    b.push(a.kind);
                    b.extend_from_slice(&a.amount.to_le_bytes());
                    b.extend_from_slice(&child_code(c).to_le_bytes());
                }
                let na = children.len();
                // sparse: a bitmap of the hands that are in the range at this node, then per-hand arrays
                let hands: Vec<usize> = (0..NC).filter(|&h| e.weight[h] >= 0.01).collect();
                let mut bitmap = vec![0u8; (NC + 7) / 8];
                for &h in &hands {
                    bitmap[h / 8] |= 1 << (h % 8);
                }
                b.extend_from_slice(&bitmap);
                for &h in &hands {
                    b.push((e.weight[h].clamp(0.0, 1.0) * 255.0).round() as u8);
                }
                for &h in &hands {
                    b.push((e.eq.get(h).copied().unwrap_or(0.5).clamp(0.0, 1.0) * 255.0).round() as u8);
                }
                let mut fq = vec![0u8; na * hands.len()];
                for (j, &h) in hands.iter().enumerate() {
                    let f: Vec<f32> = (0..na).map(|a| e.freq[a * NC + h]).collect();
                    let q = crate::preflop::quantize_freq(&f);
                    for a in 0..na {
                        fq[a * hands.len() + j] = q[a];
                    }
                }
                b.extend_from_slice(&fq);
                // EV: best action's EV (i16, 1/64 bb) + per-action loss against it (u8, non-linear)
                let mut losses = vec![0u8; na * hands.len()];
                for &h in &hands {
                    let best = (0..na).map(|a| e.ev[a * NC + h]).fold(f32::MIN, f32::max);
                    b.extend_from_slice(&((best * 64.0).round().clamp(-32000.0, 32000.0) as i16).to_le_bytes());
                }
                for (j, &h) in hands.iter().enumerate() {
                    let best = (0..na).map(|a| e.ev[a * NC + h]).fold(f32::MIN, f32::max);
                    for a in 0..na {
                        losses[a * hands.len() + j] = encode_loss(best - e.ev[a * NC + h]);
                    }
                }
                b.extend_from_slice(&losses);
            }
            PKind::Chance { cards, children, .. } => {
                b.push(1);
                b.push(255);
                b.extend_from_slice(&1f32.to_le_bytes());
                b.push(children.len() as u8);
                for (&card, &c) in cards.iter().zip(children.iter()) {
                    b.push(card);
                    b.extend_from_slice(&0f32.to_le_bytes());
                    b.extend_from_slice(&child_code(c).to_le_bytes());
                }
            }
            _ => unreachable!(),
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(s: &str) -> u8 {
        let b = s.as_bytes();
        let r = b"23456789TJQKA".iter().position(|&x| x == b[0]).unwrap() as u8;
        let su = b"cdhs".iter().position(|&x| x == b[1]).unwrap() as u8;
        r * 4 + su
    }
    fn board(s: &str) -> Vec<u8> {
        s.split_whitespace().map(card).collect()
    }
    fn combo(a: &str, b: &str) -> usize {
        ct().index(card(a), card(b))
    }

    #[test]
    fn combo_table_is_consistent() {
        let t = ct();
        assert_eq!(t.cards.len(), NC);
        for (i, &(a, b)) in t.cards.iter().enumerate() {
            assert!(a < b);
            assert_eq!(t.index(a, b), i);
            assert_eq!(t.index(b, a), i);
        }
        assert!(t.by_card.iter().all(|v| v.len() == 51));
    }

    /// the O(n) showdown with card removal must equal brute force
    #[test]
    fn showdown_matches_brute_force() {
        let b = board("Ah Kd 7c 2s 3d");
        let b5: [u8; 5] = [b[0], b[1], b[2], b[3], b[4]];
        let st = Strength::new(&b5);
        let mut rng = Rng::new(3);
        let bm = mask_of(&b);
        let r: Vec<f32> = (0..NC).map(|h| if blocked(bm, h) { 0.0 } else { (rng.below(5) as f32) / 4.0 }).collect();
        let mut share = vec![0f32; NC];
        let mut mass = vec![0f32; NC];
        showdown(&st, &r, &mut share, &mut mass);
        let cards = &ct().cards;
        let strength: Vec<u32> = (0..NC)
            .map(|h| if blocked(bm, h) { 0 } else { eval7(&[cards[h].0, cards[h].1, b[0], b[1], b[2], b[3], b[4]]) })
            .collect();
        for h in (0..NC).step_by(7) {
            if blocked(bm, h) {
                continue;
            }
            let (mut s, mut m) = (0f64, 0f64);
            for o in 0..NC {
                if blocked(bm, o) || cards[o].0 == cards[h].0 || cards[o].0 == cards[h].1 || cards[o].1 == cards[h].0 || cards[o].1 == cards[h].1 {
                    continue;
                }
                m += r[o] as f64;
                s += r[o] as f64 * if strength[h] > strength[o] { 1.0 } else if strength[h] == strength[o] { 0.5 } else { 0.0 };
            }
            assert!((share[h] as f64 - s).abs() < 1e-3, "share {} vs {}", share[h], s);
            assert!((mass[h] as f64 - m).abs() < 1e-3, "mass {} vs {}", mass[h], m);
        }
        let mut cm = vec![0f32; NC];
        compat_mass(bm, &r, &mut cm);
        for h in (0..NC).step_by(11) {
            if !blocked(bm, h) {
                assert!((cm[h] - mass[h]).abs() < 1e-3);
            }
        }
    }

    fn river_cfg() -> Config {
        Config { pot: 10.0, stack: 1000.0, bets: [vec![], vec![], vec![0.75]], raise_sizes: [false; 3], allow_allin: false, ..Config::default() }
    }

    fn range_of(list: &[(&str, &str, f32)]) -> Vec<f32> {
        let mut v = vec![0f32; NC];
        for &(a, b, w) in list {
            v[combo(a, b)] = w;
        }
        v
    }

    /// Clairvoyant river game: OOP holds the nuts or air, IP holds a bluff catcher.
    /// Equilibrium (pot P, bet b): air bluffs with  b*w_n / (w_a*(P+b)), IP calls with P/(P+b).
    #[test]
    fn river_clairvoyant_game_matches_theory() {
        let b = board("Ah 8d 7c 2s 3d");
        // nuts: AA (set of aces beats QQ);  air: 6c5c-like junk;  IP: QQ
        let nuts: Vec<(&str, &str, f32)> = vec![("Ad", "Ac", 1.0), ("Ad", "As", 1.0), ("Ac", "As", 1.0)];
        let air: Vec<(&str, &str, f32)> = vec![("6c", "5c", 1.0), ("6d", "5d", 1.0), ("6h", "5h", 1.0), ("6s", "5s", 1.0), ("9c", "4c", 1.0), ("9d", "4h", 1.0)];
        let qq: Vec<(&str, &str, f32)> = vec![("Qc", "Qd", 1.0), ("Qc", "Qh", 1.0), ("Qc", "Qs", 1.0), ("Qd", "Qh", 1.0), ("Qd", "Qs", 1.0), ("Qh", "Qs", 1.0)];
        let mut oop: Vec<(&str, &str, f32)> = nuts.clone();
        oop.extend(air.clone());
        let tree = build_tree(&river_cfg(), &b);
        let mut s = Solver::new(&tree, &[range_of(&oop), range_of(&qq)]);
        for _ in 0..3000 {
            s.iterate();
        }
        s.finalize_avg();
        let expl = s.exploitability();
        assert!(expl < 0.02 * 10.0, "exploitability {} chips", expl);

        // node 0 = OOP root: actions [check, bet 7.5]; the IP node after the bet is node 3
        let (bet_size, pot) = (7.5f32, 10.0f32);
        let (wn, wa) = (nuts.len() as f32, air.len() as f32);
        let bluff_theory = bet_size * wn / (wa * (pot + bet_size));
        let call_theory = pot / (pot + bet_size);
        let root = &s.avg[0];
        let bet_nuts: f32 = nuts.iter().map(|&(x, y, _)| root[NC + combo(x, y)]).sum::<f32>() / wn;
        let bluff: f32 = air.iter().map(|&(x, y, _)| root[NC + combo(x, y)]).sum::<f32>() / wa;
        assert!(bet_nuts > 0.97, "nuts always bet: {}", bet_nuts);
        assert!((bluff - bluff_theory).abs() < 0.04, "bluff {} vs theory {}", bluff, bluff_theory);
        // IP facing the bet
        let facing = tree.nodes.iter().position(|n| matches!(&n.kind, PKind::Decision { player: 1, acts, .. } if acts.len() == 2 && acts[0].kind == 0)).unwrap();
        let ipn = &s.avg[facing];
        let call: f32 = qq.iter().map(|&(x, y, _)| ipn[NC + combo(x, y)]).sum::<f32>() / 6.0;
        assert!((call - call_theory).abs() < 0.04, "call {} vs theory {}", call, call_theory);
    }

    /// full three-street solve on a tiny abstraction converges (low exploitability)
    #[test]
    fn three_street_solve_converges() {
        let b = board("Ks 7d 2c");
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 2, river_cards: 1, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &b);
        let mk = |list: &[(&str, &str)]| -> Vec<f32> { range_of(&list.iter().map(|&(a, b)| (a, b, 1.0)).collect::<Vec<_>>()) };
        let mut oop = Vec::new();
        let mut ip = Vec::new();
        let cards = &ct().cards;
        // OOP: pairs and broadways; IP: pairs and suited connectors (rough but varied)
        for (i, &(a, b)) in cards.iter().enumerate() {
            let (ra, rb) = (a >> 2, b >> 2);
            if ra == rb {
                oop.push(i);
                ip.push(i);
            } else if ra >= 8 && rb >= 8 {
                oop.push(i);
            } else if (a & 3) == (b & 3) && ra.abs_diff(rb) == 1 {
                ip.push(i);
            }
        }
        let mut r0 = vec![0f32; NC];
        let mut r1 = vec![0f32; NC];
        for i in oop {
            r0[i] = 1.0;
        }
        for i in ip {
            r1[i] = 1.0;
        }
        let _ = mk;
        let mut s = Solver::new(&tree, &[r0, r1]);
        for _ in 0..400 {
            s.iterate();
        }
        s.finalize_avg();
        let e = s.exploitability();
        let v = s.root_values();
        assert!((v[0] + v[1] - 6.0).abs() < 0.05, "constant sum: {:?}", v);
        assert!(e < 0.04 * 6.0, "exploitability {} chips of a 6 chip pot", e);
    }

    #[test]
    fn allin_equity_matches_enumeration() {
        // AhAd vs KhKd on 2c 7d 9s: all-in equity by exact enumeration of the run-outs
        let b = board("2c 7d 9s");
        let cfg = Config { flop_runouts: 1176, ..Config::default() };
        let tree = build_tree(&cfg, &b);
        let mut s = Solver::new(&tree, &[vec![0.0; NC], vec![0.0; NC]]);
        let mut r_opp = vec![0f32; NC];
        r_opp[combo("Kh", "Kd")] = 1.0;
        let eq = s.equity_vs(&b, &r_opp);
        // brute force
        let (aa, kk) = ([card("Ah"), card("Ad")], [card("Kh"), card("Kd")]);
        let mut rem: Vec<u8> = (0..52u8).filter(|c| !b.contains(c) && !aa.contains(c) && !kk.contains(c)).collect();
        rem.sort();
        let (mut win, mut tot) = (0.0, 0.0);
        for i in 0..rem.len() {
            for j in (i + 1)..rem.len() {
                let full = [b[0], b[1], b[2], rem[i], rem[j]];
                let a7 = eval7(&[aa[0], aa[1], full[0], full[1], full[2], full[3], full[4]]);
                let k7 = eval7(&[kk[0], kk[1], full[0], full[1], full[2], full[3], full[4]]);
                tot += 1.0;
                win += if a7 > k7 { 1.0 } else if a7 == k7 { 0.5 } else { 0.0 };
            }
        }
        let exact = win / tot;
        let got = eq[combo("Ah", "Ad")] as f64;
        // the flop estimate uses 80 sampled run-outs: ~±4%
        assert!((got - exact).abs() < 0.06, "equity {} vs exact {}", got, exact);
        assert!(exact > 0.85 && exact < 0.95);
    }
}
