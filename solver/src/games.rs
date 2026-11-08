//! Small reference games used to validate the engine against *known* equilibria,
//! plus the heads-up push/fold game.
use crate::cards::*;
use crate::engine::*;
use crate::equity::EquityTables;

fn push(nodes: &mut Vec<Node>, kind: Kind, inv: [f32; MAXP], aggressor: Option<usize>) -> usize {
    nodes.push(Node { kind, inv, aggressor });
    nodes.len() - 1
}

fn decision(
    nodes: &mut Vec<Node>,
    player: usize,
    inv: [f32; MAXP],
    aggressor: Option<usize>,
    kids: impl FnOnce(&mut Vec<Node>) -> Vec<usize>,
) -> usize {
    let idx = push(nodes, Kind::Fold { winner: 0 }, inv, aggressor);
    let children = kids(nodes);
    nodes[idx].kind = Kind::Decision { player, children };
    idx
}

fn inv2(a: f32, b: f32) -> [f32; MAXP] {
    let mut v = [0f32; MAXP];
    v[0] = a;
    v[1] = b;
    v
}

/// Kuhn poker (J,Q,K; ante 1; bet 1).  Value for player 0 is -1/18.
pub fn kuhn() -> Game {
    let k = 3;
    let mut compat = vec![0f32; 9];
    for a in 0..3 {
        for b in 0..3 {
            compat[a * 3 + b] = if a != b { 1.0 } else { 0.0 };
        }
    }
    let prior = vec![1.0 / 3.0; 3];
    let pm = build_pm(k, &compat, &prior);
    let mut ca = vec![0f32; 9];
    let mut cb = vec![0f32; 9];
    for a in 0..3 {
        for b in 0..3 {
            ca[a * 3 + b] = pm[a * 3 + b] * if a > b { 1.0 } else { 0.0 };
            cb[a * 3 + b] = pm[a * 3 + b] * if a > b { 1.0 } else { 0.0 }; // rows = y hand, cols = x hand
        }
    }
    let mut nodes = Vec::new();
    // root: P0 check / bet
    decision(&mut nodes, 0, inv2(1.0, 1.0), None, |n| {
        let chk = decision(n, 1, inv2(1.0, 1.0), None, |n| {
            let c = push(n, Kind::Showdown { x: 0, y: 1, class: 0 }, inv2(1.0, 1.0), None);
            let b = decision(n, 0, inv2(1.0, 2.0), Some(1), |n| {
                vec![
                    push(n, Kind::Fold { winner: 1 }, inv2(1.0, 2.0), None),
                    push(n, Kind::Showdown { x: 0, y: 1, class: 0 }, inv2(2.0, 2.0), None),
                ]
            });
            vec![c, b]
        });
        let bet = decision(n, 1, inv2(2.0, 1.0), Some(0), |n| {
            vec![
                push(n, Kind::Fold { winner: 0 }, inv2(2.0, 1.0), None),
                push(n, Kind::Showdown { x: 0, y: 1, class: 0 }, inv2(2.0, 2.0), None),
            ]
        });
        vec![chk, bet]
    });
    Game {
        n_players: 2,
        k,
        pm: vec![pm.clone(), pm],
        prior: vec![prior.clone(), prior],
        classes: vec![Class { a: ca, b: cb }],
        nodes,
        raw_eq: None,
    }
}

/// Half-street "clairvoyance" game: player 0 holds the nuts or air (50/50), player 1
/// holds a bluff-catcher.  Pot (before the bet) is 1.0, bet size `b`.
/// Equilibrium: air bluffs with prob b/(1+b), the catcher calls with prob 1/(1+b).
pub fn clairvoyant(b: f32) -> Game {
    let k = 3; // 0 = nuts, 1 = air, 2 = bluff catcher
    let compat = vec![1f32; 9];
    let p0 = vec![0.5, 0.5, 0.0];
    let p1 = vec![0.0, 0.0, 1.0];
    let pm0 = build_pm(k, &compat, &p0);
    let pm1 = build_pm(k, &compat, &p1);
    // s_x(a, b): nuts beat the catcher, air loses
    let s = |a: usize, c: usize| if a == 0 && c == 2 { 1.0f32 } else { 0.0 };
    let mut ca = vec![0f32; 9];
    let mut cb = vec![0f32; 9];
    for a in 0..2 {
        // x = player 0 (nuts / air) vs y = player 1 (catcher, hand 2)
        ca[a * 3 + 2] = pm1[a * 3 + 2] * s(a, 2);
        // rows = y hand, cols = x hand
        cb[2 * 3 + a] = pm0[2 * 3 + a] * (1.0 - s(a, 2));
    }
    let mut nodes = Vec::new();
    decision(&mut nodes, 0, inv2(0.5, 0.5), None, |n| {
        let chk = push(n, Kind::Showdown { x: 0, y: 1, class: 0 }, inv2(0.5, 0.5), None);
        let bet = decision(n, 1, inv2(0.5 + b, 0.5), Some(0), |n| {
            vec![
                push(n, Kind::Fold { winner: 0 }, inv2(0.5 + b, 0.5), None),
                push(n, Kind::Showdown { x: 0, y: 1, class: 0 }, inv2(0.5 + b, 0.5 + b), None),
            ]
        });
        vec![chk, bet]
    });
    Game {
        n_players: 2,
        k,
        pm: vec![pm0, pm1],
        prior: vec![p0, p1],
        classes: vec![Class { a: ca, b: cb }],
        nodes,
        raw_eq: None,
    }
}

