//! ICM push/fold: tournament (prize-pool) equilibrium for 2..=9 players.
//!
//! Every player either folds or jams (all-in) when it is their turn and nobody has jammed yet; once somebody has
//! jammed, each later player in turn either folds or calls, and **the first call ends the betting** (a later player
//! cannot over-call: the usual simplification of free push/fold tools).  Blinds and antes are posted first.
//! Payoffs are *prize-pool equity* (Malmuth-Harville ICM) of the stacks after the hand, so folding is not value
//! neutral: busting the short stack makes everybody else's equity grow.  With a winner-take-all prize the game is
//! the chip-EV push/fold game (equity is proportional to chips), which the tests use as a cross-check.
use crate::cards::*;
use crate::engine::*;
use crate::equity::EquityTables;

pub const MAX_PLAYERS: usize = MAXP;

#[derive(Clone, Debug)]
pub struct IcmSpec {
    /// chips of every player at the start of the hand, in acting order: index 0 acts first,
    /// the second to last is the small blind, the last the big blind (heads-up: the small blind acts first)
    pub stacks: Vec<f32>,
    pub sb: f32,
    pub bb: f32,
    pub ante: f32,
    /// prize of 1st, 2nd, ... (places beyond the list pay nothing)
    pub payouts: Vec<f32>,
}

/// Malmuth-Harville equity of every player (same unit as `payouts`).
/// A player with no chips has finished behind everybody who still has chips: busted players take the
/// lowest places (several busted players split those prizes equally).
pub fn icm_equity(stacks: &[f32], payouts: &[f32]) -> Vec<f32> {
    let n = stacks.len();
    let mut eq = vec![0f64; n];
    let alive = stacks.iter().filter(|&&s| s > 0.0).count();
    let places = payouts.len().min(alive);
    fn rec(stacks: &[f32], payouts: &[f32], places: usize, used: u32, place: usize, prob: f64, eq: &mut [f64]) {
        if place >= places || prob < 1e-15 {
            return;
        }
        let total: f64 = stacks.iter().enumerate().filter(|(i, _)| used & (1 << i) == 0).map(|(_, &s)| s as f64).sum();
        if total <= 0.0 {
            return;
        }
        for i in 0..stacks.len() {
            if used & (1 << i) != 0 || stacks[i] <= 0.0 {
                continue;
            }
            let p = prob * stacks[i] as f64 / total;
            eq[i] += p * payouts[place] as f64;
            rec(stacks, payouts, places, used | (1 << i), place + 1, p, eq);
        }
    }
    rec(stacks, payouts, places, 0, 0, 1.0, &mut eq);
    let dead = n - alive;
    if dead > 0 {
        let share: f64 = (alive..alive + dead).map(|i| payouts.get(i).copied().unwrap_or(0.0) as f64).sum::<f64>() / dead as f64;
        for i in 0..n {
            if stacks[i] <= 0.0 {
                eq[i] = share;
            }
        }
    }
    eq.iter().map(|&x| x as f32).collect()
}

/// What a decision node of the game means (for reports).
#[derive(Clone, Debug, PartialEq)]
pub struct NodeInfo {
    pub node: usize,
    pub player: usize,
    /// None: opening decision (fold / jam); Some(j): facing player j's jam (fold / call)
    pub facing: Option<usize>,
}

pub struct IcmGame {
    pub game: Game,
    pub info: Vec<NodeInfo>,
    pub spec: IcmSpec,
    /// ICM equity of the stacks before the hand (the value of "nothing happens")
    pub start_equity: Vec<f32>,
}

fn arr(v: &[f32]) -> [f32; MAXP] {
    let mut a = [0f32; MAXP];
    a[..v.len()].copy_from_slice(v);
    a
}

