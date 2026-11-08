//! Generates the 6-max 100bb preflop solution consumed by the web app.
//!
//!   cargo run --release --bin gen_preflop -- --out ../web/solutions-src/cash6max-100bb
use std::time::Instant;
use tessera_solver::{equity, preflop::*};

fn arg<T: std::str::FromStr>(args: &[String], name: &str, default: T) -> T {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn main() {
    // denormal floats make the CFR loops ~10x slower once reaches get tiny: flush them to zero
    #[cfg(target_arch = "x86_64")]
    #[allow(deprecated)]
    unsafe {
        use std::arch::x86_64::{_mm_getcsr, _mm_setcsr};
        _mm_setcsr(_mm_getcsr() | 0x8040);
    }
    let args: Vec<String> = std::env::args().collect();
    let iters: u32 = arg(&args, "--iters", 2000);
    let samples: u32 = arg(&args, "--eq-samples", 60_000);
    let threads: usize = arg(&args, "--threads", std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let out: String = arg(&args, "--out", "out/cash6max-100bb".to_string());
    let seed: u64 = arg(&args, "--seed", 20260101);
    let log_every: u32 = arg(&args, "--log-every", 250);
    let explore: f32 = arg(&args, "--explore", 0.2);
    let lambda: f32 = arg(&args, "--lambda", 3.0);
    let polish: u32 = arg(&args, "--polish", 4000);
    let min_reach: f32 = arg(&args, "--min-reach", 2e-7);
    let report_only: bool = args.iter().any(|a| a == "--report");

    let mut cfg = Config::default();
    cfg.real.ip_mean = arg(&args, "--ip-mean", cfg.real.ip_mean);
    cfg.real.ip_slope = arg(&args, "--ip-slope", cfg.real.ip_slope);
    cfg.real.oop_mean = arg(&args, "--oop-mean", cfg.real.oop_mean);
    cfg.real.oop_slope = arg(&args, "--oop-slope", cfg.real.oop_slope);
    cfg.real.spr_scale = arg(&args, "--spr-scale", cfg.real.spr_scale);

    std::fs::create_dir_all("cache").ok();
    let cache = format!("cache/equity-{}-{}.bin", samples, seed);
    let t0 = Instant::now();
    let tables = match equity::load(&cache) {
        Some(t) => {
            eprintln!("equity table loaded from {}", cache);
            t
        }
        None => {
            eprintln!("computing 169x169 equity table ({} samples/pair, {} threads)...", samples, threads);
            let t = equity::compute_equity(samples, seed, threads);
            equity::save(&t, &cache).ok();
            eprintln!("  done in {:.1}s", t0.elapsed().as_secs_f32());
            t
        }
    };

    let pf = build_preflop(&cfg, &tables);
    let n_dec = pf.game.nodes.iter().filter(|n| matches!(n.kind, tessera_solver::engine::Kind::Decision { .. })).count();
    eprintln!("tree: {} nodes ({} decision), {} showdown classes", pf.game.nodes.len(), n_dec, pf.game.classes.len());

    let mut solver = tessera_solver::engine::Solver::new(&pf.game);
    solver.explore = explore;
    solver.lambda = lambda;
    let t1 = Instant::now();
    let mut last_gap = (f32::NAN, f32::NAN);
    for i in 1..=iters {
        solver.iterate();
        if i % log_every == 0 || i == iters {
            solver.finalize_avg();
            let gaps = solver.br_gaps();
            let max = gaps.iter().cloned().fold(0.0, f32::max);
            let mean = gaps.iter().sum::<f32>() / gaps.len() as f32;
            last_gap = (max, mean);
            eprintln!("iter {:5}  {:6.1}s  best-response gain  max {:.4} bb  mean {:.4} bb", i, t1.elapsed().as_secs_f32(), max, mean);
        }
    }
    // final phase: no trembles, fresh averaging from the trained regrets
    solver.explore = 0.0;
    solver.reset_average();
    for i in 1..=polish {
        solver.iterate();
        if i % 100 == 0 {
            solver.finalize_avg();
            let gaps = solver.br_gaps();
            let max = gaps.iter().cloned().fold(0.0, f32::max);
            let mean = gaps.iter().sum::<f32>() / gaps.len() as f32;
            last_gap = (max, mean);
            eprintln!("polish {:4}  best-response gain  max {:.4} bb  mean {:.4} bb", i, max, mean);
        }
    }
    solver.finalize_avg();
    let values = solver.root_values();
    let ev = solver.evaluate();
    println!("{}", report(&pf, &ev));
    if let Some(i) = args.iter().position(|a| a == "--dump") {
        let path = args[i + 1].clone();
        let hands: Vec<String> = args[i + 2].split(',').map(|s| s.to_string()).collect();
        if let Some(n) = find_node(&pf, &path) {
            let e = ev[n].as_ref().unwrap();
            let k = pf.game.k;
            println!("node {} path {} actions {:?}", n, path, pf.meta[n].actions);
            for h in 0..k {
                let name = tessera_solver::cards::class_name(h);
                if hands.contains(&name) {
                    let na = pf.meta[n].actions.len();
                    let fr: Vec<String> = (0..na).map(|a| format!("{:.2}", e.freq[a * k + h])).collect();
                    let evs: Vec<String> = (0..na).map(|a| format!("{:+.3}", e.ev[a * k + h])).collect();
                    println!("{:4} w={:.2} eq={:.3} freq [{}] ev [{}]", name, e.weight[h], e.eq[h], fr.join(" "), evs.join(" "));
                }
            }
        }
    }
    println!("root values (bb): {:?}", values.iter().map(|v| (v * 1000.0).round() / 1000.0).collect::<Vec<_>>());
    if report_only {
        return;
    }
    let info = format!(
        "{{\"solver\":\"tessera-cfr+\",\"iterations\":{},\"polish\":{},\"eqSamples\":{},\"brGainMax\":{:.5},\"brGainMean\":{:.5},\"model\":\"169-class CFR+, up to 3-way flops, EQR model\",\"real\":{{\"ipMean\":{},\"ipSlope\":{},\"oopMean\":{},\"oopSlope\":{},\"sprScale\":{}}}}}",
        iters, polish, samples, last_gap.0, last_gap.1, cfg.real.ip_mean, cfg.real.ip_slope, cfg.real.oop_mean, cfg.real.oop_slope, cfg.real.spr_scale
    );
    let st = export(&pf, &ev, &out, "cash6max-100bb", &info, min_reach).expect("export failed");
    eprintln!("exported {} decision nodes, {:.2} MB raw -> {}", st.nodes, st.bytes as f64 / 1e6, out);
}
