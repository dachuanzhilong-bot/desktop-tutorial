//! REFACTOR_PLAN 4-6, step 2 (`docs/16` §4): the river subtrees of one training walk on the GPU and on the CPU, from
//! the same state with real reaches; the time of each, and how far apart the results are (`gpu_bench`).
//!
//!   CUDA_PATH=$HOME/cuda cargo run --release --features cuda --bin bench_gpu -- --pre out/pre/cash6max-100bb \
//!       [--scenario srp-btn-bb] [--flop "As 7d 2c"] [--turn-cards 49] [--river-cards 8] [--update alt-dcfr] \
//!       [--warm 5] [--solve-threads 4] [--reps 5] [--cpu-threads 1,24]
//!
//! It builds the flop tree of `gen_postflop --all-cards` with fewer river cards (49 x 8: about 10,000 river subtrees),
//! trains `--warm` iterations, records the reaches of one more, and then repeats that iteration's river part: once on
//! each side to compare the regrets / strategy sums / root values (relative to each node's largest magnitude), then
//! `--reps` times on each side for the time.  Without the feature `cuda`, the CPU side only.
use std::time::Instant;
use tessera_solver::gpu_bench::*;
use tessera_solver::postflop::*;
use tessera_solver::solution_io;

/// a preflop line of one player: the path and the action kinds of the range
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

