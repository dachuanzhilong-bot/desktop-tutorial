//! Heads-up postflop solver (flop -> turn -> river) over the 1,326 starting hands.
//!
//! * vector-form CFR+ (linear averaging), two players: 0 = out of position, 1 = in position
//! * chance nodes use a *stratified sample* of the turn / river cards; each sampled card carries the
//!   weight `(N_rem / K) / (N_rem - 4)` so that the sample is an unbiased estimate of the full deal
//! * all-in before the river is valued over the real run-outs (turn: all rivers, flop: a fixed sample)
//! * river showdowns are O(n): hands sorted by strength + prefix sums, with exact card removal
//!
//! Payoffs are "share of the final pot minus chips put in postflop"; the initial pot `pot` therefore
//! belongs to nobody, and `v0 + v1 = pot` at every terminal (constant sum).  With rake (`Config::rake_pct`,
//! REFACTOR_PLAN 3-2) the rake of each terminal leaves the pot first: `v0 + v1 = pot - rake` (`Config::pot_paid`).
use crate::engine::regret_match;
use crate::eval::eval7;
use crate::river::{self, RiverPlans, RiverWalk, SubScratch, SubTrain};
use crate::rng::Rng;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

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

/// `r` with the combos holding `card` set to 0 (the walk deals a card this way)
pub fn zero_card(r: &[f32], card: u8) -> Vec<f32> {
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
    /// rake in % of the pot at every terminal (they have all seen the flop; REFACTOR_PLAN 3-2, `rake.rs`); 0 = no rake
    pub rake_pct: f32,
    /// at most this many bb of rake (`rake::NO_CAP` = no cap)
    pub rake_cap: f32,
}

impl Config {
    /// The pot a terminal with investments `inv` pays out: the pot before the flop, both investments, minus the rake
    /// of the pot the winner takes (the pot before the flop plus what both matched; a bet nobody called goes back to
    /// the bettor and is not raked).  Without rake it is `pot + inv0 + inv1`, bit for bit (`x - 0.0 == x`).
    #[inline]
    pub fn pot_paid(&self, inv: [f32; 2]) -> f32 {
        let total = self.pot + inv[0] + inv[1];
        total - crate::rake::amount(self.pot + 2.0 * inv[0].min(inv[1]), self.rake_pct, self.rake_cap)
    }
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
            rake_pct: 0.0,
            rake_cap: crate::rake::NO_CAP,
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

/// How an iteration updates the regrets and strategy sums (REFACTOR_PLAN 4-1, `docs/15` §2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Update {
    /// CFR+ with simultaneous updates: one walk per iteration updates both players (the solver as it always was).
    #[default]
    SimCfrPlus,
    /// CFR+ with alternating updates: two walks per iteration, the first updates OOP's regrets and strategy sums
    /// against IP's current strategy, the second IP's against OOP's new one.
    AltCfrPlus,
    /// Discounted CFR (alpha 1.5, beta 0, gamma 2) with alternating updates: before iteration t adds its regrets, a
    /// positive regret is multiplied by (t-1)^1.5 / ((t-1)^1.5 + 1), a negative one by 1/2, and the strategy sums by
    /// ((t-1)/t)^2; the strategy sums add the reach-weighted strategy with weight 1 (no linear weight).  Negative
    /// regrets are kept (regret matching uses the positive part).
    AltDcfr,
}

impl Update {
    /// the name of `gen_postflop` / `measure_exploit`'s `--update`
    pub fn name(self) -> &'static str {
        match self {
            Update::SimCfrPlus => "sim-cfr+",
            Update::AltCfrPlus => "alt-cfr+",
            Update::AltDcfr => "alt-dcfr",
        }
    }

    pub fn parse(s: &str) -> Option<Update> {
        [Update::SimCfrPlus, Update::AltCfrPlus, Update::AltDcfr].into_iter().find(|u| u.name() == s)
    }

    /// walks of the tree per iteration
    pub fn walks(self) -> u32 {
        if self == Update::SimCfrPlus { 1 } else { 2 }
    }
}

/// The DCFR discounts of iteration `t` (1, 2, ...): (positive regrets, negative regrets, strategy sums).
pub fn dcfr_discounts(t: u32) -> (f32, f32, f32) {
    let tm = (t - 1) as f32;
    let ta = tm.powf(1.5);
    (ta / (ta + 1.0), 0.5, (tm / (tm + 1.0)).powi(2))
}

/// Options of a `Solver` that do not change the tree.
#[derive(Clone, Copy, Debug)]
pub struct SolverOptions {
    /// Decision nodes of this street and later keep no strategy average (no `ssum`, no `avg`):
    /// 0 flop, 1 turn, 2 river, 3 (default) = every street keeps one.  Plan B of REFACTOR_PLAN 3-3
    /// re-solves the river on the device, so the precomputation needs no river average (`no_average_from: 2`).
    /// See `Solver` for how such nodes are evaluated and exported.
    pub no_average_from: u8,
    /// Threads that walk the tree (REFACTOR_PLAN 3-3-2); 1 (default) = the calling thread only.
    /// With more, the children of the first chance node met on the way down (on a flop tree: the turn card
    /// subtrees under each flop chance node; on a turn tree: the river cards) are walked in parallel, and their
    /// results are added in card order as before, so every result is bit for bit that of 1 thread.
    /// Always 1 on wasm32 (no threads there).
    pub threads: usize,
    /// Decision nodes of this street and later that keep a strategy average get no `avg` array from
    /// `finalize_avg`: wherever their average strategy is used, it is computed on the spot from their strategy
    /// sums (`ssum`), with the same arithmetic as `finalize_avg`, so every value is bit for bit that of the
    /// stored `avg` (REFACTOR_PLAN 3-3-3: the river average of a 49 x 48 tree, `na x 1,326` per node, would
    /// not fit in memory; its `ssum` on the support does).  3 (default) = `finalize_avg` fills every node.
    pub avg_on_demand_from: u8,
    /// Training with a tremble on the flop and turn (`docs/14` §8-6; 0 (default) = none, the solver as it was).
    /// While training, an unlocked flop / turn decision node whose regret-matched strategy is `sigma` plays
    /// `sigma' = (1 - tremble) sigma + tremble u` (`tremble_strategy`: `u` uniform over check / call and
    /// bet / raise): the reach passed down and the value passed up are those of `sigma'`, so every line is
    /// reached by a slice of each player's whole range in every iteration and its strategies are trained
    /// against real ranges.  The regrets compare each action with `sigma` (the part the player chooses), and
    /// the strategy sums add `sigma`, so `avg` is the average of the chosen part: the strategy with the tremble
    /// taken off.  River nodes never tremble, and `exploitability` / `root_values` / `evaluate` play the
    /// averages as they are, without a tremble.
    pub tremble: f32,
    /// how an iteration updates (`Update`; the default is the solver as it always was)
    pub update: Update,
}

impl Default for SolverOptions {
    fn default() -> Self {
        SolverOptions { no_average_from: 3, threads: 1, avg_on_demand_from: 3, tremble: 0.0, update: Update::SimCfrPlus }
    }
}

/// Vector-form CFR+ over a `Tree`.
///
/// **Storage (REFACTOR_PLAN 3-3-1).**  A decision node keeps its regrets and strategy sums only for the
/// node's *support*: the combos that are in the acting player's starting range (`prior != 0`) and do not
/// collide with the node's board.  Every other combo has reach 0 at the node, so it never changes a value of
/// the other combos; for a combo on the board the full-width solver also kept regret 0 (uniform strategy),
/// which is what the solver uses for it.  `regret[node]` / `ssum[node]` are laid out as `na * k`
/// (action-major, `k` = the support's size, the combos in `supports[support_of[node]]` order).
/// The arithmetic on the support is the full-width solver's, in the same order, so the results are bit
/// for bit the same (tests `*_results_match_the_full_width_solver`).  For combos outside the starting range
/// the strategy reported by `avg` / `evaluate` is uniform (the full-width solver reported the regret-matched
/// mix of regrets that such a combo could never act on); they have weight 0 everywhere.
///
/// **Averages on demand** (`SolverOptions::avg_on_demand_from`): such a node keeps its `ssum` but `avg[node]` stays
/// empty; the walk computes the average from `ssum` (`average_strategy`) whenever it needs it.  The same happens
/// for any node with an average whose `avg` entry is empty (e.g. before `finalize_avg`).
///
/// **Nodes without an average** (`SolverOptions::no_average_from`): `ssum[node]` and `avg[node]` are empty.
/// Where the average strategy would be used (`exploitability`, `root_values`, `evaluate`, the opponent of a
/// best response) these nodes play the current strategy (regret matching of the regrets), and `evaluate`
/// returns `None` for them, so `export` writes no node of those streets (their parents point at a pruned
/// subtree, code -2, as for an unplayed line).
pub struct Solver<'a> {
    pub tree: &'a Tree,
    /// per decision node, `na * k` over the node's support (see above); empty for other nodes
    pub regret: Vec<Vec<f32>>,
    /// per decision node, `na * k` over the node's support; empty for other nodes and nodes without an average
    pub ssum: Vec<Vec<f32>>,
    /// average strategy per decision node, `na * NC` (filled by `finalize_avg`, or set by the caller);
    /// empty for other nodes and nodes without an average
    pub avg: Vec<Vec<f32>>,
    pub iters: u32,
    /// iteration at which the strategy average was (re)started
    avg_start: u32,
    /// node-locking: a fixed strategy (na * NC) for a decision node; the node is then never updated
    locks: Vec<Option<Vec<f32>>>,
    pub prior: [Vec<f32>; 2],
    /// supports shared by the nodes of the same player and board: ascending combo indices
    pub supports: Arc<Vec<Vec<u16>>>,
    /// per node, the index into `supports` (`u32::MAX` for a node that is not a decision)
    pub support_of: Vec<u32>,
    /// per node: does it keep a strategy average
    has_avg: Vec<bool>,
    /// per node, one past the last node of its subtree (the tree is built depth first, so a subtree is the
    /// node range `i..subtree_end[i]` and the children of a node own consecutive ranges)
    subtree_end: Vec<u32>,
    /// `SolverOptions::threads`
    threads: usize,
    /// `SolverOptions::avg_on_demand_from`
    avg_on_demand_from: u8,
    /// `SolverOptions::tremble`
    tremble: f32,
    /// nodes of this street and later play their current strategy where the average would be used, even if they
    /// keep one (`set_current_strategy_from`; 3 = never)
    current_from: u8,
    /// `set_br_forbidden`: per node, the actions a best response may not choose (bit `a`); empty = none
    br_forbid: Vec<u64>,
    /// `evaluate_upstream`: `evaluate` fills the nodes of the streets before this one only (3 = all)
    eval_below: u8,
    extra: HashMap<u64, Strength>,
    z0: f64,
    /// the training walk of a river tree (`river.rs`, REFACTOR_PLAN 3-3-4); `None` for other trees
    river: Option<Box<RiverWalk>>,
    /// `SolverOptions::update` (`set_update` changes it)
    update: Update,
    /// during an alternating walk: the player whose regrets and strategy sums it updates
    train_only: Option<usize>,
    /// during a DCFR walk: `dcfr_discounts` of the iteration
    dcfr: Option<(f32, f32, f32)>,
    /// the river subtrees of a tree with chance nodes and their boards (REFACTOR_PLAN 4-2); `None` for other trees
    river_plans: Option<Arc<RiverPlans>>,
    /// training walks take the river subtree walk where they can (default; `set_river_subtree_walk`)
    river_subtree_walk: bool,
    /// the showdowns of an all-in with many run-outs, computed on the threads (REFACTOR_PLAN 4-3); kept between walks
    allin_buf: std::sync::Mutex<Vec<f32>>,
    /// tests: an alternating walk computes the other player's values too (they are not used; see `Shared::train_only`)
    #[cfg(test)]
    alt_full_values: bool,
}

/// `sigma` (`na * NC`) from the regrets of a support (`na * k`): regret matching on the support,
/// uniform elsewhere (what regret matching gives for zero regrets).
fn current_strategy(regret: &[f32], na: usize, support: &[u16], sigma: &mut [f32]) {
    let k = support.len();
    let mut sc = vec![0f32; na * k];
    regret_match(regret, na, k, &mut sc);
    sigma.iter_mut().for_each(|x| *x = 1.0 / na as f32);
    for a in 0..na {
        for (j, &h) in support.iter().enumerate() {
            sigma[a * NC + h as usize] = sc[a * k + j];
        }
    }
}