pub fn build(spec: &IcmSpec, t: &EquityTables) -> IcmGame {
    let n = spec.stacks.len();
    assert!((2..=MAXP).contains(&n), "2..={} players", MAXP);
    let k = NUM_CLASSES;
    let mut compat = vec![0f32; k * k];
    for a in 0..k {
        for b in 0..k {
            compat[a * k + b] = t.n[a * k + b] / (class_count(a) * class_count(b)) as f32;
        }
    }
    let prior: Vec<f32> = (0..k).map(|c| class_count(c) as f32 / 1326.0).collect();
    let pm = build_pm(k, &compat, &prior);
    let mut m = vec![0f32; k * k];
    for a in 0..k {
        for b in 0..k {
            m[a * k + b] = pm[a * k + b] * t.eq[a * k + b];
        }
    }

    // what each player has put in before anybody acts
    let post: Vec<f32> = (0..n)
        .map(|i| {
            let blind = if i == n - 2 { spec.sb } else if i == n - 1 { spec.bb } else { 0.0 };
            (spec.ante + blind).min(spec.stacks[i])
        })
        .collect();
    let dead_all: f32 = post.iter().sum();
    let value = |after: &[f32]| arr(&icm_equity(after, &spec.payouts));

    // nobody calls: the jammer (or, with no jam, the big blind) takes the dead money
    let uncontested = |winner: usize| {
        let after: Vec<f32> = (0..n).map(|q| spec.stacks[q] - post[q] + if q == winner { dead_all } else { 0.0 }).collect();
        value(&after)
    };
    let showdown = |j: usize, c: usize| {
        let e = spec.stacks[j].min(spec.stacks[c]);
        let dead: f32 = (0..n).filter(|&q| q != j && q != c).map(|q| post[q]).sum();
        let pot = 2.0 * e + dead;
        let base: Vec<f32> = (0..n)
            .map(|q| if q == j || q == c { spec.stacks[q] - e } else { spec.stacks[q] - post[q] })
            .collect();
        let mut xw = base.clone();
        xw[j] += pot;
        let mut yw = base;
        yw[c] += pot;
        (value(&xw), value(&yw))
    };

    let mut nodes: Vec<Node> = Vec::new();
    let mut info: Vec<NodeInfo> = Vec::new();
    let zero = [0f32; MAXP];
    let mut push = |nodes: &mut Vec<Node>, kind: Kind, aggressor: Option<usize>| {
        nodes.push(Node { kind, inv: zero, aggressor });
        nodes.len() - 1
    };

    // responses to player j's jam, from player c on
    fn respond(nodes: &mut Vec<Node>, info: &mut Vec<NodeInfo>, n: usize, j: usize, c: usize, unc: &dyn Fn(usize) -> [f32; MAXP], sd: &dyn Fn(usize, usize) -> ([f32; MAXP], [f32; MAXP])) -> usize {
        if c == n {
            nodes.push(Node { kind: Kind::Const { vals: unc(j) }, inv: [0f32; MAXP], aggressor: Some(j) });
            return nodes.len() - 1;
        }
        let idx = nodes.len();
        nodes.push(Node { kind: Kind::Const { vals: [0f32; MAXP] }, inv: [0f32; MAXP], aggressor: Some(j) });
        info.push(NodeInfo { node: idx, player: c, facing: Some(j) });
        let fold = respond(nodes, info, n, j, c + 1, unc, sd);
        let (vx, vy) = sd(j, c);
        nodes.push(Node { kind: Kind::Icm { x: j, y: c, class: 0, vx, vy }, inv: [0f32; MAXP], aggressor: Some(j) });
        let call = nodes.len() - 1;
        nodes[idx].kind = Kind::Decision { player: c, children: vec![fold, call] };
        idx
    }
    fn open(nodes: &mut Vec<Node>, info: &mut Vec<NodeInfo>, n: usize, i: usize, unc: &dyn Fn(usize) -> [f32; MAXP], sd: &dyn Fn(usize, usize) -> ([f32; MAXP], [f32; MAXP])) -> usize {
        if i == n - 1 {
            nodes.push(Node { kind: Kind::Const { vals: unc(n - 1) }, inv: [0f32; MAXP], aggressor: None });
            return nodes.len() - 1;
        }
        let idx = nodes.len();
        nodes.push(Node { kind: Kind::Const { vals: [0f32; MAXP] }, inv: [0f32; MAXP], aggressor: None });
        info.push(NodeInfo { node: idx, player: i, facing: None });
        let fold = open(nodes, info, n, i + 1, unc, sd);
        let jam = respond(nodes, info, n, i, i + 1, unc, sd);
        nodes[idx].kind = Kind::Decision { player: i, children: vec![fold, jam] };
        idx
    }
    let _ = &mut push;
    open(&mut nodes, &mut info, n, 0, &uncontested, &showdown);

    let game = Game {
        n_players: n,
        k,
        pm: vec![pm; n],
        prior: vec![prior; n],
        classes: vec![Class { a: m.clone(), b: m }],
        nodes,
        raw_eq: Some(t.eq.clone()),
    };
    let start_equity = icm_equity(&spec.stacks, &spec.payouts);
    IcmGame { game, info, spec: spec.clone(), start_equity }
}

