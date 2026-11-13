//! Exploitability of a shipped postflop solution (`TSP1`) over **every** turn and river card.
//!
//! The shipped files were solved on a stratified sample of the turn / river cards (`docs/08` §3), and
//! `Solver::exploitability` measures the error inside that sample only.  Here the shipped strategy is
//! held fixed, extended to the cards that were not sampled by a fixed assignment rule, and each
//! player's best response is computed over the real deal (49 turns x 48 rivers, every flop all-in
//! run-out).  The definition is the one of `Solver::exploitability`: the sum of both players'
//! best-response gains, in chips (0 at equilibrium).  `docs/QUALITY.md` describes the method.
//!
//! Steps: `parse_tsp1` (read the file) -> rebuild the sampled tree with `build_tree` and pair its
//! nodes with the file (`match_tree`) -> `shipped_strategy` (a full strategy for every decision node of
//! the sampled tree, filling hands / lines the file left out) -> `FullBr::exploitability` (walk the
//! sampled tree, dealing every real card and mapping it onto a sampled one).
use crate::postflop::*;
use std::collections::HashMap;

// ------------------------------------------------------------------ TSP1 reader

pub struct FileEdge {
    pub kind: u8,
    pub amount: f32,
    pub code: i32,
}

pub struct FileNode {
    pub street: u8,
    pub inv: [f32; 2],
    /// 0 decision, 1 chance
    pub kind: u8,
    pub actor: u8,
    pub reach: f32,
    pub edges: Vec<FileEdge>,
    /// decision nodes: the combos of the bitmap, their weight (x255) and frequencies (na x n, x255)
    pub hands: Vec<u16>,
    pub weight: Vec<u8>,
    pub freq: Vec<u8>,
}

pub struct Tsp1 {
    pub board: Vec<u8>,
    pub pot: f32,
    pub stack: f32,
    pub nodes: Vec<FileNode>,
}

struct Rd<'a> {
    b: &'a [u8],
    o: usize,
}