/// The average strategy (`na * NC`) of a node from its regrets and strategy sums (both `na * k` over the
/// support): the normalized strategy sums, and the current strategy for a hand without strategy sums.
/// `finalize_avg` and the averages made on demand (`SolverOptions::avg_on_demand_from`) both use this.
fn average_strategy(regret: &[f32], ssum: &[f32], na: usize, support: &[u16], sigma: &mut [f32]) {
    current_strategy(regret, na, support, sigma);
    let k = support.len();
    for (j, &h) in support.iter().enumerate() {
        let h = h as usize;
        let s: f32 = (0..na).map(|a| ssum[a * k + j]).sum();
        if s > 1e-20 {
            for a in 0..na {
                sigma[a * NC + h] = ssum[a * k + j] / s;
            }
        }
    }
}

/// The starting ranges of a solver of `tree` (`Solver::prior`): `ranges` with the combos on the tree's board set to 0.
pub fn starting_prior(tree: &Tree, ranges: &[Vec<f32>; 2]) -> [Vec<f32>; 2] {
    let fm = mask_of(&tree.board);
    let mut prior = [ranges[0].clone(), ranges[1].clone()];
    for p in 0..2 {
        for h in 0..NC {
            if blocked(fm, h) {
                prior[p][h] = 0.0;
            }
        }
    }
    prior
}

/// The supports of a solver of `tree` with starting ranges `prior` (`Solver::supports`, `Solver::support_of`): per
/// decision node, the combos of the acting player's starting range that do not collide with the node's board,
/// shared by the nodes of the same player and board (`u32::MAX` for a node that is not a decision).
pub fn decision_supports(tree: &Tree, prior: &[Vec<f32>; 2]) -> (Vec<Vec<u16>>, Vec<u32>) {
    let mut supports: Vec<Vec<u16>> = Vec::new();
    let mut support_ids: HashMap<(u8, u64), u32> = HashMap::new();
    let mut support_of = Vec::with_capacity(tree.nodes.len());
    for n in &tree.nodes {
        if let PKind::Decision { player, .. } = &n.kind {
            let bm = mask_of(&n.board);
            let sid = *support_ids.entry((*player, bm)).or_insert_with(|| {
                let pr = &prior[*player as usize];
                supports.push((0..NC).filter(|&h| pr[h] != 0.0 && !blocked(bm, h)).map(|h| h as u16).collect());
                (supports.len() - 1) as u32
            });
            support_of.push(sid);
        } else {
            support_of.push(u32::MAX);
        }
    }
    (supports, support_of)
}

/// `sum_h r0[h] * (r1's mass of the combos compatible with h on `board`)`: the (unnormalized) probability that both
/// players hold hands with these reaches.  At the root it is the normalizer of `NodeEval::reach`.
pub fn pair_mass(board: &[u8], r0: &[f32], r1: &[f32]) -> f64 {
    let mut cm = vec![0f32; NC];
    compat_mass(mask_of(board), r1, &mut cm);
    (0..NC).map(|h| r0[h] as f64 * cm[h] as f64).sum()
}

/// A strategy (`na * NC`) as `Solver::lock_node` plays it: each hand's row with the negative entries set to 0, divided
/// by its sum (uniform when the sum is about 0).
/// `sigma` (`na * NC`, the actions `acts`) with a tremble: for every hand `(1 - eps) sigma + eps u`, `u` uniform
/// over the actions that keep the hand going (check / call and bet / raise; not fold, not all-in).
pub fn tremble_strategy(sigma: &mut [f32], acts: &[ActInfo], eps: f32) {
    let going = acts.iter().filter(|a| a.kind == 1 || a.kind == 2).count();
    for (a, act) in acts.iter().enumerate() {
        let add = if act.kind == 1 || act.kind == 2 { eps / going as f32 } else { 0.0 };
        for x in &mut sigma[a * NC..(a + 1) * NC] {
            *x = (1.0 - eps) * *x + add;
        }
    }
}

pub fn normalize_strategy(strategy: Vec<f32>, na: usize) -> Vec<f32> {
    let mut s = strategy;
    for h in 0..NC {
        let sum: f32 = (0..na).map(|a| s[a * NC + h].max(0.0)).sum();
        for a in 0..na {
            s[a * NC + h] = if sum > 1e-9 { s[a * NC + h].max(0.0) / sum } else { 1.0 / na as f32 };
        }
    }
    s
}

impl<'a> Solver<'a> {
    /// `ranges[p][h]` = weight (0..1) of combo `h` in player p's range at the start of the flop.
    pub fn new(tree: &'a Tree, ranges: &[Vec<f32>; 2]) -> Self {
        Self::with_options(tree, ranges, SolverOptions::default())
    }

    pub fn with_options(tree: &'a Tree, ranges: &[Vec<f32>; 2], opts: SolverOptions) -> Self {
        let prior = starting_prior(tree, ranges);
        let (supports, support_of) = decision_supports(tree, &prior);
        let mut has_avg = Vec::with_capacity(tree.nodes.len());
        let mut regret = Vec::with_capacity(tree.nodes.len());
        let mut ssum = Vec::with_capacity(tree.nodes.len());
        for (n, &sid) in tree.nodes.iter().zip(&support_of) {
            if let PKind::Decision { children, .. } = &n.kind {
                let len = children.len() * supports[sid as usize].len();
                let keep = n.street < opts.no_average_from;
                has_avg.push(keep);
                regret.push(vec![0f32; len]);
                ssum.push(if keep { vec![0f32; len] } else { Vec::new() });
            } else {
                has_avg.push(false);
                regret.push(Vec::new());
                ssum.push(Vec::new());
            }
        }
        let z0 = pair_mass(&tree.board, &prior[0], &prior[1]);
        let locks = vec![None; tree.nodes.len()];
        let river = river::applies(tree).then(|| Box::new(RiverWalk::new(tree, &prior, |i| &supports[support_of[i] as usize][..])));
        let supports = Arc::new(supports);
        let subtree_end = subtree_ends(tree);
        let river_plans = RiverPlans::new(tree, &prior, &subtree_end).map(Arc::new);
        let threads = opts.threads.max(1);
        Solver {
            tree,
            regret,
            ssum,
            avg: Vec::new(),
            iters: 0,
            avg_start: 0,
            locks,
            prior,
            supports,
            support_of,
            has_avg,
            subtree_end,
            threads,
            avg_on_demand_from: opts.avg_on_demand_from,
            tremble: opts.tremble,
            current_from: 3,
            br_forbid: Vec::new(),
            eval_below: 3,
            extra: HashMap::new(),
            z0,
            river,
            update: opts.update,
            train_only: None,
            dcfr: None,
            river_plans,
            river_subtree_walk: true,
            allin_buf: std::sync::Mutex::new(Vec::new()),
            #[cfg(test)]
            alt_full_values: false,
        }
    }

    /// how the next iterations update (`SolverOptions::update`); e.g. a re-solve of the river on the device's terms
    /// (`Update::SimCfrPlus`) after an all-card solve with another update
    pub fn set_update(&mut self, update: Update) {
        self.update = update;
    }

    pub fn update(&self) -> Update {
        self.update
    }

    /// Whether training walks train the river subtrees of a tree with chance nodes over the supports
    /// (`river::train_subtree`, REFACTOR_PLAN 4-2; the default) or with the general walk (the reference of the tests,
    /// `measure_exploit --bench-allcards --reference`).  The regrets and strategy sums are bit for bit the same.
    pub fn set_river_subtree_walk(&mut self, on: bool) {
        self.river_subtree_walk = on;
    }

    /// threads that walk the tree (see `SolverOptions::threads`)
    pub fn threads(&self) -> usize {
        self.threads
    }

    /// Walk the whole tree from the root with the starting ranges.
    fn run(&mut self, mode: Mode, ev: Option<&mut [Option<NodeEval>]>, want_mass: bool) -> Res {
        let (r0, r1) = (self.prior[0].clone(), self.prior[1].clone());
        self.run_from(0, &r0, &r1, mode, ev, want_mass)
    }

    /// Walk the subtree of node `ni` with the reaches `r0`, `r1` (the root with the starting ranges: `run`).
    fn run_from(&mut self, ni: usize, r0: &[f32], r1: &[f32], mode: Mode, ev: Option<&mut [Option<NodeEval>]>, want_mass: bool) -> Res {
        let threads = if cfg!(target_arch = "wasm32") { 1 } else { self.threads };
        let sh = Shared {
            tree: self.tree,
            locks: &self.locks,
            avg: &self.avg,
            supports: &self.supports,
            support_of: &self.support_of,
            has_avg: &self.has_avg,
            subtree_end: &self.subtree_end,
            z0: self.z0,
            threads,
            current_from: self.current_from,
            tremble: self.tremble,
            br_forbid: &self.br_forbid,
            eval_below: self.eval_below,
            train_only: self.train_only,
            #[cfg(test)]
            full_values: self.alt_full_values,
            #[cfg(not(test))]
            full_values: false,
            dcfr: self.dcfr,
            river_plans: if self.river_subtree_walk { self.river_plans.as_deref() } else { None },
            allin_buf: &self.allin_buf,
        };
        let mut sub = SubScratch::default();
        let mut part = Part { sh: &sh, base: 0, regret: &mut self.regret, ssum: &mut self.ssum, ev, extra: &mut self.extra, fork: threads > 1, sub: &mut sub };
        part.walk(ni, r0, r1, mode, want_mass)
    }

    /// does this node keep a strategy average (see `SolverOptions::no_average_from`)
    pub fn has_average(&self, node: usize) -> bool {
        self.has_avg.get(node).copied().unwrap_or(false)
    }

    /// the support of a decision node (ascending combo indices); empty for other nodes
    pub fn support(&self, node: usize) -> &[u16] {
        match self.support_of.get(node) {
            Some(&s) if s != u32::MAX => &self.supports[s as usize],
            _ => &[],
        }
    }

    /// bytes held by the regrets, strategy sums and average strategies (the per node `Vec` headers excluded)
    pub fn strategy_bytes(&self) -> usize {
        let f = |v: &Vec<Vec<f32>>| v.iter().map(|x| x.len() * 4).sum::<usize>();
        f(&self.regret) + f(&self.ssum) + f(&self.avg)
    }

    /// Fix the strategy at a decision node (`strategy` is na * NC, each hand's row must sum to 1).
    /// The opponent (and the locker's other nodes) keep adapting; this node is never updated.
    pub fn lock_node(&mut self, node: usize, strategy: Vec<f32>) -> Result<(), String> {
        match &self.tree.nodes.get(node).ok_or("no such node")?.kind {
            PKind::Decision { children, .. } => {
                let na = children.len();
                if strategy.len() != na * NC {
                    return Err(format!("expected {} values, got {}", na * NC, strategy.len()));
                }
                self.locks[node] = Some(normalize_strategy(strategy, na));
                Ok(())
            }
            _ => Err("not a decision node".into()),
        }
    }

    pub fn unlock_node(&mut self, node: usize) {
        if let Some(l) = self.locks.get_mut(node) {
            *l = None;
        }
    }

    /// the strategy a node is locked to (as `lock_node` normalized it), `None` if it is not locked
    pub fn locked_strategy(&self, node: usize) -> Option<&[f32]> {
        self.locks.get(node).and_then(|l| l.as_deref())
    }

    /// iteration at which the strategy average was last (re)started (`reset_average`)
    pub fn avg_start(&self) -> u32 {
        self.avg_start
    }

    /// Set the iteration counters (`iters`, and the start of the average) of a solver whose `regret` / `ssum` were
    /// restored from a checkpoint (REFACTOR_PLAN 3-3-3), so that it continues exactly where the saved one was.
    pub fn restore_counters(&mut self, iters: u32, avg_start: u32) {
        assert!(avg_start <= iters, "the average starts before the current iteration");
        self.iters = iters;
        self.avg_start = avg_start;
    }

    /// Decision nodes of `street` and later play their current strategy (regret matching) wherever the average
    /// strategy would be used (`exploitability`, `root_values`, `evaluate`), even if they keep an average; 3 (the
    /// default) = never.  Measures "the average on the earlier streets + the last iterate on the later ones"
    /// (what a solver without those averages, `no_average_from`, plays) without solving twice.  Training is not
    /// affected.
    pub fn set_current_strategy_from(&mut self, street: u8) {
        self.current_from = street;
    }

    /// Forget the strategy sums (keeps the regrets): early iterations are far from equilibrium and
    /// would otherwise keep dragging the average, so the average is restarted part-way through.
    pub fn reset_average(&mut self) {
        for v in self.ssum.iter_mut() {
            v.iter_mut().for_each(|x| *x = 0.0);
        }
        self.avg_start = self.iters;
    }

    /// One CFR+ iteration.  A river tree takes the river walk (`river.rs`): the same regrets and strategy sums, bit
    /// for bit, as the general walk (`iterate_full_width`), several times faster.
    pub fn iterate(&mut self) {
        if self.update != Update::SimCfrPlus {
            return self.iterate_alternating();
        }
        let Some(river) = self.river.as_mut() else { return self.iterate_full_width() };
        self.iters += 1;
        let t = (self.iters - self.avg_start) as f32;
        river.train(self.tree, &mut self.regret, &mut self.ssum, &self.locks, &self.has_avg, t);
    }