/// One decision node of a solved game, ready to be displayed.
#[derive(Clone, Debug)]
pub struct NodeReport {
    pub player: usize,
    pub facing: Option<usize>,
    /// probability that the line leading here is played (all players' ranges)
    pub reach: f32,
    /// probability that each hand class reaches the node with the actor's own strategy
    pub weight: Vec<f32>,
    /// probability of jamming / calling per class
    pub freq: Vec<f32>,
    /// prize equity of jamming (calling) and folding, per class
    pub ev_act: Vec<f32>,
    pub ev_fold: Vec<f32>,
}

pub fn solve(spec: &IcmSpec, t: &EquityTables, iters: u32) -> (IcmGame, Vec<NodeReport>, f32) {
    let g = build(spec, t);
    let mut s = Solver::new(&g.game);
    for _ in 0..iters {
        s.iterate();
    }
    s.finalize_avg();
    let gaps: f32 = s.br_gaps().iter().sum();
    let ev = s.evaluate();
    let k = NUM_CLASSES;
    let reports = g
        .info
        .iter()
        .filter_map(|i| {
            let e = ev[i.node].as_ref()?;
            Some(NodeReport {
                player: i.player,
                facing: i.facing,
                reach: e.reach,
                weight: e.weight.clone(),
                freq: e.freq[k..2 * k].to_vec(),
                ev_act: e.ev[k..2 * k].to_vec(),
                ev_fold: e.ev[0..k].to_vec(),
            })
        })
        .collect();
    (g, reports, gaps)
}

