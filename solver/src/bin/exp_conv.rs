//! EXPERIMENT (review 2026-11-21, not for the main branch): how fast does the average strategy converge with
//! CFR+ (simultaneous updates, the solver as it is), CFR+ with alternating updates, and DCFR (alternating)?
//! Measured in walks of the tree (an alternating iteration is two walks), with the all-card exploitability
//! (sum of both players, % of the starting pot).
//!
//!   exp_conv --pre out/pre/cash6max-100bb --board "As 7d 2c 9h" --variant cfrp-sim --walks 3000
//!       --checks 500,1000,1500,2000,3000 [--reset 500] [--threads 4] [--sizes current|plan] [--river-cards 48]
use std::time::Instant;
use tessera_solver::postflop::*;
use tessera_solver::solution_io;

type Line = (&'static str, &'static [u8]);

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn card(s: &str) -> u8 {
    let b = s.as_bytes();
    let r = b"23456789TJQKA".iter().position(|&x| x == b[0]).expect("rank") as u8;
    let su = b"cdhs".iter().position(|&x| x == b[1]).expect("suit") as u8;
    r * 4 + su
}

fn expand(class_range: &[f32]) -> Vec<f32> {
    ct().cards
        .iter()
        .map(|&(a, b)| {
            let (r1, r2) = ((a >> 2) as usize, (b >> 2) as usize);
            let (hi, lo) = (r1.max(r2), r1.min(r2));
            let cls = if hi == lo { (12 - hi) * 13 + (12 - hi) } else if (a & 3) == (b & 3) { (12 - hi) * 13 + (12 - lo) } else { (12 - lo) * 13 + (12 - hi) };
            class_range[cls]
        })
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pre = arg(&args, "--pre").expect("--pre");
    let board_s = arg(&args, "--board").unwrap_or_else(|| "As 7d 2c 9h".into());
    let variant = arg(&args, "--variant").unwrap_or_else(|| "cfrp-sim".into());
    let walks: u32 = arg(&args, "--walks").map(|x| x.parse().unwrap()).unwrap_or(3000);
    let checks: Vec<u32> = arg(&args, "--checks").unwrap_or_else(|| "500,1000,1500,2000,3000".into()).split(',').map(|x| x.parse().unwrap()).collect();
    let reset: u32 = arg(&args, "--reset").map(|x| x.parse().unwrap()).unwrap_or(0);
    let threads: usize = arg(&args, "--threads").map(|x| x.parse().unwrap()).unwrap_or(1);
    let sizes = arg(&args, "--sizes").unwrap_or_else(|| "current".into());
    let turn_cards: usize = arg(&args, "--turn-cards").map(|x| x.parse().unwrap()).unwrap_or(49);
    let river_cards: usize = arg(&args, "--river-cards").map(|x| x.parse().unwrap()).unwrap_or(48);
    let (oop, ip): (Line, Line) = (("FFFRF", &[1]), ("FFF", &[2, 3]));
    let sol = solution_io::load(&pre).expect("preflop solution");
    let get = |(path, kinds): Line| -> Vec<f32> {
        let node = sol.find(path).unwrap_or_else(|| panic!("no node {}", path));
        expand(&sol.range(node, kinds).unwrap_or_else(|| panic!("no range {}", path)))
    };
    let ranges = [get(oop), get(ip)];
    let bets = match sizes.as_str() {
        "current" => [vec![0.33, 0.75], vec![0.66], vec![0.5, 1.0]],
        "plan" => [vec![0.33, 0.75, 1.25], vec![0.5, 1.0, 1.5], vec![0.33, 0.75, 1.5]],
        "two" => [vec![0.33, 0.75], vec![0.5, 1.0], vec![0.5, 1.0]],
        x => panic!("sizes {}", x),
    };
    let cfg = Config { bets, turn_cards, river_cards, flop_runouts: 1176, seed: 11, ..Config::default() };
    let board: Vec<u8> = board_s.split_whitespace().map(card).collect();
    let tree = build_tree(&cfg, &board);
    let mut s = Solver::with_options(&tree, &ranges, SolverOptions { threads, ..SolverOptions::default() });
    let (alternating, dcfr) = match variant.as_str() {
        "cfrp-sim" => (false, None),
        "cfrp-alt" => (true, None),
        "dcfr-sim" => (false, Some((1.5, 2.0))),
        "dcfr-alt" => (true, Some((1.5, 2.0))),
        "dcfr3-alt" => (true, Some((1.5, 3.0))),
        x => panic!("variant {}", x),
    };
    let per_iter = if alternating { 2 } else { 1 };
    eprintln!("{} {} sizes {} nodes {} variant {} reset {} threads {}", "srp-btn-bb", board_s, sizes, tree.nodes.len(), variant, reset, threads);
    let t0 = Instant::now();
    let mut done = 0u32;
    let mut train_secs = 0f64;
    while done < walks {
        let ti = Instant::now();
        s.iterate_exp(alternating, dcfr);
        train_secs += ti.elapsed().as_secs_f64();
        done += per_iter;
        if reset > 0 && done == reset && dcfr.is_none() {
            s.reset_average();
        }
        if checks.contains(&done) {
            let base = s.root_values();
            let g = [s.best_response_gain(0, base), s.best_response_gain(1, base)];
            let pct = 100.0 * (g[0] + g[1]) / cfg.pot;
            // the same with the river playing its last iterate (no river average needed)
            s.set_current_strategy_from(2);
            let base_c = s.root_values();
            let gc = [s.best_response_gain(0, base_c), s.best_response_gain(1, base_c)];
            s.set_current_strategy_from(3);
            let pct_rc = 100.0 * (gc[0] + gc[1]) / cfg.pot;
            println!(
                "{{\"board\":\"{}\",\"sizes\":\"{}\",\"variant\":\"{}\",\"reset\":{},\"walks\":{},\"iters\":{},\"pct\":{:.4},\"pctRiverCurrent\":{:.4},\"oop\":{:.4},\"ip\":{:.4},\"ev\":[{:.4},{:.4}],\"trainSecPerWalk\":{:.4},\"wall\":{:.1}}}",
                board_s, sizes, variant, reset, done, s.iters, pct, pct_rc, 100.0 * g[0] / cfg.pot, 100.0 * g[1] / cfg.pot, base[0], base[1], train_secs / done as f64, t0.elapsed().as_secs_f64()
            );
        }
    }
}