impl Rd<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        if self.o + n > self.b.len() {
            return Err(format!("truncated at byte {}", self.o));
        }
        let s = &self.b[self.o..self.o + n];
        self.o += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        let s = self.take(2)?;
        Ok(u16::from_le_bytes([s[0], s[1]]))
    }
    fn i32(&mut self) -> Result<i32, String> {
        let s = self.take(4)?;
        Ok(i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn f32(&mut self) -> Result<f32, String> {
        let s = self.take(4)?;
        Ok(f32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
}

/// Read a raw (not gzipped) `TSP1` v2 file (`docs/03-solution-format.md`).
pub fn parse_tsp1(bytes: &[u8]) -> Result<Tsp1, String> {
    let mut r = Rd { b: bytes, o: 0 };
    if r.take(4)? != b"TSP1" {
        return Err("not a TSP1 file".into());
    }
    let ver = r.u8()?;
    if ver != 2 {
        return Err(format!("unsupported TSP1 version {}", ver));
    }
    let nb = r.u8()? as usize;
    let board = r.take(nb)?.to_vec();
    let pot = r.f32()?;
    let stack = r.f32()?;
    let n = r.u16()? as usize;
    let mut nodes = Vec::with_capacity(n);
    for _ in 0..n {
        let street = r.u8()?;
        let inv = [r.f32()?, r.f32()?];
        let kind = r.u8()?;
        let actor = r.u8()?;
        let reach = r.f32()?;
        let ne = r.u8()? as usize;
        let mut edges = Vec::with_capacity(ne);
        for _ in 0..ne {
            edges.push(FileEdge { kind: r.u8()?, amount: r.f32()?, code: r.i32()? });
        }
        let (mut hands, mut weight, mut freq) = (Vec::new(), Vec::new(), Vec::new());
        if kind == 0 {
            let bm = r.take(NC.div_ceil(8))?.to_vec();
            hands = (0..NC).filter(|&h| (bm[h / 8] >> (h % 8)) & 1 == 1).map(|h| h as u16).collect();
            let k = hands.len();
            weight = r.take(k)?.to_vec();
            r.take(k)?; // equity
            freq = r.take(ne * k)?.to_vec();
            r.take(2 * k)?; // best EV
            r.take(ne * k)?; // losses
        }
        nodes.push(FileNode { street, inv, kind, actor, reach, edges, hands, weight, freq });
    }
    if r.o != bytes.len() {
        return Err(format!("{} trailing bytes", bytes.len() - r.o));
    }
    Ok(Tsp1 { board, pot, stack, nodes })
}

/// Pair every node of the rebuilt tree with its node in the file (`None` = not written: a rare line).
/// Fails if the structure (streets, investments, actions, sampled cards) differs.
pub fn match_tree(tree: &Tree, f: &Tsp1) -> Result<Vec<Option<usize>>, String> {
    if tree.board != f.board || (tree.cfg.pot - f.pot).abs() > 1e-4 || (tree.cfg.stack - f.stack).abs() > 1e-4 {
        return Err("board / pot / stack differ".into());
    }
    let mut map = vec![None; tree.nodes.len()];
    if f.nodes.is_empty() {
        return Err("empty file".into());
    }
    fn go(t: &Tree, f: &Tsp1, ti: usize, fi: usize, map: &mut Vec<Option<usize>>) -> Result<(), String> {
        let (tn, fnd) = (&t.nodes[ti], &f.nodes[fi]);
        let bad = |why: &str| Err(format!("tree node {} / file node {}: {}", ti, fi, why));
        if tn.street != fnd.street || (tn.inv[0] - fnd.inv[0]).abs() > 1e-3 || (tn.inv[1] - fnd.inv[1]).abs() > 1e-3 {
            return bad("street / investment");
        }
        map[ti] = Some(fi);
        let children: &[u32] = match (&tn.kind, fnd.kind) {
            (PKind::Decision { player, acts, children }, 0) => {
                if *player != fnd.actor || acts.len() != fnd.edges.len() {
                    return bad("actor / actions");
                }
                for (a, e) in acts.iter().zip(&fnd.edges) {
                    if a.kind != e.kind || (a.amount - e.amount).abs() > 1e-3 {
                        return bad("action kind / amount");
                    }
                }
                children
            }
            (PKind::Chance { cards, children, .. }, 1) => {
                if cards.len() != fnd.edges.len() || cards.iter().zip(&fnd.edges).any(|(&c, e)| c != e.kind) {
                    return bad("sampled cards");
                }
                children
            }
            _ => return bad("node kind"),
        };
        for (&c, e) in children.iter().zip(&fnd.edges) {
            let ck = &t.nodes[c as usize].kind;
            let ok = match e.code {
                -1 => matches!(ck, PKind::Fold { .. }),
                -3 => matches!(ck, PKind::Showdown { .. }),
                -4 => matches!(ck, PKind::AllIn { .. }),
                -2 => matches!(ck, PKind::Decision { .. } | PKind::Chance { .. }),
                x if x >= 0 && (x as usize) < f.nodes.len() => {
                    go(t, f, c as usize, x as usize, map)?;
                    true
                }
                _ => false,
            };
            if !ok {
                return bad("child code");
            }
        }
        Ok(())
    }
    go(tree, f, 0, 0, &mut map)?;
    Ok(map)
}

// ------------------------------------------------------------------ card mapping

/// How a real turn / river card that was not sampled is mapped onto a sampled one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Assign {
    /// nearest sample: flush class, then rank distance, then pairing class, then the card's own stratum
    Nearest,
    /// the sample of the stratum (as in `pick_cards`) the card falls into
    Stratum,
}

/// Permutation of the 52 cards that maps `from[i]` to `to[i]` for every dealt card (`i >= 3`; the
/// flop is shared) and is otherwise as close to the identity as possible.  It maps the live cards
/// of `from` one to one onto the live cards of `to`; a hand holding a card that is dead in `to`
/// becomes the hand holding the corresponding card of `from`.
pub fn board_perm(from: &[u8], to: &[u8]) -> [u8; 52] {
    let mut p: [u8; 52] = std::array::from_fn(|i| i as u8);
    let mut inv = p;
    for i in 3..from.len() {
        let (x, y) = (from[i] as usize, to[i]);
        if p[x] != y {
            let z = inv[y as usize] as usize;
            let px = p[x];
            p[x] = y;
            p[z] = px;
            inv[y as usize] = x as u8;
            inv[px as usize] = z as u8;
        }
    }
    p
}

fn hand_perm(p: &[u8; 52]) -> Vec<u16> {
    let t = ct();
    t.cards.iter().map(|&(a, b)| t.index(p[a as usize], p[b as usize]) as u16).collect()
}

/// Index of the stratum (as built by `pick_cards`) of card `c` among the unseen cards of `board`.
fn stratum_of(board: &[u8], k: usize, c: u8) -> usize {
    let mut rem: Vec<u8> = (0..52u8).filter(|x| !board.contains(x)).collect();
    rem.sort_by_key(|&x| std::cmp::Reverse((x >> 2, x & 3)));
    let n = rem.len();
    let i = rem.iter().position(|&x| x == c).expect("card is unseen");
    if k >= n {
        return i;
    }
    (0..k).find(|&s| s * n / k <= i && i < (s + 1) * n / k).unwrap()
}

/// 0 while no flush is possible on the board, else (cards of that suit on the board) - 2
fn flush_class(board: &[u8], c: u8) -> u8 {
    let n = board.iter().filter(|&&x| x & 3 == c & 3).count() as u8 + 1;
    n.saturating_sub(2)
}

fn pair_class(board: &[u8], c: u8) -> u8 {
    board.iter().filter(|&&x| x >> 2 == c >> 2).count() as u8
}

/// Which of the sampled `cards` (dealt on `board`, both in the sampled tree's card space) stands for
/// the unseen card `c`.
pub fn assign_card(board: &[u8], cards: &[u8], c: u8, rule: Assign) -> usize {
    if let Some(j) = cards.iter().position(|&x| x == c) {
        return j;
    }
    let own = stratum_of(board, cards.len(), c);
    match rule {
        Assign::Stratum => own,
        Assign::Nearest => (0..cards.len())
            .min_by_key(|&j| {
                let s = cards[j];
                (
                    flush_class(board, c) != flush_class(board, s),
                    (c >> 2).abs_diff(s >> 2),
                    pair_class(board, c) != pair_class(board, s),
                    j != own,
                    j,
                )
            })
            .unwrap(),
    }
}

// ------------------------------------------------------------------ strategy of the shipped file

/// What the strategy of a decision node is made of when the file does not have it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fallback {
    /// check, or call when facing a bet
    Passive,
    /// check, or fold when facing a bet
    Fold,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    File,
    /// the same line under another sampled card
    Twin,
    /// the line is missing under every sampled card: `Fallback`
    Default,
}

pub struct Shipped {
    /// starting ranges (OOP: weights of the root node; IP: weights of its first decision)
    pub prior: [Vec<f32>; 2],
    /// per tree node: na x NC (empty for non-decision nodes)
    pub strat: Vec<Vec<f32>>,
    pub source: Vec<Option<Source>>,
    /// hands that were outside the node's bitmap (weight < 0.01) and got the node's average mix
    pub filled_hands: usize,
}

impl Shipped {
    pub fn count(&self, s: Source) -> usize {
        self.source.iter().filter(|x| **x == Some(s)).count()
    }
}

/// Turn the file into a full strategy on the rebuilt (sampled) tree.
///
/// * a node in the file: the stored frequencies; hands outside the bitmap get the node's
///   weight-averaged action mix
/// * a node not in the file (a rare line): the same line under the nearest other sampled card
///   (nearest chance node first, cards in `Assign::Nearest` order), hands mapped by `board_perm`
/// * not under any sampled card either (the line was cut on the flop): `fallback`
pub fn shipped_strategy(tree: &Tree, f: &Tsp1, map: &[Option<usize>], fallback: Fallback) -> Result<Shipped, String> {
    let n = tree.nodes.len();
    let mut strat: Vec<Vec<f32>> = vec![Vec::new(); n];
    let mut source: Vec<Option<Source>> = vec![None; n];
    let mut filled_hands = 0;
    // file nodes
    for ti in 0..n {
        if let (PKind::Decision { children, .. }, Some(fi)) = (&tree.nodes[ti].kind, map[ti]) {
            let na = children.len();
            let fnd = &f.nodes[fi];
            let k = fnd.hands.len();
            let mut s = vec![0f32; na * NC];
            let mut mix = vec![0f64; na];
            let mut tot = 0f64;
            for (j, &h) in fnd.hands.iter().enumerate() {
                let w = fnd.weight[j] as f64;
                tot += w;
                for a in 0..na {
                    let q = fnd.freq[a * k + j] as f32 / 255.0;
                    s[a * NC + h as usize] = q;
                    mix[a] += w * q as f64;
                }
            }
            let mix: Vec<f32> = if tot > 0.0 { mix.iter().map(|x| (x / tot) as f32).collect() } else { vec![1.0 / na as f32; na] };
            let bm = mask_of(&tree.nodes[ti].board);
            let mut inb = vec![false; NC];
            for &h in &fnd.hands {
                inb[h as usize] = true;
            }
            for h in 0..NC {
                if !inb[h] {
                    if !blocked(bm, h) {
                        filled_hands += 1;
                    }
                    for a in 0..na {
                        s[a * NC + h] = mix[a];
                    }
                }
            }
            strat[ti] = s;
            source[ti] = Some(Source::File);
        }
    }
    // parent links: (parent, edge index)
    let mut parent: Vec<Option<(usize, usize)>> = vec![None; n];
    for (i, nd) in tree.nodes.iter().enumerate() {
        if let PKind::Decision { children, .. } | PKind::Chance { children, .. } = &nd.kind {
            for (e, &c) in children.iter().enumerate() {
                parent[c as usize] = Some((i, e));
            }
        }
    }
    let follow = |start: usize, path: &[usize]| -> Option<usize> {
        let mut cur = start;
        for &e in path {
            cur = match &tree.nodes[cur].kind {
                PKind::Decision { children, .. } | PKind::Chance { children, .. } => *children.get(e)? as usize,
                _ => return None,
            };
        }
        Some(cur)
    };
    for ti in 0..n {
        let PKind::Decision { acts, children, .. } = &tree.nodes[ti].kind else { continue };
        if source[ti].is_some() {
            continue;
        }
        let na = children.len();
        // path from each chance ancestor to this node; nearest ancestor first
        let mut path: Vec<usize> = Vec::new();
        let mut cur = ti;
        let mut found: Option<usize> = None;
        while let Some((p, e)) = parent[cur] {
            if let PKind::Chance { cards, children: ch, .. } = &tree.nodes[p].kind {
                let pb = &tree.nodes[p].board;
                let own = cards[e];
                let mut order: Vec<usize> = (0..cards.len()).filter(|&j| j != e).collect();
                let others: Vec<u8> = order.iter().map(|&j| cards[j]).collect();
                // the other samples, nearest to this node's card first
                let mut ranked: Vec<usize> = Vec::new();
                let mut left = others.clone();
                let mut left_idx = order.clone();
                while !left.is_empty() {
                    let k = assign_card(pb, &left, own, Assign::Nearest);
                    ranked.push(left_idx[k]);
                    left.remove(k);
                    left_idx.remove(k);
                }
                order = ranked;
                let rev: Vec<usize> = path.iter().rev().copied().collect();
                for j in order {
                    if let Some(tw) = follow(ch[j] as usize, &rev) {
                        if source[tw] == Some(Source::File) {
                            found = Some(tw);
                            break;
                        }
                    }
                }
                if found.is_some() {
                    break;
                }
            }
            path.push(e);
            cur = p;
        }
        if let Some(tw) = found {
            let PKind::Decision { children: tc, .. } = &tree.nodes[tw].kind else { unreachable!() };
            if tc.len() != na {
                return Err(format!("twin of node {} has a different action count", ti));
            }
            let hp = hand_perm(&board_perm(&tree.nodes[ti].board, &tree.nodes[tw].board));
            let src = &strat[tw];
            let mut s = vec![0f32; na * NC];
            for a in 0..na {
                for h in 0..NC {
                    s[a * NC + h] = src[a * NC + hp[h] as usize];
                }
            }
            strat[ti] = s;
            source[ti] = Some(Source::Twin);
        } else {
            let facing = acts[0].kind == 0;
            let pick = match fallback {
                Fallback::Passive => acts.iter().position(|a| a.kind == 1).unwrap(),
                Fallback::Fold => {
                    if facing {
                        0
                    } else {
                        acts.iter().position(|a| a.kind == 1).unwrap()
                    }
                }
            };
            let mut s = vec![0f32; na * NC];
            s[pick * NC..(pick + 1) * NC].iter_mut().for_each(|x| *x = 1.0);
            strat[ti] = s;
            source[ti] = Some(Source::Default);
        }
    }
    // starting ranges
    let root = map[0].ok_or("root missing")?;
    let PKind::Decision { children, .. } = &tree.nodes[0].kind else { return Err("root is not a decision".into()) };
    let ip_first = map[children[0] as usize].ok_or("IP's first decision missing")?;
    let mut prior = [vec![0f32; NC], vec![0f32; NC]];
    for (p, fi) in [(0usize, root), (1, ip_first)] {
        let fnd = &f.nodes[fi];
        if fnd.actor as usize != p {
            return Err("unexpected actor at the root".into());
        }
        for (j, &h) in fnd.hands.iter().enumerate() {
            prior[p][h as usize] = fnd.weight[j] as f32 / 255.0;
        }
    }
    Ok(Shipped { prior, strat, source, filled_hands })
}

// ------------------------------------------------------------------ best response over every card

struct Res {
    v: [Vec<f32>; 2],
    m: [Vec<f32>; 2],
}

impl Res {
    fn zero() -> Res {
        Res { v: [vec![0f32; NC], vec![0f32; NC]], m: [vec![0f32; NC], vec![0f32; NC]] }
    }
    fn add_scaled(&mut self, o: &Res, w: f32) {
        for p in 0..2 {
            for h in 0..NC {
                self.v[p][h] += w * o.v[p][h];
                self.m[p][h] += w * o.m[p][h];
            }
        }
    }
}

#[derive(Clone, Copy)]
enum Mode {
    Eval,
    Br(usize),
}

pub struct FullResult {
    /// both players' values under the fixed strategy (chips, incl. the share of the initial pot)
    pub base: [f32; 2],
    /// each player's best-response value against the other's fixed strategy
    pub br: [f32; 2],
    /// sum of both best-response gains (chips) = `Solver::exploitability`'s definition
    pub chips: f32,
    /// `100 * chips / pot`
    pub pct: f32,
}

/// Best response of each player against the other's fixed strategy, over every real turn and river
/// card (flop all-ins over all C(n,2) run-outs, turn all-ins over every river).
pub struct FullBr<'a> {
    tree: &'a Tree,
    strat: &'a [Vec<f32>],
    prior: [Vec<f32>; 2],
    rule: Assign,
    tables: HashMap<u64, Strength>,
}