/// class weights -> combo weights (same as `gen_postflop`)
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
    // flush denormals to zero, as gen_postflop
    #[cfg(target_arch = "x86_64")]
    #[allow(deprecated)]
    // SAFETY: sets the FTZ / DAZ bits of MXCSR, as gen_postflop does; valid on every x86-64
    unsafe {
        use std::arch::x86_64::{_mm_getcsr, _mm_setcsr};
        _mm_setcsr(_mm_getcsr() | 0x8040);
    }
    let args: Vec<String> = std::env::args().collect();
    let num = |name: &str, d: usize| -> usize { arg(&args, name).map(|x| x.parse().unwrap_or_else(|_| panic!("{}: a number", name))).unwrap_or(d) };
    let pre = arg(&args, "--pre").expect("--pre <raw preflop solution dir>");
    let scenario = arg(&args, "--scenario").unwrap_or_else(|| "srp-btn-bb".into());
    let flop = arg(&args, "--flop").unwrap_or_else(|| "As 7d 2c".into());
    let turn_cards = num("--turn-cards", 49);
    let river_cards = num("--river-cards", 8);
    let flop_runouts = num("--flop-runouts", 1176);
    let warm = num("--warm", 5);
    let solve_threads = num("--solve-threads", 4);
    let reps = num("--reps", 5).max(1);
    let cpu_threads: Vec<usize> = arg(&args, "--cpu-threads").unwrap_or_else(|| "1".into()).split(',').map(|x| x.trim().parse().expect("--cpu-threads N[,N...]")).collect();
    let update = arg(&args, "--update").map(|x| Update::parse(&x).unwrap_or_else(|| panic!("--update {}: sim-cfr+, alt-cfr+ or alt-dcfr", x))).unwrap_or(Update::AltDcfr);
    // the scenarios of gen_postflop (SCENARIOS): the preflop paths of the two players and the pot and stack at the flop
    let (oop, ip, pot, stack): (Line, Line, f32, f32) = match scenario.as_str() {
        "srp-btn-bb" => (("FFFRF", &[1]), ("FFF", &[2, 3]), 5.5, 97.5),
        "3bp-btn-bb" => (("FFFRF", &[2, 3]), ("FFFRFR", &[1]), 22.5, 89.0),
        "srp-co-bb" => (("FFRFF", &[1]), ("FF", &[2, 3]), 5.5, 97.5),
        x => panic!("unknown scenario {}", x),
    };
    let sol = solution_io::load(&pre).expect("preflop solution");
    let get = |(path, kinds): Line| -> Vec<f32> {
        let node = sol.find(path).unwrap_or_else(|| panic!("no node {}", path));
        expand(&sol.range(node, kinds).unwrap_or_else(|| panic!("no range {}", path)))
    };
    let ranges = [get(oop), get(ip)];
    let board: Vec<u8> = flop.split_whitespace().map(card).collect();
    let t0 = Instant::now();
    let cfg = Config { pot, stack, turn_cards, river_cards, flop_runouts, seed: 11, ..Config::default() };
    let tree = build_tree(&cfg, &board);
    eprintln!("{} {}: {} x {} cards, {} nodes, built in {:.1}s", scenario, flop, turn_cards, river_cards, tree.nodes.len(), t0.elapsed().as_secs_f32());
    let mut s = Solver::with_options(&tree, &ranges, SolverOptions { avg_on_demand_from: 2, threads: solve_threads, update, ..Default::default() });
    let t1 = Instant::now();
    let mut last = 0f64;
    for _ in 0..warm {
        let t = Instant::now();
        s.iterate();
        last = t.elapsed().as_secs_f64();
    }
    let capture = s.capture_river_inputs();
    eprintln!("{} + 1 iterations ({}) on {} threads in {:.1}s; {} river subtree walks recorded", warm, update.name(), solve_threads, t1.elapsed().as_secs_f32(), capture.len());
    // the whole iteration (the river subtrees and the rest), to compare with the river part alone below
    println!("solver: {:.3} s per iteration on {} threads (the last warm iteration: everything, river subtrees included)", last, solve_threads);
    let mut b = Bench::new(s, capture);
    let n = b.subtrees();
    println!("bench: {} {} {}x{}, update {}, {} river subtrees, {} walk(s), river regrets + strategy sums {:.2} GB", scenario, flop, turn_cards, river_cards, update.name(), n, b.walks.len(), b.state_bytes() as f64 / 1e9);
    // 49 x 48: as many subtrees per river card
    let scale = 48.0 / river_cards as f64;

    #[cfg(feature = "cuda")]
    let mut gpu = {
        let g = tessera_solver::gpu_bench::gpu::Gpu::new(&b).unwrap_or_else(|e| panic!("GPU: {}", e));
        println!("gpu: {}; upload {:.2}s", g.info, g.upload_secs);
        g
    };

    // one iteration on each side from the same state: how far apart
    let (cpu_secs, cpu_vals) = b.cpu_walks(cpu_threads[0]);
    println!("cpu ({} threads), first: {:.3}s per iteration ({:?} per walk)", cpu_threads[0], cpu_secs.iter().sum::<f64>(), cpu_secs.iter().map(|x| format!("{:.3}", x)).collect::<Vec<_>>());
    #[cfg(feature = "cuda")]
    {
        let mut ms = Vec::new();
        for w in 0..b.walks.len() {
            ms.push(gpu.walk(&b, w).unwrap_or_else(|e| panic!("{}", e)));
        }
        println!("gpu, first: {:.2} ms per iteration ({:?} per walk)", ms.iter().sum::<f64>(), ms.iter().map(|x| format!("{:.2}", x)).collect::<Vec<_>>());
        let [(dr, nr), (ds, nss), (dv, nv)] = gpu.compare(&b, &cpu_vals).unwrap_or_else(|e| panic!("{}", e));
        println!("gpu vs cpu after 1 iteration (max |gpu - cpu| / max |cpu| of a node): regrets {:.2e} ({} nodes), strategy sums {:.2e} ({} nodes), root values {:.2e} ({} vectors)", dr, nr, ds, nss, dv, nv);
    }
    #[cfg(not(feature = "cuda"))]
    let _ = &cpu_vals;

    // the time
    for &th in &cpu_threads {
        let t = Instant::now();
        for _ in 0..reps {
            b.cpu_walks(th);
        }
        let per = t.elapsed().as_secs_f64() / reps as f64;
        println!("cpu {:>2} threads: {:.3} s per iteration ({:.1} us per subtree walk); 49 x 48 (x{:.0} subtrees): {:.2} s", th, per, per * 1e6 / (n * b.walks.len()) as f64, scale, per * scale);
    }
    #[cfg(feature = "cuda")]
    {
        let t = Instant::now();
        let mut kernel = 0f64;
        for _ in 0..reps {
            for w in 0..b.walks.len() {
                kernel += gpu.walk(&b, w).unwrap_or_else(|e| panic!("{}", e));
            }
        }
        let wall = t.elapsed().as_secs_f64() / reps as f64;
        let per = kernel / 1e3 / reps as f64;
        println!("gpu: {:.2} ms per iteration (kernel; {:.2} ms wall); 49 x 48 (x{:.0} subtrees): {:.3} s", per * 1e3, wall * 1e3, scale, per * scale);
    }
}