    /// One iteration of an alternating update (`Update::AltCfrPlus` / `AltDcfr`): a walk that updates OOP, then one
    /// that updates IP (against OOP's new strategy), both with the general walk.
    fn iterate_alternating(&mut self) {
        self.iters += 1;
        let t = (self.iters - self.avg_start) as f32;
        self.dcfr = (self.update == Update::AltDcfr).then(|| dcfr_discounts(self.iters));
        for p in 0..2 {
            self.train_only = Some(p);
            self.run(Mode::Train(t), None, false);
        }
        self.train_only = None;
        self.dcfr = None;
    }

    /// One iteration with the general walk (1,326 wide vectors), whatever the tree: the reference of the river walk
    /// (tests, `measure_exploit --bench-river --reference`).
    pub fn iterate_full_width(&mut self) {
        self.iters += 1;
        let t = (self.iters - self.avg_start) as f32;
        self.run(Mode::Train(t), None, false);
    }

    /// Average strategy (`avg`) of every decision node that keeps one; a hand without strategy sums gets
    /// the current strategy.  Nodes without an average, and nodes whose average is made on demand
    /// (`SolverOptions::avg_on_demand_from`), get an empty `avg` entry.
    pub fn finalize_avg(&mut self) {
        self.avg = Vec::with_capacity(self.tree.nodes.len());
        for (i, n) in self.tree.nodes.iter().enumerate() {
            match &n.kind {
                PKind::Decision { children, .. } if self.has_avg[i] && n.street < self.avg_on_demand_from => {
                    let na = children.len();
                    let sup = &self.supports[self.support_of[i] as usize];
                    let mut sg = vec![0f32; na * NC];
                    average_strategy(&self.regret[i], &self.ssum[i], na, sup, &mut sg);
                    self.avg.push(sg);
                }
                _ => self.avg.push(Vec::new()),
            }
        }
    }

    /// value of each player at the root under the average strategy (chips, incl. the share of the initial pot)
    pub fn root_values(&mut self) -> [f32; 2] {
        let res = self.run(Mode::Eval, None, true);
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
        let g = self.exploitability_by_player();
        g[0] + g[1]
    }

    /// The best-response gain of each player in chips (OOP, IP): what that player wins more than under the
    /// average strategies by best-responding alone.  `exploitability` is their sum.
    pub fn exploitability_by_player(&mut self) -> [f32; 2] {
        let base = self.root_values();
        [self.best_response_gain(0, base), self.best_response_gain(1, base)]
    }

    /// The best-response gain of player `p` alone (chips) against the others as they are now, the locked nodes of
    /// `p` included (a locked node plays its lock, so `p` may deviate only where it is not locked).  `base` is
    /// `root_values()` of the same state.  `exploitability_by_player` calls this for both players.
    pub fn best_response_gain(&mut self, p: usize, base: [f32; 2]) -> f32 {
        self.best_response_delta(p, base).max(0.0)
    }

    /// `best_response_gain` without the clamp at 0 (rounding only: below 0 by no more than that)
    pub fn best_response_delta(&mut self, p: usize, base: [f32; 2]) -> f32 {
        let res = self.run(Mode::Br(p), None, true);
        let br = self.value(&res, p)[p];
        br - base[p]
    }

    /// Take actions away from a best response (`best_response_gain` / `best_response_delta`): `forbid[node]` has bit `a`
    /// set when the player who best-responds at the decision node may not choose its action `a` (the strategies of
    /// the other nodes, and of this node when it is locked, are not changed).  At such a node the best response may
    /// still play the node's average strategy `avg[node]` (which can play an action it may not choose), so it never
    /// does worse than the strategies do.  A node whose actions are all forbidden forbids none.  Empty (the default)
    /// forbids nothing.  Measures the best response within some lines (`docs/14` §11-9).
    pub fn set_br_forbidden(&mut self, forbid: Vec<u64>) {
        assert!(forbid.is_empty() || forbid.len() == self.tree.nodes.len(), "one entry per tree node");
        self.br_forbid = forbid;
    }

    pub fn evaluate(&mut self) -> Vec<Option<NodeEval>> {
        let mut ev: Vec<Option<NodeEval>> = vec![None; self.tree.nodes.len()];
        self.run(Mode::Eval, Some(&mut ev), true);
        ev
    }

    /// `evaluate` for the flop and turn nodes only (what a TSP1 v3 file holds, `dealt_nodes`): the river nodes of a
    /// 49 x 48 tree keep averages, and their evaluations would not fit in memory.  The flop and turn entries are
    /// those of `evaluate`.
    pub fn evaluate_upstream(&mut self) -> Vec<Option<NodeEval>> {
        self.eval_below = 2;
        let ev = self.evaluate();
        self.eval_below = 3;
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

    /// all-in equity of every hand against `r_opp` on the node's board
    fn equity_vs(&mut self, board: &[u8], r_opp: &[f32]) -> Vec<f32> {
        equity_vs(&mut self.extra, board, r_opp)
    }
}

/// all-in equity of every hand against `r_opp` on `board`; `extra` caches the hand strengths of the 5 card boards
/// (a cache only: the result does not depend on what it holds)
fn equity_vs(extra: &mut HashMap<u64, Strength>, board: &[u8], r_opp: &[f32]) -> Vec<f32> {
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
        let st = extra.entry(m5).or_insert_with(|| Strength::new(&[b[0], b[1], b[2], b[3], b[4]]));
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

/// per node, one past the last node of its subtree (nodes are numbered depth first by `build_tree`)
fn subtree_ends(tree: &Tree) -> Vec<u32> {
    let n = tree.nodes.len();
    let mut end = vec![0u32; n];
    for i in (0..n).rev() {
        end[i] = match &tree.nodes[i].kind {
            PKind::Decision { children, .. } | PKind::Chance { children, .. } => children.iter().map(|&c| end[c as usize]).max().unwrap_or(i as u32 + 1),
            _ => i as u32 + 1,
        };
    }
    end
}

/// What a walk only reads; shared by the threads of a parallel walk.
struct Shared<'w> {
    tree: &'w Tree,
    locks: &'w [Option<Vec<f32>>],
    avg: &'w [Vec<f32>],
    supports: &'w [Vec<u16>],
    support_of: &'w [u32],
    has_avg: &'w [bool],
    subtree_end: &'w [u32],
    z0: f64,
    threads: usize,
    /// `Solver::set_current_strategy_from`
    current_from: u8,
    /// `SolverOptions::tremble`
    tremble: f32,
    /// `Solver::set_br_forbidden`
    br_forbid: &'w [u64],
    /// `Solver::evaluate_upstream`
    eval_below: u8,
    /// an alternating walk (`Update`): only this player's regrets and strategy sums are updated, and (unless
    /// `full_values`) only its values are computed: the walk returns the other player's values as 0, which no
    /// update of this walk reads
    train_only: Option<usize>,
    /// tests: compute both players' values in an alternating walk anyway
    full_values: bool,
    /// a DCFR walk: `dcfr_discounts` of the iteration
    dcfr: Option<(f32, f32, f32)>,
    /// training walks take `river::train_subtree` at these river subtrees (`Solver::set_river_subtree_walk`)
    river_plans: Option<&'w RiverPlans>,
    /// `Solver::allin_buf`
    allin_buf: &'w std::sync::Mutex<Vec<f32>>,
}

/// What a walk writes, for the nodes `base..base + regret.len()`: the whole tree, or one subtree that a thread
/// walks.  A node's regrets / strategy sums / evaluation are written only by the walk of its own subtree, so
/// the subtrees of a chance node's children can be walked at the same time with `split_at_mut` slices and no
/// `unsafe` or locking.
struct Part<'w> {
    sh: &'w Shared<'w>,
    base: usize,
    regret: &'w mut [Vec<f32>],
    ssum: &'w mut [Vec<f32>],
    ev: Option<&'w mut [Option<NodeEval>]>,
    extra: &'w mut HashMap<u64, Strength>,
    /// walk the children of the next chance node in parallel (`Shared::threads` > 1, and not already inside a
    /// parallel walk)
    fork: bool,
    /// the buffers of the river subtree walk (`river::train_subtree`)
    sub: &'w mut SubScratch,
}

/// one child subtree of a forked chance node: (child number, card, child node, its regrets, strategy sums, evaluations)
type Job<'a> = (usize, u8, usize, &'a mut [Vec<f32>], &'a mut [Vec<f32>], Option<&'a mut [Option<NodeEval>]>);

/// The floating point control word of the calling thread (x86-64 MXCSR: flush-to-zero / denormals-are-zero,
/// which `gen_postflop` sets), so that a worker thread computes exactly as the thread that forked it.
/// Linux threads inherit it, other systems need not; `0` elsewhere.
#[cfg(target_arch = "x86_64")]
fn fp_control() -> u32 {
    // SAFETY: reading MXCSR has no precondition (SSE is part of x86-64)
    #[allow(deprecated)]
    unsafe {
        std::arch::x86_64::_mm_getcsr()
    }
}