impl<'a> FullBr<'a> {
    pub fn new(tree: &'a Tree, strat: &'a [Vec<f32>], prior: &[Vec<f32>; 2], rule: Assign) -> Self {
        let fm = mask_of(&tree.board);
        let mut pr = [prior[0].clone(), prior[1].clone()];
        for p in 0..2 {
            for h in 0..NC {
                if blocked(fm, h) {
                    pr[p][h] = 0.0;
                }
            }
        }
        FullBr { tree, strat, prior: pr, rule, tables: HashMap::new() }
    }

    fn table(&mut self, board5: &[u8]) -> &Strength {
        self.tables.entry(mask_of(board5)).or_insert_with(|| Strength::new(&[board5[0], board5[1], board5[2], board5[3], board5[4]]))
    }

    fn value(&self, res: &Res) -> [f32; 2] {
        let mut out = [0f32; 2];
        for p in 0..2 {
            let num: f64 = (0..NC).map(|h| self.prior[p][h] as f64 * res.v[p][h] as f64).sum();
            let z: f64 = (0..NC).map(|h| self.prior[p][h] as f64 * res.m[p][h] as f64).sum();
            out[p] = if z > 0.0 { (num / z) as f32 } else { 0.0 };
        }
        out
    }

    fn run(&mut self, mode: Mode) -> [f32; 2] {
        let board = self.tree.board.clone();
        let hp: Vec<u16> = (0..NC as u16).collect();
        let (r0, r1) = (self.prior[0].clone(), self.prior[1].clone());
        let res = self.walk(0, &board, &hp, &r0, &r1, mode);
        self.value(&res)
    }