/// Heads-up push / fold (SB posts 0.5, BB posts 1, effective stack `stack` bb).
pub fn pushfold(stack: f32, t: &EquityTables) -> Game {
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
    let mut nodes = Vec::new();
    decision(&mut nodes, 0, inv2(0.5, 1.0), None, |n| {
        let fold = push(n, Kind::Fold { winner: 1 }, inv2(0.5, 1.0), None);
        let jam = decision(n, 1, inv2(stack, 1.0), Some(0), |n| {
            vec![
                push(n, Kind::Fold { winner: 0 }, inv2(stack, 1.0), None),
                push(n, Kind::Showdown { x: 0, y: 1, class: 0 }, inv2(stack, stack), None),
            ]
        });
        vec![fold, jam]
    });
    Game {
        n_players: 2,
        k,
        pm: vec![pm.clone(), pm],
        prior: vec![prior.clone(), prior],
        classes: vec![Class { a: m.clone(), b: m }],
        nodes,
        raw_eq: Some(t.eq.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solve(g: &Game, iters: u32) -> Solver<'_> {
        let mut s = Solver::new(g);
        for _ in 0..iters {
            s.iterate();
        }
        s.finalize_avg();
        s
    }

    #[test]
    fn kuhn_equilibrium() {
        let g = kuhn();
        let mut s = solve(&g, 20_000);
        let v = s.root_values();
        assert!((v[0] + 1.0 / 18.0).abs() < 0.002, "game value {}", v[0]);
        assert!((v[0] + v[1]).abs() < 1e-3);
        let gaps = s.br_gaps();
        assert!(gaps[0] + gaps[1] < 0.003, "exploitability {:?}", gaps);
        // node ids: 0 root(P0), 1 P1 after check, 4 P0 after check-bet, 6 P1 after bet
        let freq = |node: usize, action: usize, hand: usize| s.avg[node][action * 3 + hand];
        // known unique P1 equilibrium
        assert!((freq(6, 1, 1) - 1.0 / 3.0).abs() < 0.03, "P1 calls bet with Q: {}", freq(6, 1, 1));
        assert!(freq(6, 1, 2) > 0.97, "P1 always calls with K");
        assert!(freq(6, 1, 0) < 0.03, "P1 always folds J to a bet");
        assert!((freq(1, 1, 0) - 1.0 / 3.0).abs() < 0.03, "P1 bluffs J after check: {}", freq(1, 1, 0));
        assert!(freq(1, 1, 1) < 0.03, "P1 never bets Q after check");
        assert!(freq(1, 1, 2) > 0.97, "P1 always bets K after check");
        // P0 family: bet(K) = 3 * bet(J)
        let (bj, bk) = (freq(0, 1, 0), freq(0, 1, 2));
        assert!(bj <= 1.0 / 3.0 + 0.03 && (bk - 3.0 * bj).abs() < 0.06, "bet J {} bet K {}", bj, bk);
        assert!(freq(0, 1, 1) < 0.03, "P0 never bets Q");
    }

    #[test]
    fn clairvoyant_game_matches_theory() {
        for &b in &[0.5f32, 1.0, 2.0] {
            let g = clairvoyant(b);
            let mut s = solve(&g, 60_000);
            let gaps = s.br_gaps();
            assert!(gaps[0] + gaps[1] < 0.002, "b={} exploitability {:?}", b, gaps);
            // node 0 = P0 root, node 2 = P1 facing bet
            let bluff = s.avg[0][1 * 3 + 1];
            let value_bet = s.avg[0][1 * 3];
            let call = s.avg[2][1 * 3 + 2];
            assert!(value_bet > 0.99, "nuts always bet");
            assert!((bluff - b / (1.0 + b)).abs() < 0.02, "b={} bluff {} vs {}", b, bluff, b / (1.0 + b));
            assert!((call - 1.0 / (1.0 + b)).abs() < 0.02, "b={} call {} vs {}", b, call, 1.0 / (1.0 + b));
            // bluff-to-value ratio inside the betting range = b / (1 + 2b)
            let share = 0.5 * bluff / (0.5 * bluff + 0.5 * value_bet);
            assert!((share - b / (1.0 + 2.0 * b)).abs() < 0.02);
        }
    }

    /// Heads-up push/fold: the Nash ranges are a well documented benchmark.
    #[test]
    fn pushfold_matches_known_nash_ranges() {
        let t = crate::equity::compute_equity(20_000, 1, 4);
        let mut prev: Option<(f64, f64)> = None;
        for &stack in &[5.0f32, 10.0, 15.0] {
            let g = pushfold(stack, &t);
            let mut s = solve(&g, 4000);
            let gaps = s.br_gaps();
            assert!(gaps[0] + gaps[1] < 0.003, "stack {} exploitability {:?}", stack, gaps);
            let (mut jam, mut call, mut w) = (0f64, 0f64, 0f64);
            for h in 0..NUM_CLASSES {
                let n = class_count(h) as f64;
                w += n;
                jam += n * s.avg[0][NUM_CLASSES + h] as f64;
                call += n * s.avg[2][NUM_CLASSES + h] as f64;
            }
            let (jam, call) = (jam / w, call / w);
            if stack == 10.0 {
                // published HU Nash charts: SB shoves ~58 %, BB calls ~37-38 % at 10bb
                assert!((0.55..0.62).contains(&jam), "jam {}", jam);
                assert!((0.34..0.41).contains(&call), "call {}", call);
                // AA always shoves / calls, 72o never calls
                let aa = 0usize;
                let o72 = (0..NUM_CLASSES).find(|&c| class_name(c) == "72o").unwrap();
                assert!(s.avg[0][NUM_CLASSES + aa] > 0.99 && s.avg[2][NUM_CLASSES + aa] > 0.99);
                assert!(s.avg[2][NUM_CLASSES + o72] < 0.01);
            }
            if let Some((pj, pc)) = prev {
                assert!(jam < pj && call < pc, "ranges must tighten as stacks grow");
            }
            prev = Some((jam, call));
        }
    }
}