#[cfg(target_arch = "x86_64")]
fn set_fp_control(x: u32) {
    // SAFETY: `x` was read from MXCSR by `fp_control` on another thread of this process, so it is a valid value
    #[allow(deprecated)]
    unsafe {
        std::arch::x86_64::_mm_setcsr(x)
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn fp_control() -> u32 {
    0
}

#[cfg(not(target_arch = "x86_64"))]
fn set_fp_control(_: u32) {}

/// stack of a worker thread (the walk recurses once per tree level, ~20 levels with small frames)
const WORKER_STACK: usize = 8 << 20;

impl<'w> Part<'w> {
    /// Walk the children of chance node `ni` on `sh.threads` threads.  Child `i` owns the nodes
    /// `children[i]..subtree_end[children[i]]` (consecutive ranges), which become the `Part`s of the jobs; a
    /// thread takes the next job until none is left.  Returns the children's results in card order, whichever
    /// thread computed them.
    #[allow(clippy::too_many_arguments)] // the arguments of `walk`, plus the chance node's own
    fn fork_children(&mut self, ni: usize, cards: &[u8], children: &[u32], r0: &[f32], r1: &[f32], mode: Mode, want_mass: bool) -> Vec<Res> {
        let sh: &'w Shared<'w> = self.sh;
        let n = children.len();
        let lo = children[0] as usize - self.base;
        let hi = sh.subtree_end[ni] as usize - self.base;
        let mut regret = &mut self.regret[lo..hi];
        let mut ssum = &mut self.ssum[lo..hi];
        let mut ev = self.ev.as_deref_mut().map(|e| &mut e[lo..hi]);
        let mut jobs: Vec<Job> = Vec::with_capacity(n);
        for (i, (&c, &ch)) in cards.iter().zip(children).enumerate() {
            let end = sh.subtree_end[ch as usize];
            assert!(i + 1 == n || children[i + 1] == end, "child subtrees are consecutive");
            let len = (end - ch) as usize;
            let (r, rest) = std::mem::take(&mut regret).split_at_mut(len);
            regret = rest;
            let (s, rest) = std::mem::take(&mut ssum).split_at_mut(len);
            ssum = rest;
            let e = ev.take().map(|e| {
                let (a, b) = e.split_at_mut(len);
                ev = Some(b);
                a
            });
            jobs.push((i, c, ch as usize, r, s, e));
        }
        let queue = std::sync::Mutex::new(jobs.into_iter());
        let fpc = fp_control();
        let mut out: Vec<Option<Res>> = (0..n).map(|_| None).collect();
        let mut caches = Vec::new();
        std::thread::scope(|s| {
            let queue = &queue;
            let handles: Vec<_> = (0..sh.threads.min(n))
                .map(|_| {
                    std::thread::Builder::new()
                        .stack_size(WORKER_STACK)
                        .spawn_scoped(s, move || {
                            set_fp_control(fpc);
                            let mut extra = HashMap::new();
                            let mut sub = SubScratch::default();
                            let mut done = Vec::new();
                            loop {
                                let job = queue.lock().expect("job queue").next();
                                let Some((i, c, ch, regret, ssum, ev)) = job else { break };
                                let mut part = Part { sh, base: ch, regret, ssum, ev, extra: &mut extra, fork: false, sub: &mut sub };
                                let (a0, a1) = (zero_card(r0, c), zero_card(r1, c));
                                done.push((i, part.walk(ch, &a0, &a1, mode, want_mass)));
                            }
                            (done, extra)
                        })
                        .expect("start a solver thread")
                })
                .collect();
            for h in handles {
                let (done, extra) = h.join().expect("solver thread");
                for (i, res) in done {
                    out[i] = Some(res);
                }
                caches.push(extra);
            }
        });
        for c in caches {
            for (k, v) in c {
                self.extra.entry(k).or_insert(v);
            }
        }
        out.into_iter().map(|r| r.expect("every child walked")).collect()
    }

    /// Does a training walk take `river::train_subtree` at node `ni`: the root of a river subtree (`Shared::river_plans`)
    /// with no locked node, values without masses.
    fn is_river_subtree(&self, ni: usize, mode: Mode, want_mass: bool) -> bool {
        let sh = self.sh;
        matches!(mode, Mode::Train(_)) && !want_mass && sh.river_plans.is_some_and(|p| p.plan_of[ni] != u32::MAX) && sh.locks[ni..sh.subtree_end[ni] as usize].iter().all(|l| l.is_none())
    }

    /// Train the river subtree of `ni` over the supports (REFACTOR_PLAN 4-2; `river::train_subtree`): the regrets and
    /// strategy sums of the general walk, bit for bit.  `r0` / `r1` may still hold the combos with the river card.
    fn river_subtree(&mut self, ni: usize, r0: &[f32], r1: &[f32], mode: Mode, out: &mut [Vec<f32>; 2], w: Option<f32>) {
        let sh = self.sh;
        let (Mode::Train(t), Some(plans)) = (mode, sh.river_plans) else { unreachable!("a training walk with river plans") };
        let ctx = SubTrain { tree: sh.tree, plans, has_avg: sh.has_avg, t, train_only: sh.train_only, dcfr: sh.dcfr };
        river::train_subtree(&ctx, ni, sh.subtree_end[ni] as usize, self.base, self.regret, self.ssum, [r0, r1], self.sub, out, w);
    }

    fn walk(&mut self, ni: usize, r0: &[f32], r1: &[f32], mode: Mode, want_mass: bool) -> Res {
        let sh: &'w Shared<'w> = self.sh;
        let tree: &'w Tree = sh.tree;
        let node = &tree.nodes[ni];
        // what a terminal pays out (the pot minus the rake; not used at other nodes)
        let pot_total = tree.cfg.pot_paid(node.inv);
        let need_mass = want_mass || !matches!(mode, Mode::Train(_));
        // an alternating walk computes the values of the player it updates only (`Shared::train_only`)
        let only: Option<usize> = match mode {
            Mode::Train(_) if !sh.full_values => sh.train_only,
            _ => None,
        };
        let wants = |q: usize| only.is_none_or(|o| o == q);
        // the root of a river subtree (reached here when its chance node was forked): see `river_subtree`
        if self.is_river_subtree(ni, mode, want_mass) {
            let mut v = [vec![0f32; NC], vec![0f32; NC]];
            self.river_subtree(ni, r0, r1, mode, &mut v, None);
            return Res { v, m: [Vec::new(), Vec::new()] };
        }
        match &node.kind {
            PKind::Fold { winner } => {
                let w = *winner as usize;
                let l = 1 - w;
                let bm = mask_of(&node.board);
                let mut res = Res::zero(true);
                let rs = [r0, r1];
                if wants(w) {
                    compat_mass(bm, rs[l], &mut res.m[w]);
                }
                if wants(l) {
                    compat_mass(bm, rs[w], &mut res.m[l]);
                }
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
                for p in (0..2).filter(|&p| wants(p)) {
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
                let bm = mask_of(&node.board);
                let players: Vec<usize> = (0..2).filter(|&p| wants(p)).collect();
                // one run-out's showdown for one player: (share, mass), as `showdown` leaves them
                let one = |ti: u32, p: usize, share: &mut [f32], mass: &mut [f32]| {
                    let st = &tree.tables[ti as usize];
                    let fresh = st.mask & !bm; // the cards of the run-out
                    let mut r = rs[1 - p].to_vec();
                    for h in 0..NC {
                        if blocked(fresh, h) {
                            r[h] = 0.0;
                        }
                    }
                    showdown(st, &r, share, mass);
                };
                // adds one run-out's showdown, in the order of the run-outs whichever thread computed it
                let mut add = |ti: u32, p: usize, share: &[f32], mass: &[f32]| {
                    for &h in &tree.tables[ti as usize].order {
                        let h = h as usize;
                        res.v[p][h] += weight * (pot_total * share[h] - node.inv[p] * mass[h]);
                        res.m[p][h] += weight * mass[h];
                    }
                };
                if self.fork && sh.threads > 1 && tables.len() >= 4 * sh.threads {
                    // many run-outs (a flop all-in: 1,176) above the parallel part of the walk: their showdowns are computed
                    // on the threads (one contiguous range of run-outs each, one thread start per node) and added here in
                    // order (REFACTOR_PLAN 4-3), so the values are bit for bit those of one thread.  A showdown keeps only
                    // the entries `add` reads (`Strength::order`), as (share, mass) pairs.
                    let jobs: Vec<(u32, usize)> = tables.iter().flat_map(|&ti| players.iter().map(move |&p| (ti, p))).collect();
                    let len = |&(ti, _): &(u32, usize)| tree.tables[ti as usize].order.len();
                    // the solver's buffer (`Solver::allin_buf`): kept from node to node and walk to walk, since faulting in
                    // ~20 MB of new pages for every node took longer than the showdowns (the threads wait on each other there)
                    let need = 2 * jobs.iter().map(len).sum::<usize>();
                    let mut guard = sh.allin_buf.lock().expect("all-in buffer");
                    if guard.len() < need {
                        guard.resize(need, 0.0);
                    }
                    let buf: &mut [f32] = &mut guard[..need];
                    let per = jobs.len().div_ceil(sh.threads);
                    let fpc = fp_control();
                    std::thread::scope(|s| {
                        let mut rest: &mut [f32] = &mut *buf;
                        for js in jobs.chunks(per) {
                            let (mine, more) = std::mem::take(&mut rest).split_at_mut(2 * js.iter().map(len).sum::<usize>());
                            rest = more;
                            let one = &one;
                            s.spawn(move || {
                                set_fp_control(fpc);
                                let (mut share, mut mass) = (vec![0f32; NC], vec![0f32; NC]);
                                let mut at = 0;
                                for &(ti, p) in js {
                                    one(ti, p, &mut share, &mut mass);
                                    for &h in &tree.tables[ti as usize].order {
                                        mine[at] = share[h as usize];
                                        mine[at + 1] = mass[h as usize];
                                        at += 2;
                                    }
                                }
                            });
                        }
                    });
                    let mut at = 0;
                    for &(ti, p) in &jobs {
                        for &h in &tree.tables[ti as usize].order {
                            let h = h as usize;
                            let (sh_h, ms_h) = (buf[at], buf[at + 1]);
                            res.v[p][h] += weight * (pot_total * sh_h - node.inv[p] * ms_h);
                            res.m[p][h] += weight * ms_h;
                            at += 2;
                        }
                    }
                } else {
                    let mut share = vec![0f32; NC];
                    let mut mass = vec![0f32; NC];
                    for &ti in tables {
                        for &p in &players {
                            one(ti, p, &mut share, &mut mass);
                            add(ti, p, &share, &mass);
                        }
                    }
                }
                res
            }
            PKind::Chance { cards, children, weight } => {
                let mut acc = Res::zero(need_mass);
                if self.fork && children.len() > 1 {
                    // the same sum in the same (card) order as below, only the children are computed in parallel
                    for res in self.fork_children(ni, cards, children, r0, r1, mode, want_mass) {
                        acc.add_scaled(&res, *weight);
                    }
                } else {
                    for (&c, &ch) in cards.iter().zip(children.iter()) {
                        let ch = ch as usize;
                        if self.is_river_subtree(ch, mode, want_mass) {
                            // adds what `add_scaled` would add, on the supports (off them the subtree's values are 0, or of
                            // combos outside the range, which nothing reads; `acc` is never -0, so adding 0 is a no-op)
                            self.river_subtree(ch, r0, r1, mode, &mut acc.v, Some(*weight));
                            continue;
                        }
                        let (a0, a1) = (zero_card(r0, c), zero_card(r1, c));
                        let res = self.walk(ch, &a0, &a1, mode, want_mass);
                        acc.add_scaled(&res, *weight);
                    }
                }
                acc
            }
            PKind::Decision { player, acts, children } => {
                let p = *player as usize;
                let o = 1 - p;
                let na = children.len();
                let rp: &[f32] = if p == 0 { r0 } else { r1 };
                let ro: &[f32] = if p == 0 { r1 } else { r0 };
                let li = ni - self.base;
                let locked = sh.locks[ni].is_some();
                let has_avg = sh.has_avg[ni];
                let sup: &[u16] = &sh.supports[sh.support_of[ni] as usize];
                let mut sigma = vec![0f32; na * NC];
                if let Some(l) = &sh.locks[ni] {
                    sigma.copy_from_slice(l);
                } else {
                    match mode {
                        Mode::Train(_) => current_strategy(&self.regret[li], na, sup, &mut sigma),
                        Mode::Br(bp) if bp == p => {}
                        _ if !has_avg || node.street >= sh.current_from => current_strategy(&self.regret[li], na, sup, &mut sigma),
                        // an average made on demand (see `Solver`)
                        _ if sh.avg.get(ni).is_none_or(|a| a.is_empty()) => average_strategy(&self.regret[li], &self.ssum[li], na, sup, &mut sigma),
                        _ => sigma.copy_from_slice(&sh.avg[ni]),
                    }
                }
                // training with a tremble (`SolverOptions::tremble`): the node plays `sigma'`; `chosen` keeps `sigma`
                let mut chosen: Option<Vec<f32>> = None;
                if sh.tremble > 0.0 && node.street < 2 && !locked && matches!(mode, Mode::Train(_)) {
                    chosen = Some(sigma.clone());
                    tremble_strategy(&mut sigma, acts, sh.tremble);
                }
                let mut cfv_p = vec![0f32; NC];
                let mut cfv_o = vec![0f32; NC];
                let mut m_p = if need_mass { vec![0f32; NC] } else { Vec::new() };
                let mut m_o = if need_mass { vec![0f32; NC] } else { Vec::new() };
                let mut child_p: Vec<Vec<f32>> = Vec::with_capacity(na);
                let mut best: Option<Vec<f32>> = None;
                // the actions a best response may not choose (`Solver::set_br_forbidden`); never all of them.  With some
                // forbidden it may still play the node's average strategy: `mix` is that strategy's value
                let forbid = match sh.br_forbid.get(ni).copied().unwrap_or(0) & ((1u64 << na) - 1) {
                    f if f == (1u64 << na) - 1 => 0,
                    f => f,
                };
                let own_avg: Option<&[f32]> = if forbid != 0 { sh.avg.get(ni).filter(|a| a.len() == na * NC).map(|a| a.as_slice()) } else { None };
                let mut mix: Option<Vec<f32>> = own_avg.map(|_| vec![0f32; NC]);
                for a in 0..na {
                    let new_rp: Vec<f32> = (0..NC).map(|h| rp[h] * sigma[a * NC + h]).collect();
                    let res = if p == 0 { self.walk(children[a] as usize, &new_rp, ro, mode, want_mass) } else { self.walk(children[a] as usize, ro, &new_rp, mode, want_mass) };
                    if wants(o) {
                        for h in 0..NC {
                            cfv_o[h] += res.v[o][h];
                        }
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
                        Mode::Br(bp) if bp == p && !locked => {
                            let b = best.get_or_insert_with(|| vec![f32::MIN; NC]);
                            if forbid >> a & 1 == 0 {
                                for h in 0..NC {
                                    b[h] = b[h].max(res.v[p][h]);
                                }
                            }
                            if let (Some(m), Some(own)) = (mix.as_mut(), own_avg) {
                                for h in 0..NC {
                                    m[h] += own[a * NC + h] * res.v[p][h];
                                }
                            }
                        }
                        _ if !wants(p) => {}
                        _ => {
                            for h in 0..NC {
                                cfv_p[h] += sigma[a * NC + h] * res.v[p][h];
                            }
                        }
                    }
                    child_p.push(if wants(p) { res.v[p].clone() } else { Vec::new() });
                }
                if let Some(mut b) = best {
                    if let Some(m) = &mix {
                        for h in 0..NC {
                            b[h] = b[h].max(m[h]);
                        }
                    }
                    cfv_p = b;
                }
                let mut cfv_p_chosen: Option<Vec<f32>> = None;
                match mode {
                    Mode::Train(_) if locked => {}
                    // an alternating walk updates one player only
                    Mode::Train(_) if sh.train_only.is_some_and(|q| q != p) => {}
                    Mode::Train(t) => {
                        // the support only: elsewhere the reach is 0 (see `Solver`)
                        let k = sup.len();
                        if let Some(chosen) = &chosen {
                            // the regrets against the chosen strategy's own value (the tremble is not the
                            // player's to change), and the average of the chosen strategy
                            let mut base = vec![0f32; NC];
                            for a in 0..na {
                                for &h in sup {
                                    let h = h as usize;
                                    base[h] += chosen[a * NC + h] * child_p[a][h];
                                }
                            }
                            cfv_p_chosen = Some(base);
                            sigma.copy_from_slice(chosen);
                        }
                        let cfv_own: &[f32] = cfv_p_chosen.as_deref().unwrap_or(&cfv_p);
                        let regret = &mut self.regret[li];
                        for a in 0..na {
                            for (j, &h) in sup.iter().enumerate() {
                                let h = h as usize;
                                let i = a * k + j;
                                regret[i] = match sh.dcfr {
                                    None => (regret[i] + child_p[a][h] - cfv_own[h]).max(0.0),
                                    Some((pos, neg, _)) => {
                                        let r = regret[i];
                                        r * if r > 0.0 { pos } else { neg } + (child_p[a][h] - cfv_own[h])
                                    }
                                };
                            }
                        }
                        if has_avg {
                            let ssum = &mut self.ssum[li];
                            for a in 0..na {
                                for (j, &h) in sup.iter().enumerate() {
                                    let h = h as usize;
                                    ssum[a * k + j] = match sh.dcfr {
                                        None => ssum[a * k + j] + t * rp[h] * sigma[a * NC + h],
                                        Some((_, _, keep)) => ssum[a * k + j] * keep + rp[h] * sigma[a * NC + h],
                                    };
                                }
                            }
                        }
                    }
                    Mode::Eval if self.ev.is_some() && has_avg && node.street < sh.eval_below => {
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
                        e.reach = (node.chance_p as f64 * pair / sh.z0.max(1e-30)) as f32;
                        if e.reach > 1e-5 {
                            e.eq = equity_vs(self.extra, &node.board, ro);
                        }
                        if let Some(ev) = self.ev.as_deref_mut() {
                            ev[li] = Some(e);
                        }
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

/// Binary file for one flop (see docs/03-solution-format.md, "TSP1" v2).
pub fn export(tree: &Tree, ev: &[Option<NodeEval>], min_reach: f32) -> Vec<u8> {
    export_with_map(tree, ev, min_reach).0
}

/// Same as `export`, plus the tree node id of every exported node (needed to lock a node of the live solver).
pub fn export_with_map(tree: &Tree, ev: &[Option<NodeEval>], min_reach: f32) -> (Vec<u8>, Vec<u32>) {
    write_tsp1(tree, ev, min_reach, None)
}

/// `TSP1` v3 (REFACTOR_PLAN 3-3-5, docs/03-solution-format.md): the flop and turn decision nodes as in v2, no river
/// node; instead every river start (the chance node that deals the river) holds both players' reach ranges (`starts`,
/// from `river_starts`), quantized to u16, from which the device re-solves the river for the card the user picks.
/// `min_reach` is compared with the reach conditional on the dealt cards (`RiverStart::cond_reach`, and
/// `NodeEval::reach / chance_p` for a decision node): with every turn card dealt, the unconditional reach of a turn
/// line is 1/49 of the line's own probability.
pub fn export_v3(tree: &Tree, ev: &[Option<NodeEval>], starts: &[RiverStart], min_reach: f32) -> Vec<u8> {
    export_v3_with_map(tree, ev, starts, min_reach).0
}

/// Same as `export_v3`, plus the tree node id of every exported node.
pub fn export_v3_with_map(tree: &Tree, ev: &[Option<NodeEval>], starts: &[RiverStart], min_reach: f32) -> (Vec<u8>, Vec<u32>) {
    write_tsp1(tree, ev, min_reach, Some(starts))
}

/// A river start: the chance node at the end of a turn line, which deals the river card (`PKind::Chance` on street 1).
pub fn is_river_start(node: &PNode) -> bool {
    node.street == 1 && matches!(node.kind, PKind::Chance { .. })
}

/// The reach ranges at a river start (REFACTOR_PLAN 3-3-5).
#[derive(Clone, Debug)]
pub struct RiverStart {
    pub node: u32,
    /// each player's reach when the river is dealt, as the solver's walk carries it: the starting range (`Solver::prior`)
    /// times the player's strategy along the line, the combos on the turn board at 0.  The river card is not dealt yet:
    /// for river card `c` the walk (and the device) sets the combos holding `c` to 0.
    pub ranges: [Vec<f32>; 2],
    /// the probability that the line is played, as `NodeEval::reach` (both ranges, the turn card's probability included)
    pub reach: f32,
    /// the same given the turn card (without its probability): `reach / chance_p`
    pub cond_reach: f32,
}

/// The reach ranges at every river start of `tree` (in node order) when the flop and turn decision nodes play
/// `strategy(node)` (`na * NC`, each hand's row summing to 1), from the starting ranges `prior` (`Solver::prior`).  The
/// arithmetic is the solver walk's (`rp[h] * sigma[a * NC + h]` per action, the dealt card's combos set to 0), so
/// the ranges are bit for bit those that reach the river in `Solver` with the same flop / turn strategies (locked or
/// averaged).  Errors if a flop / turn decision node on the way has no strategy of the right length.
pub fn river_starts<'s>(tree: &Tree, prior: &[Vec<f32>; 2], strategy: &dyn Fn(usize) -> Option<&'s [f32]>) -> Result<Vec<RiverStart>, String> {
    struct Walk<'w, 's> {
        t: &'w Tree,
        z0: f64,
        strategy: &'w dyn Fn(usize) -> Option<&'s [f32]>,
        out: Vec<RiverStart>,
    }
    fn go(w: &mut Walk, i: usize, r0: &[f32], r1: &[f32]) -> Result<(), String> {
        let node = &w.t.nodes[i];
        match &node.kind {
            // a river decision (a river tree's root): no river start below
            PKind::Decision { .. } if node.street >= 2 => Ok(()),
            PKind::Decision { player, children, .. } => {
                let na = children.len();
                let sigma = (w.strategy)(i).ok_or_else(|| format!("node {}: no strategy", i))?;
                if sigma.len() != na * NC {
                    return Err(format!("node {}: {} strategy values, want {}", i, sigma.len(), na * NC));
                }
                let p = *player as usize;
                for (a, &c) in children.iter().enumerate() {
                    let rp = if p == 0 { r0 } else { r1 };
                    let new_rp: Vec<f32> = (0..NC).map(|h| rp[h] * sigma[a * NC + h]).collect();
                    if p == 0 {
                        go(w, c as usize, &new_rp, r1)?;
                    } else {
                        go(w, c as usize, r0, &new_rp)?;
                    }
                }
                Ok(())
            }
            PKind::Chance { .. } if is_river_start(node) => {
                let pair = pair_mass(&node.board, r0, r1);
                let reach = (node.chance_p as f64 * pair / w.z0) as f32;
                w.out.push(RiverStart { node: i as u32, ranges: [r0.to_vec(), r1.to_vec()], reach, cond_reach: (pair / w.z0) as f32 });
                Ok(())
            }
            PKind::Chance { cards, children, .. } => {
                for (&c, &ch) in cards.iter().zip(children) {
                    go(w, ch as usize, &zero_card(r0, c), &zero_card(r1, c))?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
    let z0 = pair_mass(&tree.board, &prior[0], &prior[1]).max(1e-30);
    let mut w = Walk { t: tree, z0, strategy, out: Vec::new() };
    go(&mut w, 0, &prior[0], &prior[1])?;
    Ok(w.out)
}

impl Solver<'_> {
    /// `river_starts` with the strategies this solver's evaluation plays on the flop and turn: a node's lock if it has
    /// one, else its stored average (`finalize_avg`; the flop and turn must keep an average stored, i.e.
    /// `no_average_from` and `avg_on_demand_from` of at least 2).
    pub fn river_starts(&self) -> Result<Vec<RiverStart>, String> {
        let strategy = |i: usize| -> Option<&[f32]> { self.locked_strategy(i).or_else(|| self.avg.get(i).filter(|a| !a.is_empty()).map(|a| a.as_slice())) };
        river_starts(self.tree, &self.prior, &strategy)
    }
}

/// The range quantization of `TSP1` v3: a value is `q / RANGE_Q * scale` (`scale` = the range's largest value).
pub const RANGE_Q: f32 = 65535.0;

/// A reach range as `TSP1` v3 stores it: `scale` (the largest value) and the combos whose quantized value is not 0
/// (ascending) with that value (`round(r / scale * 65535)`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QRange {
    pub scale: f32,
    pub hands: Vec<u16>,
    pub q: Vec<u16>,
}

impl QRange {
    pub fn new(r: &[f32]) -> QRange {
        let scale = r.iter().copied().fold(0f32, f32::max);
        let mut out = QRange { scale, ..Default::default() };
        if scale > 0.0 {
            for (h, &x) in r.iter().enumerate() {
                let q = (x / scale * RANGE_Q).round().clamp(0.0, RANGE_Q) as u16;
                if q > 0 {
                    out.hands.push(h as u16);
                    out.q.push(q);
                }
            }
        }
        out
    }

    /// the 1,326 wide range (0 outside `hands`)
    pub fn dense(&self) -> Vec<f32> {
        let mut r = vec![0f32; NC];
        for (&h, &q) in self.hands.iter().zip(&self.q) {
            r[h as usize] = q as f32 / RANGE_Q * self.scale;
        }
        r
    }
}

/// The nodes a `TSP1` file keeps (`min_reach`, as `export` / `export_v3` read it): the decision nodes that are played
/// (the reach given the dealt cards in v3, `starts` is `Some`), the chance nodes that lead to something kept, and
/// (v3) the river starts that are played.  A node below a node that is not kept is not kept either, and the terminal
/// nodes are never kept.  These are the lines the app "deals"; `docs/14` §11-9 defines G2 within them.
pub fn dealt_nodes(tree: &Tree, ev: &[Option<NodeEval>], starts: Option<&[RiverStart]>, min_reach: f32) -> Vec<bool> {
    let n = tree.nodes.len();
    let start_of: HashMap<usize, &RiverStart> = starts.map(|s| s.iter().map(|x| (x.node as usize, x)).collect()).unwrap_or_default();
    struct Mark<'m> {
        t: &'m Tree,
        ev: &'m [Option<NodeEval>],
        min: f32,
        /// v3: the river starts by node (`None`: v2)
        starts: Option<&'m HashMap<usize, &'m RiverStart>>,
    }
    fn mark(m: &Mark, i: usize, keep: &mut Vec<bool>) -> bool {
        let node = &m.t.nodes[i];
        match &node.kind {
            PKind::Decision { children, .. } => {
                let ok = match m.starts {
                    None => m.ev[i].as_ref().map(|e| e.reach >= m.min).unwrap_or(false),
                    Some(_) => m.ev[i].as_ref().map(|e| (e.reach as f64 / node.chance_p as f64) as f32 >= m.min).unwrap_or(false),
                };
                if !ok {
                    return false;
                }
                keep[i] = true;
                for &c in children {
                    mark(m, c as usize, keep);
                }
                true
            }
            PKind::Chance { .. } if m.starts.is_some() && is_river_start(node) => {
                let ok = m.starts.and_then(|s| s.get(&i)).is_some_and(|s| s.cond_reach >= m.min);
                keep[i] = ok;
                ok
            }
            PKind::Chance { children, .. } => {
                let mut any = false;
                for &c in children {
                    any |= mark(m, c as usize, keep);
                }
                keep[i] = any;
                any
            }
            _ => false,
        }
    }
    let mut keep = vec![false; n];
    mark(&Mark { t: tree, ev, min: min_reach, starts: starts.map(|_| &start_of) }, 0, &mut keep);
    keep
}

fn write_tsp1(tree: &Tree, ev: &[Option<NodeEval>], min_reach: f32, starts: Option<&[RiverStart]>) -> (Vec<u8>, Vec<u32>) {
    // keep decision nodes that are played, chance nodes that lead to something kept, (v3) river starts that are played
    let n = tree.nodes.len();
    let start_of: HashMap<usize, &RiverStart> = starts.map(|s| s.iter().map(|x| (x.node as usize, x)).collect()).unwrap_or_default();
    let keep = dealt_nodes(tree, ev, starts, min_reach);

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
    assert!(order.len() <= u16::MAX as usize, "{} nodes: more than a TSP1 file can hold", order.len());

    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(b"TSP1");
    b.push(if starts.is_some() { 3 } else { 2 });
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
                write_bitmap(&mut b, hands.iter().copied());
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
            PKind::Chance { .. } if starts.is_some() && is_river_start(node) => {
                // v3: the river start, its reach ranges instead of the river cards
                let s = start_of[&i];
                b.push(2);
                b.push(255);
                b.extend_from_slice(&s.reach.to_le_bytes());
                b.push(0);
                for r in &s.ranges {
                    let q = QRange::new(r);
                    b.extend_from_slice(&q.scale.to_le_bytes());
                    write_bitmap(&mut b, q.hands.iter().map(|&h| h as usize));
                    for x in &q.q {
                        b.extend_from_slice(&x.to_le_bytes());
                    }
                }
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
    (b, order.iter().map(|&i| i as u32).collect())
}

/// a 1,326 bit set of combos (bit `h % 8` of byte `h / 8`)
fn write_bitmap(b: &mut Vec<u8>, hands: impl Iterator<Item = usize>) {
    let mut bitmap = vec![0u8; NC.div_ceil(8)];
    for h in hands {
        bitmap[h / 8] |= 1 << (h % 8);
    }
    b.extend_from_slice(&bitmap);
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

    // ---- fingerprints of the solver's results (REFACTOR_PLAN 3-3-1)
    //
    // The expected hashes were taken from the solver before regrets / strategy sums were stored only for
    // the combos of the acting player's range that avoid the board.  They cover every value a caller can
    // see for a hand that can be at the node: exploitability, root values, the exported file, `evaluate`
    // (weight, equity and reach for every combo; frequency and EV for the combos of the support) and
    // `avg` on the support.  Combos outside the starting range never reach a node, so their frequency /
    // EV / average are not part of the result (they may differ, see `Solver`).

    struct Fnv(u64);
    impl Fnv {
        fn new() -> Fnv {
            Fnv(0xcbf2_9ce4_8422_2325)
        }
        fn bytes(&mut self, b: &[u8]) {
            for &x in b {
                self.0 = (self.0 ^ x as u64).wrapping_mul(0x0100_0000_01b3);
            }
        }
        fn f(&mut self, x: f32) {
            self.bytes(&x.to_bits().to_le_bytes());
        }
    }

    /// combos that can hold a hand of player `p` at a node with `board`
    fn can_hold(s: &Solver, p: usize, board: &[u8], h: usize) -> bool {
        s.prior[p][h] != 0.0 && !blocked(mask_of(board), h)
    }

    /// [exploitability + root values, export, evaluate, avg]
    fn fingerprint(tree: &Tree, s: &mut Solver) -> [u64; 4] {
        let mut a = Fnv::new();
        a.f(s.exploitability());
        let v = s.root_values();
        a.f(v[0]);
        a.f(v[1]);
        let ev = s.evaluate();
        let mut b = Fnv::new();
        b.bytes(&export(tree, &ev, 0.0));
        b.bytes(&export(tree, &ev, 0.004));
        let mut c = Fnv::new();
        let mut d = Fnv::new();
        for (i, n) in tree.nodes.iter().enumerate() {
            let PKind::Decision { player, children, .. } = &n.kind else {
                c.bytes(&[ev[i].is_some() as u8]);
                continue;
            };
            let (p, na) = (*player as usize, children.len());
            if let Some(e) = &ev[i] {
                c.bytes(&[1, e.player]);
                c.f(e.reach);
                e.weight.iter().chain(e.eq.iter()).for_each(|&x| c.f(x));
                for h in (0..NC).filter(|&h| can_hold(s, p, &n.board, h)) {
                    (0..na).for_each(|a| c.f(e.freq[a * NC + h]));
                    (0..na).for_each(|a| c.f(e.ev[a * NC + h]));
                }
            } else {
                c.bytes(&[0]);
            }
            for h in (0..NC).filter(|&h| can_hold(s, p, &n.board, h)) {
                (0..na).for_each(|a| d.f(s.avg[i][a * NC + h]));
            }
        }
        [a.0, b.0, c.0, d.0]
    }

    /// deterministic ranges with partial weights and ~40 % of the combos outside the range
    fn mixed_ranges(seed: u64) -> [Vec<f32>; 2] {
        let mut rng = Rng::new(seed);
        let mut one = || (0..NC).map(|_| { let x = rng.below(10); if x < 4 { 0.0 } else { x as f32 / 9.0 } }).collect::<Vec<f32>>();
        [one(), one()]
    }

    fn solve_for_fingerprint<'t>(tree: &'t Tree, iters: u32, ranges: &[Vec<f32>; 2]) -> Solver<'t> {
        let mut s = Solver::new(tree, ranges);
        for i in 0..iters {
            if i == iters / 2 {
                s.reset_average();
            }
            s.iterate();
        }
        s.finalize_avg();
        s
    }

    #[test]
    fn river_results_match_the_full_width_solver() {
        let cfg = Config { pot: 10.0, stack: 40.0, bets: [vec![], vec![], vec![0.5, 1.0]], raise_sizes: [false, false, true], allow_allin: true, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        let mut s = solve_for_fingerprint(&tree, 200, &mixed_ranges(1));
        assert_eq!(fingerprint(&tree, &mut s), [15487618981337517224, 14948454361802919539, 2450223270168397083, 3658067780336906346]);
        // a locked node takes the same path in both layouts
        let mut s = Solver::new(&tree, &mixed_ranges(1));
        let mut lock = vec![0f32; 3 * NC];
        for h in 0..NC {
            lock[h] = 0.25 + (h % 3) as f32 * 0.25;
            lock[NC + h] = 1.0 - lock[h];
        }
        s.lock_node(0, lock).unwrap();
        for _ in 0..100 {
            s.iterate();
        }
        s.finalize_avg();
        assert_eq!(fingerprint(&tree, &mut s), [6198926106085766835, 2706718799317836531, 3652014784600167342, 1407697205378330402]);
    }

    #[test]
    fn turn_results_match_the_full_width_solver() {
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 48, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        let mut s = solve_for_fingerprint(&tree, 40, &mixed_ranges(2));
        assert_eq!(fingerprint(&tree, &mut s), [4668632911533140705, 14385437003168876600, 12427464498391449646, 10132772966205058396]);
    }

    #[test]
    fn flop_results_match_the_full_width_solver() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 3, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let mut s = solve_for_fingerprint(&tree, 40, &mixed_ranges(3));
        assert_eq!(fingerprint(&tree, &mut s), [12371070372254420016, 8577233353959569927, 7758034386023338362, 12683480788134467501]);
    }

    /// the supports: the actor's starting range minus the node's board, shared by nodes of the same board
    #[test]
    fn supports_are_the_range_off_the_board() {
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 48, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        let ranges = mixed_ranges(2);
        let s = Solver::new(&tree, &ranges);
        let mut boards = std::collections::HashSet::new();
        for (i, n) in tree.nodes.iter().enumerate() {
            let PKind::Decision { player, children, .. } = &n.kind else {
                assert!(s.support(i).is_empty() && s.regret[i].is_empty() && s.ssum[i].is_empty());
                continue;
            };
            let p = *player as usize;
            let want: Vec<u16> = (0..NC).filter(|&h| ranges[p][h] != 0.0 && !blocked(mask_of(&n.board), h)).map(|h| h as u16).collect();
            assert_eq!(s.support(i), &want[..]);
            assert_eq!(s.regret[i].len(), children.len() * want.len());
            assert_eq!(s.ssum[i].len(), children.len() * want.len());
            boards.insert((p, mask_of(&n.board)));
        }
        // one list per (player, board): 1 turn board + 48 river boards, both players
        assert_eq!(s.supports.len(), boards.len());
        assert_eq!(s.supports.len(), 2 * 49);
    }

    /// `no_average_from`: the regrets (training) do not depend on it; the nodes of those streets keep no
    /// average, play their current strategy wherever the average would be used, and are not exported.
    /// The exploitability is therefore that of "average on the earlier streets + current strategy on the
    /// later ones", which differs from the all-average value.
    #[test]
    fn no_average_from_the_river() {
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 48, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        let ranges = mixed_ranges(2);
        let mut full = solve_for_fingerprint(&tree, 40, &ranges);
        let mut s = Solver::with_options(&tree, &ranges, SolverOptions { no_average_from: 2, ..Default::default() });
        for i in 0..40 {
            if i == 20 {
                s.reset_average();
            }
            s.iterate();
        }
        s.finalize_avg();
        assert_eq!(s.regret, full.regret, "the training does not read the averages");
        let mut rivers = 0;
        for (i, n) in tree.nodes.iter().enumerate() {
            if !matches!(n.kind, PKind::Decision { .. }) {
                continue;
            }
            if n.street == 2 {
                rivers += 1;
                assert!(!s.has_average(i) && s.ssum[i].is_empty() && s.avg[i].is_empty());
            } else {
                assert!(s.has_average(i));
                assert_eq!(s.ssum[i], full.ssum[i]);
                assert_eq!(s.avg[i], full.avg[i]);
            }
        }
        assert!(rivers > 0);
        assert!(s.strategy_bytes() < full.strategy_bytes() / 2);

        // the same values as the all-average solver whose river averages are replaced by the current strategy
        let e_full = full.exploitability();
        let mut mixed = solve_for_fingerprint(&tree, 40, &ranges);
        for (i, n) in tree.nodes.iter().enumerate() {
            if let PKind::Decision { children, .. } = &n.kind {
                if n.street == 2 {
                    current_strategy(&mixed.regret[i], children.len(), &mixed.supports[mixed.support_of[i] as usize].clone(), &mut mixed.avg[i]);
                }
            }
        }
        let e = s.exploitability();
        assert_eq!(e.to_bits(), mixed.exploitability().to_bits());
        assert_eq!(s.root_values(), mixed.root_values());
        assert_ne!(e, e_full, "a different river strategy, a different value");
        assert!(e > 0.0 && e_full > 0.0);

        // evaluate: nothing on the river; the turn nodes as in `mixed`; export writes no river node
        let ev = s.evaluate();
        let mut ev_mixed = mixed.evaluate();
        for (i, n) in tree.nodes.iter().enumerate() {
            if n.street == 2 {
                assert!(ev[i].is_none());
                ev_mixed[i] = None;
            } else if let Some(e) = &ev[i] {
                let m = ev_mixed[i].as_ref().unwrap();
                assert_eq!((&e.weight, &e.freq, &e.ev, &e.eq, e.reach), (&m.weight, &m.freq, &m.ev, &m.eq, m.reach));
            }
        }
        let (bytes, map) = export_with_map(&tree, &ev, 0.0);
        assert!(map.iter().all(|&i| tree.nodes[i as usize].street < 2));
        assert!(map.iter().any(|&i| matches!(tree.nodes[i as usize].kind, PKind::Decision { .. })));
        assert_eq!(bytes, export(&tree, &ev_mixed, 0.0));
    }

    // ---- threads (REFACTOR_PLAN 3-3-2): every result bit for bit that of 1 thread

    /// everything a caller can read after a solve, as bits: regrets, strategy sums, averages, exploitability,
    /// root values, every field of `evaluate`; and the exported files
    fn everything(tree: &Tree, s: &mut Solver) -> (Vec<u32>, Vec<u8>) {
        let mut bits = Vec::new();
        for x in s.regret.iter().chain(s.ssum.iter()).chain(s.avg.iter()) {
            bits.push(x.len() as u32);
            bits.extend(x.iter().map(|y| y.to_bits()));
        }
        bits.push(s.exploitability().to_bits());
        bits.extend(s.root_values().map(f32::to_bits));
        let ev = s.evaluate();
        for e in &ev {
            match e {
                Some(e) => {
                    bits.extend([1, e.player as u32, e.reach.to_bits()]);
                    for v in [&e.weight, &e.freq, &e.ev, &e.eq] {
                        bits.push(v.len() as u32);
                        bits.extend(v.iter().map(|y| y.to_bits()));
                    }
                }
                None => bits.push(0),
            }
        }
        let mut file = export(tree, &ev, 0.0);
        file.extend(export(tree, &ev, 0.004));
        (bits, file)
    }

    fn solve_with_threads<'t>(tree: &'t Tree, ranges: &[Vec<f32>; 2], opts: SolverOptions, iters: u32, lock: Option<(usize, Vec<f32>)>) -> Solver<'t> {
        let mut s = Solver::with_options(tree, ranges, opts);
        if let Some((node, strategy)) = lock {
            s.lock_node(node, strategy).unwrap();
        }
        for i in 0..iters {
            if i == iters / 2 {
                s.reset_average();
            }
            s.iterate();
        }
        s.finalize_avg();
        s
    }

    /// compares 1, 2 and 4 threads, f32 values as bits (so that -0 and 0 differ)
    fn assert_threads_agree(tree: &Tree, ranges: &[Vec<f32>; 2], no_average_from: u8, iters: u32, lock: Option<(usize, Vec<f32>)>) {
        let run = |threads: usize| {
            let mut s = solve_with_threads(tree, ranges, SolverOptions { no_average_from, threads, ..Default::default() }, iters, lock.clone());
            assert_eq!(s.threads(), threads);
            everything(tree, &mut s)
        };
        let one = run(1);
        assert!(one.0.len() > 1000 && one.1.len() > 1000);
        for t in [2, 4] {
            let other = run(t);
            assert!(other.0 == one.0, "{} threads: different values", t);
            assert!(other.1 == one.1, "{} threads: different file", t);
        }
    }

    #[test]
    fn threads_give_the_same_bits_on_a_flop_tree() {
        // 5 turn cards x 2 river cards; flop all-ins over 24 run-outs; partial ranges
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(3);
        assert_threads_agree(&tree, &ranges, 3, 30, None);
        // no river average (plan B of 3-3)
        assert_threads_agree(&tree, &ranges, 2, 30, None);
        // a locked node above the parallel part (the flop root) and one inside a turn subtree
        let na = |i: usize| match &tree.nodes[i].kind {
            PKind::Decision { children, .. } => children.len(),
            _ => unreachable!(),
        };
        let lock = |na: usize| {
            let mut l = vec![0f32; na * NC];
            for h in 0..NC {
                l[h] = 0.25 + (h % 3) as f32 * 0.25;
                for a in 1..na {
                    l[a * NC + h] = (1.0 - l[h]) / (na - 1) as f32;
                }
            }
            l
        };
        assert_threads_agree(&tree, &ranges, 3, 30, Some((0, lock(na(0)))));
        let turn = tree.nodes.iter().position(|n| n.street == 1 && matches!(n.kind, PKind::Decision { .. })).unwrap();
        assert_threads_agree(&tree, &ranges, 3, 30, Some((turn, lock(na(turn)))));
    }

    #[test]
    fn threads_give_the_same_bits_on_a_turn_tree() {
        // a turn tree forks at its river chance nodes (10 river cards)
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 10, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        assert_threads_agree(&tree, &mixed_ranges(2), 3, 40, None);
    }

    /// the children of every node own consecutive node ranges (what the parallel walk splits the arrays by)
    #[test]
    fn subtrees_are_consecutive_node_ranges() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let end = subtree_ends(&tree);
        assert_eq!(end[0] as usize, tree.nodes.len());
        for (i, n) in tree.nodes.iter().enumerate() {
            if let PKind::Decision { children, .. } | PKind::Chance { children, .. } = &n.kind {
                assert_eq!(children[0] as usize, i + 1);
                for w in children.windows(2) {
                    assert_eq!(end[w[0] as usize], w[1]);
                }
                assert_eq!(end[*children.last().unwrap() as usize], end[i]);
            } else {
                assert_eq!(end[i] as usize, i + 1);
            }
        }
    }

    /// `flop_runouts: 1176` values a flop all-in over every (turn, river) pair, each with weight 1/990
    #[test]
    fn flop_runouts_1176_deals_every_run_out() {
        let b = board("As 7d 2c");
        let cfg = Config { pot: 6.0, stack: 9.0, bets: [vec![0.5], vec![], vec![]], raise_sizes: [false; 3], allow_allin: true, turn_cards: 2, river_cards: 2, flop_runouts: 1176, ..Config::default() };
        let tree = build_tree(&cfg, &b);
        let fm = mask_of(&b);
        let mut n_allin = 0;
        for n in &tree.nodes {
            if let PKind::AllIn { tables, weight } = &n.kind {
                if n.board.len() != 3 {
                    continue;
                }
                n_allin += 1;
                assert_eq!(*weight, 1.0 / 990.0);
                let runs: std::collections::HashSet<u64> = tables.iter().map(|&t| tree.tables[t as usize].mask & !fm).collect();
                assert_eq!(runs.len(), 1176);
                assert!(runs.iter().all(|m| m.count_ones() == 2));
            }
        }
        assert!(n_allin > 0);
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

    // ---- the river walk (REFACTOR_PLAN 3-3-4): `river.rs` against the general walk

    /// Solves a river tree with the river walk (`iterate`) and with the general walk (`iterate_full_width`), the average
    /// restarted half-way, and compares: average strategies and exploitability within 1e-4 (the plan's tolerance), and
    /// the regrets and strategy sums bit for bit (the river walk does the same arithmetic in the same order).
    fn assert_river_walk_matches(tree: &Tree, ranges: &[Vec<f32>; 2], opts: SolverOptions, iters: u32, locks: &[(usize, Vec<f32>)]) {
        let solve = |river_walk: bool| {
            let mut s = Solver::with_options(tree, ranges, opts);
            assert!(s.river.is_some(), "a river tree takes the river walk");
            for (node, l) in locks {
                s.lock_node(*node, l.clone()).unwrap();
            }
            for i in 0..iters {
                if i == iters / 2 {
                    s.reset_average();
                }
                if river_walk {
                    s.iterate();
                } else {
                    s.iterate_full_width();
                }
            }
            s.finalize_avg();
            s
        };
        let (mut a, mut b) = (solve(true), solve(false));
        let bits = |v: &Vec<f32>| v.iter().map(|x| x.to_bits()).collect::<Vec<u32>>();
        let mut worst = 0f32;
        for i in 0..tree.nodes.len() {
            assert_eq!(bits(&a.regret[i]), bits(&b.regret[i]), "regrets of node {}", i);
            assert_eq!(bits(&a.ssum[i]), bits(&b.ssum[i]), "strategy sums of node {}", i);
            assert_eq!(a.avg[i].len(), b.avg[i].len());
            for (x, y) in a.avg[i].iter().zip(&b.avg[i]) {
                worst = worst.max((x - y).abs());
            }
        }
        assert!(worst <= 1e-4, "average strategies differ by {}", worst);
        let pot = tree.cfg.pot;
        let (ea, eb) = (100.0 * a.exploitability() / pot, 100.0 * b.exploitability() / pot);
        assert!((ea - eb).abs() <= 1e-4, "exploitability {}% vs {}% of the pot", ea, eb);
        assert!(ea > 0.0 && ea < 100.0, "exploitability {}%", ea);
    }

    /// a strategy for `lock_node`: per hand, a mix that depends on the hand
    fn uneven_lock(na: usize) -> Vec<f32> {
        let mut l = vec![0f32; na * NC];
        for h in 0..NC {
            let w: Vec<f32> = (0..na).map(|a| 1.0 + ((h * 7 + a * 3) % 5) as f32).collect();
            let sum: f32 = w.iter().sum();
            for a in 0..na {
                l[a * NC + h] = w[a] / sum;
            }
        }
        l
    }

    fn actions(tree: &Tree, i: usize) -> usize {
        match &tree.nodes[i].kind {
            PKind::Decision { children, .. } => children.len(),
            _ => 0,
        }
    }

    #[test]
    fn river_walk_matches_the_general_walk() {
        // two sizes, raises and all-ins (an all-in call is a showdown); partial ranges with ~40 % of the combos out
        let cfg = Config { pot: 10.0, stack: 40.0, bets: [vec![], vec![], vec![0.5, 1.0]], raise_sizes: [false, false, true], allow_allin: true, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        assert!(tree.nodes.len() > 20);
        assert_river_walk_matches(&tree, &mixed_ranges(1), SolverOptions::default(), 300, &[]);
        // the default tree (gen_postflop's river), a paired board, other ranges
        let tree = build_tree(&Config::default(), &board("Kd Kh 9c 4s 4d"));
        assert_river_walk_matches(&tree, &mixed_ranges(5), SolverOptions::default(), 300, &[]);
        // one player holds 9 combos, the other 6 (the clairvoyant game): most showdown entries are one player's only
        let oop = ["AdAc", "AdAs", "AcAs", "6c5c", "6d5d", "6h5h", "6s5s", "9c4c", "9d4h"];
        let ip = ["QcQd", "QcQh", "QcQs", "QdQh", "QdQs", "QhQs"];
        let r = |l: &[&str]| range_of(&l.iter().map(|s| (&s[0..2], &s[2..4], 1.0)).collect::<Vec<_>>());
        let tree = build_tree(&river_cfg(), &board("Ah 8d 7c 2s 3d"));
        assert_river_walk_matches(&tree, &[r(&oop), r(&ip)], SolverOptions::default(), 300, &[]);
    }

    #[test]
    fn river_walk_matches_with_locked_nodes_and_without_averages() {
        let cfg = Config { pot: 10.0, stack: 40.0, bets: [vec![], vec![], vec![0.5, 1.0]], raise_sizes: [false, false, true], allow_allin: true, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        let ranges = mixed_ranges(1);
        // the root (OOP) and IP's node after a check
        let ip = (1..tree.nodes.len()).find(|&i| matches!(tree.nodes[i].kind, PKind::Decision { player: 1, .. })).unwrap();
        let locks = [(0, uneven_lock(actions(&tree, 0))), (ip, uneven_lock(actions(&tree, ip)))];
        assert_river_walk_matches(&tree, &ranges, SolverOptions::default(), 200, &locks);
        // no strategy average on the river (plan B's precomputation): the current strategies are compared
        assert_river_walk_matches(&tree, &ranges, SolverOptions { no_average_from: 2, ..Default::default() }, 200, &locks[..1]);
    }

    /// REFACTOR_PLAN 3-2: at every terminal of `tree` (fold, showdown, all-in run-outs), walked with partial ranges,
    /// the two players' payouts (value + what they put in postflop, weighted by their reach) add up to the pot minus
    /// the rake, per unit of the pairs of hands that meet there; the rake is `pct`% of the pot the winner takes (the
    /// pot before the flop + what both matched), at most `cap`.  Returns the number of terminals of each kind (fold,
    /// showdown, all-in) and how many of the raked ones are at the cap.
    fn assert_payouts_add_up(tree: &Tree, pct: f32, cap: f32) -> ([usize; 3], usize) {
        let ranges = mixed_ranges(3);
        let mut s = Solver::new(tree, &ranges);
        let (mut seen, mut capped) = ([0usize; 3], 0);
        for (i, node) in tree.nodes.iter().enumerate() {
            let kind = match node.kind {
                PKind::Fold { .. } => 0,
                PKind::Showdown { .. } => 1,
                PKind::AllIn { .. } => 2,
                _ => continue,
            };
            seen[kind] += 1;
            let pot = tree.cfg.pot + node.inv[0] + node.inv[1];
            let raked = tree.cfg.pot + 2.0 * node.inv[0].min(node.inv[1]);
            let rake = (raked * pct / 100.0).min(cap);
            if rake == cap {
                capped += 1;
            }
            let bm = mask_of(&node.board);
            let r: Vec<Vec<f32>> = ranges.iter().map(|r| (0..NC).map(|h| if blocked(bm, h) { 0.0 } else { r[h] }).collect()).collect();
            let res = s.run_from(i, &r[0], &r[1], Mode::Eval, None, true);
            let mass: Vec<f64> = (0..2).map(|p| (0..NC).map(|h| r[p][h] as f64 * res.m[p][h] as f64).sum()).collect();
            assert!(mass[0] > 1.0 && (mass[0] - mass[1]).abs() < 1e-4 * mass[0], "node {}: pair mass {:?}", i, mass);
            let paid: f64 = (0..2).map(|p| (0..NC).map(|h| r[p][h] as f64 * (res.v[p][h] + node.inv[p] * res.m[p][h]) as f64).sum::<f64>()).sum();
            let want = (pot - rake) as f64 * mass[0];
            assert!((paid - want).abs() < 1e-4 * pot as f64 * mass[0], "node {} ({:?}): payouts {} vs (pot {} - rake {}) x {}", i, kind, paid / mass[0], pot, rake, mass[0]);
        }
        (seen, capped)
    }

    #[test]
    fn payouts_add_up_to_the_pot_minus_the_rake_at_every_terminal() {
        // flop: raises, all-ins on every street (flop all-ins over sampled run-outs), folds to an uncalled bet
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 2, river_cards: 2, flop_runouts: 24, rake_pct: 5.0, rake_cap: 2.0, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let (seen, capped) = assert_payouts_add_up(&tree, 5.0, 2.0);
        assert!(seen.iter().all(|&n| n > 0) && capped > 0 && capped < seen.iter().sum::<usize>(), "terminals {:?}, {} at the cap", seen, capped);
        // a fold to a bet pays the rake of the pot before the bet (the bet goes back), not of the pot with it
        let fold = tree.nodes.iter().find(|n| matches!(n.kind, PKind::Fold { .. }) && n.inv[0] == 0.0 && n.inv[1] > 0.0).expect("a fold to a flop bet");
        assert_eq!(tree.cfg.pot_paid(fold.inv), 6.0 + fold.inv[1] - 0.3);
        // the river alone (the tree the device solves; its walk is checked against this one below), no cap
        let cfg = Config { pot: 10.0, stack: 40.0, bets: [vec![], vec![], vec![0.5, 1.0]], raise_sizes: [false, false, true], allow_allin: true, rake_pct: 4.5, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        let (seen, capped) = assert_payouts_add_up(&tree, 4.5, crate::rake::NO_CAP);
        assert!(seen[0] > 0 && seen[1] > 0 && capped == 0, "terminals {:?}", seen);
        // the turn: all-ins over every river card
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 3, rake_pct: 10.0, rake_cap: 3.0, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        let (seen, _) = assert_payouts_add_up(&tree, 10.0, 3.0);
        assert!(seen.iter().all(|&n| n > 0), "terminals {:?}", seen);
    }

    /// without rake every terminal pays out the whole pot, bit for bit as before rake existed
    #[test]
    fn no_rake_pays_the_whole_pot() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 2, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        for n in &tree.nodes {
            let old = tree.cfg.pot + n.inv[0] + n.inv[1];
            assert_eq!(tree.cfg.pot_paid(n.inv).to_bits(), old.to_bits());
        }
        let (seen, _) = assert_payouts_add_up(&tree, 0.0, crate::rake::NO_CAP);
        assert!(seen.iter().all(|&n| n > 0));
    }

    /// the river walk (the device's solve) pays the same rake as the general walk: the same bits
    #[test]
    fn river_walk_matches_the_general_walk_with_rake() {
        let cfg = Config { pot: 10.0, stack: 40.0, bets: [vec![], vec![], vec![0.5, 1.0]], raise_sizes: [false, false, true], allow_allin: true, rake_pct: 5.0, rake_cap: 2.0, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        assert_river_walk_matches(&tree, &mixed_ranges(1), SolverOptions::default(), 300, &[]);
        // and the rake changes the solution (else the comparison would not show that both walks pay it)
        let solve = |c: &Config| {
            let t = build_tree(c, &board("Ah 8d 7c 2s 3d"));
            let mut s = Solver::new(&t, &mixed_ranges(1));
            for _ in 0..100 {
                s.iterate();
            }
            s.regret.iter().flatten().map(|x| x.to_bits()).collect::<Vec<u32>>()
        };
        assert_ne!(solve(&cfg), solve(&Config { rake_pct: 0.0, ..cfg.clone() }));
    }

    #[test]
    fn river_walk_is_only_for_river_trees() {
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 2, ..Config::default() };
        let ranges = mixed_ranges(2);
        let turn = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        assert!(Solver::new(&turn, &ranges).river.is_none());
        let river = build_tree(&cfg, &board("Ks 9h 5h 2d 2c"));
        assert!(Solver::new(&river, &ranges).river.is_some());
    }

    // ---- alternating updates and DCFR (REFACTOR_PLAN 4-1)

    const ALTERNATING: [Update; 2] = [Update::AltCfrPlus, Update::AltDcfr];

    /// the tree and ranges of `three_street_solve_converges`
    fn three_street_game() -> (Tree, [Vec<f32>; 2]) {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 2, river_cards: 1, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let (mut r0, mut r1) = (vec![0f32; NC], vec![0f32; NC]);
        for (i, &(a, b)) in ct().cards.iter().enumerate() {
            let (ra, rb) = (a >> 2, b >> 2);
            if ra == rb {
                r0[i] = 1.0;
                r1[i] = 1.0;
            } else if ra >= 8 && rb >= 8 {
                r0[i] = 1.0;
            } else if (a & 3) == (b & 3) && ra.abs_diff(rb) == 1 {
                r1[i] = 1.0;
            }
        }
        (tree, [r0, r1])
    }

    fn solve_with(tree: &Tree, ranges: &[Vec<f32>; 2], update: Update, iters: u32) -> f32 {
        let mut s = Solver::with_options(tree, ranges, SolverOptions { update, ..Default::default() });
        for _ in 0..iters {
            s.iterate();
        }
        s.finalize_avg();
        let v = s.root_values();
        // the turn and river cards are sampled, so the two values do not add up to the pot exactly: the sum moves towards
        // about 6.06 as any update converges (simultaneous CFR+: 6.025 / 6.038 / 6.047 after 200 / 400 / 800 iterations)
        assert!((v[0] + v[1] - tree.cfg.pot).abs() < 0.1, "{:?}: constant sum {:?}", update, v);
        s.exploitability()
    }

    #[test]
    fn update_names_round_trip_and_the_default_is_the_solver_as_it_was() {
        for u in [Update::SimCfrPlus, Update::AltCfrPlus, Update::AltDcfr] {
            assert_eq!(Update::parse(u.name()), Some(u));
        }
        assert_eq!(Update::parse("cfr"), None);
        assert_eq!(SolverOptions::default().update, Update::SimCfrPlus);
        assert_eq!((Update::SimCfrPlus.walks(), Update::AltCfrPlus.walks()), (1, 2));
        // DCFR: nothing of iteration 0 is kept, the discounts approach 1
        assert_eq!(dcfr_discounts(1), (0.0, 0.5, 0.0));
        let (pos, neg, keep) = dcfr_discounts(1001);
        assert!(pos > 0.9999 && neg == 0.5 && (keep - (1000f32 / 1001.0).powi(2)).abs() < 1e-6);
    }

    /// the river game of `river_clairvoyant_game_matches_theory`, solved with alternating updates
    #[test]
    fn alternating_updates_solve_the_clairvoyant_river_game() {
        let b = board("Ah 8d 7c 2s 3d");
        let nuts: Vec<(&str, &str, f32)> = vec![("Ad", "Ac", 1.0), ("Ad", "As", 1.0), ("Ac", "As", 1.0)];
        let air: Vec<(&str, &str, f32)> = vec![("6c", "5c", 1.0), ("6d", "5d", 1.0), ("6h", "5h", 1.0), ("6s", "5s", 1.0), ("9c", "4c", 1.0), ("9d", "4h", 1.0)];
        let qq: Vec<(&str, &str, f32)> = vec![("Qc", "Qd", 1.0), ("Qc", "Qh", 1.0), ("Qc", "Qs", 1.0), ("Qd", "Qh", 1.0), ("Qd", "Qs", 1.0), ("Qh", "Qs", 1.0)];
        let mut oop = nuts.clone();
        oop.extend(air.clone());
        let tree = build_tree(&river_cfg(), &b);
        let (bet_size, pot) = (7.5f32, 10.0f32);
        let (wn, wa) = (nuts.len() as f32, air.len() as f32);
        let bluff_theory = bet_size * wn / (wa * (pot + bet_size));
        let call_theory = pot / (pot + bet_size);
        for update in ALTERNATING {
            let mut s = Solver::with_options(&tree, &[range_of(&oop), range_of(&qq)], SolverOptions { update, ..Default::default() });
            for _ in 0..1500 {
                s.iterate();
            }
            s.finalize_avg();
            let expl = s.exploitability();
            assert!(expl < 0.02 * 10.0, "{:?}: exploitability {} chips", update, expl);
            let root = &s.avg[0];
            let bluff: f32 = air.iter().map(|&(x, y, _)| root[NC + combo(x, y)]).sum::<f32>() / wa;
            assert!((bluff - bluff_theory).abs() < 0.04, "{:?}: bluff {} vs theory {}", update, bluff, bluff_theory);
            let facing = tree.nodes.iter().position(|n| matches!(&n.kind, PKind::Decision { player: 1, acts, .. } if acts.len() == 2 && acts[0].kind == 0)).unwrap();
            let call: f32 = qq.iter().map(|&(x, y, _)| s.avg[facing][NC + combo(x, y)]).sum::<f32>() / 6.0;
            assert!((call - call_theory).abs() < 0.04, "{:?}: call {} vs theory {}", update, call, call_theory);
        }
    }

    /// with the same number of walks of the tree, alternating updates end closer to an equilibrium (`docs/15` §2)
    #[test]
    fn alternating_updates_beat_simultaneous_ones_with_the_same_walks() {
        let (tree, ranges) = three_street_game();
        let sim = solve_with(&tree, &ranges, Update::SimCfrPlus, 400);
        for update in ALTERNATING {
            let alt = solve_with(&tree, &ranges, update, 200);
            assert!(alt < sim, "{:?}: {} chips after 400 walks, simultaneous CFR+ {}", update, alt, sim);
            assert!(alt < 0.04 * 6.0, "{:?}: exploitability {} chips of a 6 chip pot", update, alt);
        }
    }

    /// an alternating walk does not compute the values of the player it does not update; computing them does not change
    /// a bit of the regrets or strategy sums
    #[test]
    fn alternating_walks_skip_the_unused_values_without_changing_a_bit() {
        let (tree, ranges) = three_street_game();
        for update in ALTERNATING {
            let run = |full: bool| {
                let mut s = Solver::with_options(&tree, &ranges, SolverOptions { update, ..Default::default() });
                s.alt_full_values = full;
                for _ in 0..25 {
                    s.iterate();
                }
                let bits = |v: &Vec<Vec<f32>>| v.iter().flatten().map(|x| x.to_bits()).collect::<Vec<u32>>();
                (bits(&s.regret), bits(&s.ssum))
            };
            let (skip, full) = (run(false), run(true));
            assert!(skip.0.len() > 1000);
            assert!(skip == full, "{:?}: skipping the other player's values changed the result", update);
        }
    }

    #[test]
    fn alternating_updates_give_the_same_bits_on_any_number_of_threads() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(3);
        for update in ALTERNATING {
            let run = |threads: usize| {
                let mut s = solve_with_threads(&tree, &ranges, SolverOptions { threads, update, ..Default::default() }, 20, None);
                everything(&tree, &mut s)
            };
            let one = run(1);
            let four = run(4);
            assert!(one.0 == four.0 && one.1 == four.1, "{:?}: 4 threads differ from 1", update);
        }
    }

    // ---- the river subtree walk (REFACTOR_PLAN 4-2)

    /// trains `iters` iterations with and without the river subtree walk and compares the regrets and strategy sums as bits
    fn assert_river_subtree_walk_matches(tree: &Tree, ranges: &[Vec<f32>; 2], opts: SolverOptions, iters: u32, locks: &[(usize, Vec<f32>)]) {
        let run = |fast: bool| {
            let mut s = Solver::with_options(tree, ranges, opts);
            assert!(s.river_plans.is_some(), "the tree has river subtrees");
            s.set_river_subtree_walk(fast);
            for (n, l) in locks {
                s.lock_node(*n, l.clone()).unwrap();
            }
            for i in 0..iters {
                if i == iters / 2 && opts.update != Update::AltDcfr {
                    s.reset_average();
                }
                s.iterate();
            }
            let bits = |v: &Vec<Vec<f32>>| v.iter().flatten().map(|x| x.to_bits()).collect::<Vec<u32>>();
            (bits(&s.regret), bits(&s.ssum))
        };
        let (general, fast) = (run(false), run(true));
        assert!(general.0.len() > 1000, "a tree with regrets");
        assert!(general.0 == fast.0, "{:?}: regrets differ", opts);
        assert!(general.1 == fast.1, "{:?}: strategy sums differ", opts);
    }

    #[test]
    fn river_subtree_walk_gives_the_bits_of_the_general_walk() {
        let flop = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.5, 1.0]], allow_allin: true, turn_cards: 4, river_cards: 3, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&flop, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(7);
        for update in [Update::SimCfrPlus, Update::AltCfrPlus, Update::AltDcfr] {
            for (no_average_from, threads) in [(3, 1), (2, 1), (3, 4)] {
                let opts = SolverOptions { no_average_from, threads, update, ..Default::default() };
                assert_river_subtree_walk_matches(&tree, &ranges, opts, 12, &[]);
            }
        }
        // a turn tree with every river card, with rake
        let turn = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 48, rake_pct: 5.0, rake_cap: 3.0, ..Config::default() };
        let tree = build_tree(&turn, &board("Ks 9h 5h 2d"));
        for update in [Update::SimCfrPlus, Update::AltCfrPlus] {
            assert_river_subtree_walk_matches(&tree, &ranges, SolverOptions { update, ..Default::default() }, 10, &[]);
        }
    }

    #[test]
    fn river_subtree_walk_leaves_locked_subtrees_to_the_general_walk() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 3, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(3);
        let na = |i: usize| match &tree.nodes[i].kind {
            PKind::Decision { children, .. } => children.len(),
            _ => unreachable!(),
        };
        let lock = |na: usize| {
            let mut l = vec![0f32; na * NC];
            for h in 0..NC {
                l[h] = 0.3 + (h % 4) as f32 * 0.15;
                for a in 1..na {
                    l[a * NC + h] = (1.0 - l[h]) / (na - 1) as f32;
                }
            }
            l
        };
        let river = tree.nodes.iter().position(|n| n.street == 2 && matches!(n.kind, PKind::Decision { .. })).unwrap();
        let turn = tree.nodes.iter().position(|n| n.street == 1 && matches!(n.kind, PKind::Decision { .. })).unwrap();
        for update in [Update::SimCfrPlus, Update::AltDcfr] {
            let opts = SolverOptions { update, ..Default::default() };
            assert_river_subtree_walk_matches(&tree, &ranges, opts, 10, &[(river, lock(na(river)))]);
            assert_river_subtree_walk_matches(&tree, &ranges, opts, 10, &[(turn, lock(na(turn))), (0, lock(na(0)))]);
        }
    }

    #[test]
    fn river_trees_have_no_river_subtree_plans() {
        let river = build_tree(&river_cfg(), &board("Ah 8d 7c 2s 3d"));
        assert!(Solver::new(&river, &mixed_ranges(1)).river_plans.is_none());
    }
}