    pub fn exploitability(&mut self) -> FullResult {
        let base = self.run(Mode::Eval);
        let br = [self.run(Mode::Br(0))[0], self.run(Mode::Br(1))[1]];
        let chips = (br[0] - base[0]).max(0.0) + (br[1] - base[1]).max(0.0);
        FullResult { base, br, chips, pct: 100.0 * chips / self.tree.cfg.pot }
    }

    /// `board`: the real board; `hp[h]`: the combo of the sampled tree that plays real combo `h`
    fn walk(&mut self, ni: usize, board: &[u8], hp: &[u16], r0: &[f32], r1: &[f32], mode: Mode) -> Res {
        let tree: &'a Tree = self.tree;
        let node = &tree.nodes[ni];
        let pot_total = tree.cfg.pot + node.inv[0] + node.inv[1];
        let rs = [r0, r1];
        match &node.kind {
            PKind::Fold { winner } => {
                let w = *winner as usize;
                let l = 1 - w;
                let bm = mask_of(board);
                let mut res = Res::zero();
                compat_mass(bm, rs[l], &mut res.m[w]);
                compat_mass(bm, rs[w], &mut res.m[l]);
                for h in 0..NC {
                    res.v[w][h] = (pot_total - node.inv[w]) * res.m[w][h];
                    res.v[l][h] = -node.inv[l] * res.m[l][h];
                }
                res
            }
            PKind::Showdown { .. } => {
                let mut res = Res::zero();
                let mut share = vec![0f32; NC];
                let st = self.table(board);
                for p in 0..2 {
                    showdown(st, rs[1 - p], &mut share, &mut res.m[p]);
                    for &h in &st.order {
                        let h = h as usize;
                        res.v[p][h] = pot_total * share[h] - node.inv[p] * res.m[p][h];
                    }
                }
                res
            }
            PKind::AllIn { .. } => {
                let mut res = Res::zero();
                let mut share = vec![0f32; NC];
                let mut mass = vec![0f32; NC];
                let bm = mask_of(board);
                let rem: Vec<u8> = (0..52u8).filter(|c| (bm >> c) & 1 == 0).collect();
                let mut runouts: Vec<Vec<u8>> = Vec::new();
                let weight = match board.len() {
                    4 => {
                        for &c in &rem {
                            runouts.push(vec![c]);
                        }
                        1.0 / (rem.len() as f32 - 4.0)
                    }
                    3 => {
                        for i in 0..rem.len() {
                            for j in (i + 1)..rem.len() {
                                runouts.push(vec![rem[i], rem[j]]);
                            }
                        }
                        let n = rem.len() as f32 - 4.0;
                        2.0 / (n * (n - 1.0))
                    }
                    _ => unreachable!("all-in node on a complete board"),
                };
                for ro in &runouts {
                    let mut b5 = board.to_vec();
                    b5.extend_from_slice(ro);
                    let fresh = mask_of(ro);
                    let st = self.table(&b5);
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
            PKind::Chance { cards, children, .. } => {
                let mut acc = Res::zero();
                let bm = mask_of(board);
                let n_rem = 52 - board.len();
                let weight = 1.0 / (n_rem as f32 - 4.0);
                // the real -> sampled card map of the current street
                let sampled_board = &node.board;
                let cur = board_perm(board, sampled_board);
                for c in 0..52u8 {
                    if (bm >> c) & 1 == 1 {
                        continue;
                    }
                    let j = assign_card(sampled_board, cards, cur[c as usize], self.rule);
                    let child = children[j] as usize;
                    let mut nb = board.to_vec();
                    nb.push(c);
                    let p = board_perm(&nb, &tree.nodes[child].board);
                    let hp2 = hand_perm(&p);
                    let mut a0 = r0.to_vec();
                    let mut a1 = r1.to_vec();
                    for &h in &ct().by_card[c as usize] {
                        a0[h as usize] = 0.0;
                        a1[h as usize] = 0.0;
                    }
                    let res = self.walk(child, &nb, &hp2, &a0, &a1, mode);
                    acc.add_scaled(&res, weight);
                }
                let _ = hp;
                acc
            }
            PKind::Decision { player, children, .. } => {
                let p = *player as usize;
                let o = 1 - p;
                let na = children.len();
                let rp = rs[p];
                let ro = rs[o];
                let is_br = matches!(mode, Mode::Br(bp) if bp == p);
                let mut sigma = vec![0f32; na * NC];
                if !is_br {
                    let s = &self.strat[ni];
                    for a in 0..na {
                        for h in 0..NC {
                            sigma[a * NC + h] = s[a * NC + hp[h] as usize];
                        }
                    }
                }
                let mut cfv_p = if is_br { vec![f32::MIN; NC] } else { vec![0f32; NC] };
                let mut cfv_o = vec![0f32; NC];
                let mut m_p = vec![0f32; NC];
                let mut m_o = vec![0f32; NC];
                for a in 0..na {
                    let new_rp: Vec<f32> = if is_br { rp.to_vec() } else { (0..NC).map(|h| rp[h] * sigma[a * NC + h]).collect() };
                    let res = if p == 0 { self.walk(children[a] as usize, board, hp, &new_rp, ro, mode) } else { self.walk(children[a] as usize, board, hp, ro, &new_rp, mode) };
                    for h in 0..NC {
                        cfv_o[h] += res.v[o][h];
                        m_o[h] += res.m[o][h];
                    }
                    if a == 0 {
                        m_p.copy_from_slice(&res.m[p]);
                    }
                    if is_br {
                        for h in 0..NC {
                            cfv_p[h] = cfv_p[h].max(res.v[p][h]);
                        }
                    } else {
                        for h in 0..NC {
                            cfv_p[h] += sigma[a * NC + h] * res.v[p][h];
                        }
                    }
                }
                let mut res = Res { v: [Vec::new(), Vec::new()], m: [Vec::new(), Vec::new()] };
                res.v[p] = cfv_p;
                res.v[o] = cfv_o;
                res.m[p] = m_p;
                res.m[o] = m_o;
                res
            }
        }
    }
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

    /// varied ranges: OOP pairs + broadways + suited aces, IP pairs + suited connectors + offsuit broadways
    fn ranges() -> [Vec<f32>; 2] {
        let mut r = [vec![0f32; NC], vec![0f32; NC]];
        for (i, &(a, b)) in ct().cards.iter().enumerate() {
            let (ra, rb) = (a >> 2, b >> 2);
            let suited = (a & 3) == (b & 3);
            if ra == rb {
                r[0][i] = 1.0;
                r[1][i] = 0.7;
            }
            if ra >= 8 && rb >= 8 && ra != rb {
                r[0][i] = 0.8;
                r[1][i] = if suited { 0.0 } else { 0.5 };
            }
            if suited && (ra == 12 || rb == 12) {
                r[0][i] = 1.0;
            }
            if suited && ra.abs_diff(rb) == 1 && ra < 10 {
                r[1][i] = 1.0;
            }
        }
        r
    }

    fn solve(tree: &Tree, iters: u32) -> Solver<'_> {
        let mut s = Solver::new(tree, &ranges());
        for _ in 0..iters {
            s.iterate();
        }
        s.finalize_avg();
        s
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-4 + 1e-4 * a.abs().max(b.abs())
    }

    fn river_cfg() -> Config {
        Config { pot: 10.0, stack: 40.0, bets: [vec![], vec![], vec![0.5, 1.0]], raise_sizes: [false; 3], allow_allin: true, ..Config::default() }
    }

    /// Completion condition of REFACTOR_PLAN 3-0: on a river-only tree, the value measured from the
    /// exported file equals `Solver::exploitability` for the same (dequantized) strategy.
    #[test]
    fn river_file_measure_matches_solver_exploitability() {
        let cfg = river_cfg();
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        let mut s = solve(&tree, 300);
        let own = 100.0 * s.exploitability() / cfg.pot;
        let ev = s.evaluate();
        let bytes = export(&tree, &ev, 0.0);
        let f = parse_tsp1(&bytes).unwrap();
        let map = match_tree(&tree, &f).unwrap();
        let sh = shipped_strategy(&tree, &f, &map, Fallback::Passive).unwrap();
        assert_eq!(sh.count(Source::Twin) + sh.count(Source::Default), 0);
        let mut ref_solver = Solver::new(&tree, &sh.prior);
        ref_solver.avg = sh.strat.clone();
        let want = 100.0 * ref_solver.exploitability() / cfg.pot;
        let got = FullBr::new(&tree, &sh.strat, &sh.prior, Assign::Nearest).exploitability();
        assert!(close(got.pct, want), "measured {}% vs Solver::exploitability {}%", got.pct, want);
        assert!((got.base[0] + got.base[1] - cfg.pot).abs() < 1e-3, "constant sum {:?}", got.base);
        // u8 frequencies and dropped low-weight hands move the value only a little
        assert!((got.pct - own).abs() < 0.5, "file {}% vs live solver {}%", got.pct, own);
        assert!(got.pct > 0.0 && got.pct < 5.0, "{}", got.pct);
    }

    /// a strategy far from equilibrium (everybody always checks / calls) is heavily exploitable,
    /// and the value still agrees with `Solver::exploitability`
    #[test]
    fn passive_strategy_is_exploitable() {
        let cfg = river_cfg();
        let tree = build_tree(&cfg, &board("Ah 8d 7c 2s 3d"));
        let mut strat: Vec<Vec<f32>> = vec![Vec::new(); tree.nodes.len()];
        for (i, n) in tree.nodes.iter().enumerate() {
            if let PKind::Decision { acts, .. } = &n.kind {
                let mut v = vec![0f32; acts.len() * NC];
                let a = acts.iter().position(|a| a.kind == 1).unwrap();
                v[a * NC..(a + 1) * NC].iter_mut().for_each(|x| *x = 1.0);
                strat[i] = v;
            }
        }
        let pr = ranges();
        let mut s = Solver::new(&tree, &pr);
        s.avg = strat.clone();
        let want = 100.0 * s.exploitability() / cfg.pot;
        let got = FullBr::new(&tree, &strat, &pr, Assign::Nearest).exploitability();
        assert!(close(got.pct, want), "{} vs {}", got.pct, want);
        // the best response bets its winning hands for the whole stack and is always called
        assert!(got.pct > 50.0, "always check / call should lose a lot: {}%", got.pct);
        assert!(got.br[0] > got.base[0] + 1.0 && got.br[1] > got.base[1] + 1.0);
    }

    /// When the tree was built with every card (no sampling), the full-card measure must equal the
    /// in-sample value: turn start, every river, bets and all-ins on both streets.
    #[test]
    fn all_cards_tree_turn_matches_in_sample() {
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 48, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 9h 5h 2d"));
        let mut s = solve(&tree, 40);
        let want = 100.0 * s.exploitability() / cfg.pot;
        let got = FullBr::new(&tree, &s.avg, &s.prior, Assign::Nearest).exploitability();
        assert!(close(got.pct, want), "{} vs {}", got.pct, want);
        assert!(want > 0.05, "the test needs an unconverged strategy: {}", want);
    }

    /// same from the flop: every turn and river card, flop all-ins over all 1,176 run-outs
    #[test]
    fn all_cards_tree_flop_matches_in_sample() {
        let cfg = Config { pot: 6.0, stack: 9.0, bets: [vec![0.5], vec![], vec![]], raise_sizes: [false; 3], allow_allin: true, turn_cards: 49, river_cards: 48, flop_runouts: 1176, ..Config::default() };
        let tree = build_tree(&cfg, &board("Qs Jd 6s"));
        let mut s = solve(&tree, 15);
        let want = 100.0 * s.exploitability() / cfg.pot;
        let got = FullBr::new(&tree, &s.avg, &s.prior, Assign::Nearest).exploitability();
        assert!(close(got.pct, want), "{} vs {}", got.pct, want);
        assert!(want > 0.05, "the test needs an unconverged strategy: {}", want);
    }

    #[test]
    fn board_perm_maps_live_cards_onto_live_cards() {
        let from = board("As 7d 2c 9h Kc");
        let to = board("As 7d 2c Kc 3s");
        let p = board_perm(&from, &to);
        let mut seen = [false; 52];
        for c in 0..52 {
            assert!(!seen[p[c] as usize]);
            seen[p[c] as usize] = true;
        }
        for i in 0..5 {
            assert_eq!(p[from[i] as usize], to[i]);
        }
        for c in 0..52u8 {
            if !from.contains(&c) {
                assert!(!to.contains(&p[c as usize]), "card {}", c);
            }
        }
    }

    #[test]
    fn assignment_prefers_same_rank_then_flush_class() {
        let fl = board("As 7d 2c");
        let cards = vec![card("Kh"), card("9c"), card("7h"), card("5s"), card("3d"), card("2d")];
        assert_eq!(assign_card(&fl, &cards, card("9c"), Assign::Nearest), 1);
        assert_eq!(assign_card(&fl, &cards, card("7s"), Assign::Nearest), 2);
        assert_eq!(assign_card(&fl, &cards, card("Kd"), Assign::Nearest), 0);
        // rank 8: 9 and 7 are both one away; 7 would pair the board, 8 does not
        assert_eq!(assign_card(&fl, &cards, card("8h"), Assign::Nearest), 1);
        // two-tone flop: a third spade makes a flush possible, so the spade sample wins
        let fl2 = board("As 7s 2c");
        let cards2 = vec![card("Kh"), card("Ts"), card("8d")];
        assert_eq!(assign_card(&fl2, &cards2, card("8s"), Assign::Nearest), 1);
        assert_eq!(assign_card(&fl2, &cards2, card("8c"), Assign::Nearest), 2);
        // the stratum rule takes the sample of the card's own stratum
        assert_eq!(assign_card(&fl, &cards, card("Ac"), Assign::Stratum), 0);
        assert_eq!(assign_card(&fl, &cards, card("2s"), Assign::Stratum), 5);
    }
}