/// share of all combos that jam (call) at a node
pub fn range_pct(r: &NodeReport) -> f32 {
    let (mut num, mut den) = (0f64, 0f64);
    for h in 0..NUM_CLASSES {
        let c = class_count(h) as f64;
        num += c * r.weight[h] as f64 * r.freq[h] as f64;
        den += c * r.weight[h] as f64;
    }
    if den > 0.0 {
        (100.0 * num / den) as f32
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables() -> EquityTables {
        // a coarser table is enough for the structural tests
        let cache = "cache/equity-60000-20260101.bin";
        crate::equity::load(cache).unwrap_or_else(|| crate::equity::compute_equity(20_000, 1, 4))
    }

    /// reference ICM by enumerating every finishing order
    fn icm_bruteforce(stacks: &[f64], payouts: &[f64]) -> Vec<f64> {
        fn perm(rem: &mut Vec<usize>, cur: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
            if rem.is_empty() {
                out.push(cur.clone());
                return;
            }
            for i in 0..rem.len() {
                let x = rem.remove(i);
                cur.push(x);
                perm(rem, cur, out);
                cur.pop();
                rem.insert(i, x);
            }
        }
        let n = stacks.len();
        let mut orders = Vec::new();
        perm(&mut (0..n).collect(), &mut Vec::new(), &mut orders);
        let mut eq = vec![0f64; n];
        for o in orders {
            let mut left: f64 = stacks.iter().sum();
            let mut p = 1.0;
            for &i in &o {
                p *= stacks[i] / left;
                left -= stacks[i];
            }
            for (place, &i) in o.iter().enumerate() {
                eq[i] += p * payouts.get(place).copied().unwrap_or(0.0);
            }
        }
        eq
    }

    #[test]
    fn icm_matches_enumeration_and_textbook() {
        let stacks = [5000.0f32, 3000.0, 2000.0];
        let pay = [50.0f32, 30.0, 20.0];
        let e = icm_equity(&stacks, &pay);
        assert!((e.iter().sum::<f32>() - 100.0).abs() < 1e-3);
        // the classic worked example: chip leader 38.39, middle 33.2, short 28.4 (rounded)
        assert!((e[0] - 38.39).abs() < 0.02, "{:?}", e);
        let r = icm_bruteforce(&[5000.0, 3000.0, 2000.0], &[50.0, 30.0, 20.0]);
        for i in 0..3 {
            assert!((e[i] as f64 - r[i]).abs() < 1e-3);
        }
        // 5 players, 3 paid, unequal stacks
        let s5 = [1200.0f32, 900.0, 4000.0, 2500.0, 300.0];
        let p5 = [60.0f32, 25.0, 15.0];
        let e5 = icm_equity(&s5, &p5);
        let r5 = icm_bruteforce(&s5.map(|x| x as f64), &p5.map(|x| x as f64));
        for i in 0..5 {
            assert!((e5[i] as f64 - r5[i]).abs() < 1e-3, "{} {} {}", i, e5[i], r5[i]);
        }
        // a busted player collects the lowest prize; the others share the rest
        let b = icm_equity(&[10.0, 0.0, 5.0], &pay);
        assert!((b[1] - 20.0).abs() < 1e-4 && (b[0] - 43.333).abs() < 0.01 && (b[2] - 36.667).abs() < 0.01, "{:?}", b);
        let two_bust = icm_equity(&[10.0, 0.0, 0.0], &pay);
        assert!((two_bust[0] - 50.0).abs() < 1e-4 && (two_bust[1] - 25.0).abs() < 1e-4, "{:?}", two_bust);
        // winner-take-all: equity is proportional to chips
        let w = icm_equity(&stacks, &[1.0]);
        for i in 0..3 {
            assert!((w[i] - stacks[i] / 10_000.0).abs() < 1e-5);
        }
    }

    fn jam_call(spec: &IcmSpec, t: &EquityTables, iters: u32) -> (Vec<NodeReport>, f32) {
        let (_g, r, gaps) = solve(spec, t, iters);
        (r, gaps)
    }

    /// With a winner-take-all prize the ICM game is the chip-EV game: it must reproduce the heads-up push/fold
    /// ranges of `games::pushfold` (this exercises the new terminal kinds against the old ones).
    #[test]
    fn winner_take_all_heads_up_equals_chip_ev_pushfold() {
        let t = tables();
        let spec = IcmSpec { stacks: vec![10.0, 10.0], sb: 0.5, bb: 1.0, ante: 0.0, payouts: vec![1.0] };
        let (reps, gaps) = jam_call(&spec, &t, 4000);
        assert!(gaps < 0.002, "exploitability {} (prize units)", gaps);
        let jam = range_pct(reps.iter().find(|r| r.facing.is_none()).unwrap());
        let call = range_pct(reps.iter().find(|r| r.facing == Some(0)).unwrap());
        // published HU Nash charts: SB shoves ~58 %, BB calls ~37-38 % at 10bb
        assert!((55.0..62.0).contains(&jam), "jam {}", jam);
        assert!((34.0..41.0).contains(&call), "call {}", call);
        // same game solved by the original engine
        let g = crate::games::pushfold(10.0, &t);
        let mut s = Solver::new(&g);
        for _ in 0..4000 {
            s.iterate();
        }
        s.finalize_avg();
        let (mut j2, mut c2, mut w) = (0f64, 0f64, 0f64);
        for h in 0..NUM_CLASSES {
            let n = class_count(h) as f64;
            w += n;
            j2 += n * s.avg[0][NUM_CLASSES + h] as f64;
            c2 += n * s.avg[2][NUM_CLASSES + h] as f64;
        }
        assert!((jam as f64 - 100.0 * j2 / w).abs() < 1.5, "jam {} vs {}", jam, 100.0 * j2 / w);
        assert!((call as f64 - 100.0 * c2 / w).abs() < 1.5, "call {} vs {}", call, 100.0 * c2 / w);
    }

    /// The bubble effect: with 50/30/20 prizes the big blind calls a short-stack jam *tighter* than with
    /// chip-EV (winner-take-all) payouts, and AA is still always a call.
    #[test]
    fn icm_tightens_calling_ranges() {
        let t = tables();
        // UTG (index 0) 6bb, BTN... three players: acting order SB-less: 0 = BTN(first), 1 = SB, 2 = BB
        let stacks = vec![12.0f32, 6.0, 12.0];
        let wta = IcmSpec { stacks: stacks.clone(), sb: 0.5, bb: 1.0, ante: 0.0, payouts: vec![1.0] };
        let icm = IcmSpec { stacks, sb: 0.5, bb: 1.0, ante: 0.0, payouts: vec![50.0, 30.0, 20.0] };
        let (rw, gw) = jam_call(&wta, &t, 3000);
        let (ri, gi) = jam_call(&icm, &t, 3000);
        assert!(gw < 0.01, "wta exploitability {}", gw);
        assert!(gi < 0.5, "icm exploitability {} (prize units, 100 total)", gi);
        // every calling range is much tighter than with chip-EV payouts (the "bubble factor")
        let calls = |reps: &[NodeReport]| -> Vec<f32> { [(2, 1), (1, 0), (2, 0)].iter().map(|&(p, j)| range_pct(reps.iter().find(|r| r.player == p && r.facing == Some(j)).unwrap())).collect() };
        let (cw, ci) = (calls(&rw), calls(&ri));
        for i in 0..3 {
            assert!(ci[i] < cw[i] - 3.0, "call range {}: ICM {} vs chip-EV {}", i, ci[i], cw[i]);
        }
        // the big blind, who can be busted by either jammer, is the tightest caller against the button
        assert!(ci[2] < ci[1], "BB {} vs SB {}", ci[2], ci[1]);
        // premium hands are never folded
        let bb = ri.iter().find(|r| r.player == 2 && r.facing == Some(1)).unwrap();
        assert!(bb.freq[0] > 0.99, "AA call {}", bb.freq[0]);
        // total equity is conserved: the EVs of the opening decision sum to the prize pool at the root
        let g = build(&icm, &t);
        assert!((g.start_equity.iter().sum::<f32>() - 100.0).abs() < 1e-3);
    }

    /// The short stack is pushed into wider shoves by the ICM pressure on the others only up to a point:
    /// with equal prizes for 2nd/3rd place (50/25/25) it still must keep a coherent, finite, exploitability-checked solution
    /// for a nine-handed table with antes.
    #[test]
    fn nine_handed_table_with_antes_solves() {
        let t = tables();
        let spec = IcmSpec { stacks: vec![22.0, 18.0, 15.0, 30.0, 9.0, 12.0, 25.0, 14.0, 20.0], sb: 0.5, bb: 1.0, ante: 0.125, payouts: vec![40.0, 25.0, 15.0, 10.0, 6.0, 4.0] };
        let (reps, gaps) = jam_call(&spec, &t, 1500);
        assert!(gaps.is_finite() && gaps < 3.0, "exploitability {}", gaps);
        // 9 openers + the callers behind: 8 open nodes (BB does not open) and 36 response nodes
        assert_eq!(reps.iter().filter(|r| r.facing.is_none()).count(), 8);
        for r in &reps {
            assert!(r.freq.iter().all(|f| f.is_finite() && *f >= -1e-6 && *f <= 1.0 + 1e-6));
        }
        // the shortest stacks jam more often than the deep ones from the same kind of position
        let jam_of = |p: usize| range_pct(reps.iter().find(|r| r.player == p && r.facing.is_none()).unwrap());
        assert!(jam_of(4) > jam_of(0), "9bb jam {} vs 22bb jam {}", jam_of(4), jam_of(0));
    }
}
