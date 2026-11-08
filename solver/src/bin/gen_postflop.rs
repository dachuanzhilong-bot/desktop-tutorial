//! Solves a set of representative flops for several preflop scenarios and writes `TSP1` files.
//!
//!   cargo run --release --bin gen_postflop -- --pre out/cash6max-100bb --out out/postflop
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tessera_solver::cards::{class_info, RANK_CHARS, NUM_CLASSES};
use tessera_solver::postflop::*;
use tessera_solver::solution_io;

fn arg<T: std::str::FromStr>(args: &[String], name: &str, default: T) -> T {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default)
}

struct Scenario {
    id: &'static str,
    title: &'static str,
    /// preflop path + action kinds of the OOP / IP player
    oop: (&'static str, &'static [u8]),
    ip: (&'static str, &'static [u8]),
    pot: f32,
    stack: f32,
    oop_seat: &'static str,
    ip_seat: &'static str,
}

const SCENARIOS: &[Scenario] = &[
    Scenario { id: "srp-btn-bb", title: "BTN open / BB call", oop: ("FFFRF", &[1]), ip: ("FFF", &[2, 3]), pot: 5.5, stack: 97.5, oop_seat: "BB", ip_seat: "BTN" },
    Scenario { id: "3bp-btn-bb", title: "BTN open / BB 3-bet / BTN call", oop: ("FFFRF", &[2, 3]), ip: ("FFFRFR", &[1]), pot: 22.5, stack: 89.0, oop_seat: "BB", ip_seat: "BTN" },
    Scenario { id: "srp-co-bb", title: "CO open / BB call", oop: ("FFRFF", &[1]), ip: ("FF", &[2, 3]), pot: 5.5, stack: 97.5, oop_seat: "BB", ip_seat: "CO" },
];

/// representative flops (rank/suit text) covering the main texture families
const FLOPS: &[&str] = &[
    "As 7d 2c", "Kd 8s 3c", "Qs Jd 6s", "9s 6d 3c", "8c 7d 5s", "Ah Jh 5c", "Kh Qd Jc", "Ks Kd 5c", "Td 9d 8d", "6s 5d 4c",
    "Qc 7h 2d", "Ks 9h 5h", "8c 8d 3s", "Jc 8d 3h", "Ah 8h 3h", "Td 6h 2c", "9h 8h 4c", "7d 5h 4s", "5c 3d 2h", "5c 5d 2h", "Ac Kd 4h",
];

fn card(s: &str) -> u8 {
    let b = s.as_bytes();
    (b"23456789TJQKA".iter().position(|&x| x == b[0]).unwrap() as u8) * 4 + b"cdhs".iter().position(|&x| x == b[1]).unwrap() as u8
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
    #[cfg(target_arch = "x86_64")]
    #[allow(deprecated)]
    unsafe {
        use std::arch::x86_64::{_mm_getcsr, _mm_setcsr};
        _mm_setcsr(_mm_getcsr() | 0x8040);
    }
    let args: Vec<String> = std::env::args().collect();
    let pre: String = arg(&args, "--pre", "out/cash6max-100bb".to_string());
    let out: String = arg(&args, "--out", "out/postflop".to_string());
    let iters: u32 = arg(&args, "--iters", 700);
    let threads: usize = arg(&args, "--threads", std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let only: String = arg(&args, "--scenario", String::new());
    let n_flops: usize = arg(&args, "--flops", FLOPS.len());
    let min_reach: f32 = arg(&args, "--min-reach", 0.004);
    let turn_cards: usize = arg(&args, "--turn-cards", 6);
    let river_cards: usize = arg(&args, "--river-cards", 2);
    let avg_from: f32 = arg(&args, "--avg-from", 0.5);
    let only_flop: i32 = arg(&args, "--only-flop", -1);
    let from_flop: usize = arg(&args, "--from-flop", 0);

    let sol = solution_io::load(&pre).expect("preflop solution");
    let mut tasks: Vec<(usize, usize)> = Vec::new();
    for (si, sc) in SCENARIOS.iter().enumerate() {
        if !only.is_empty() && !only.split(',').any(|x| x == sc.id) {
            continue;
        }
        for fi in from_flop..n_flops.min(FLOPS.len()) {
            if only_flop >= 0 && fi as i32 != only_flop {
                continue;
            }
            tasks.push((si, fi));
        }
    }
    // ranges per scenario
    let mut ranges: Vec<[Vec<f32>; 2]> = Vec::new();
    for sc in SCENARIOS {
        let get = |(path, kinds): (&str, &[u8])| -> Vec<f32> {
            let node = sol.find(path).unwrap_or_else(|| panic!("no node {}", path));
            let r = sol.range(node, kinds).unwrap_or_else(|| panic!("no range {}", path));
            expand(&r)
        };
        ranges.push([get(sc.oop), get(sc.ip)]);
    }
    for (i, sc) in SCENARIOS.iter().enumerate() {
        let combos = |r: &Vec<f32>| r.iter().sum::<f32>();
        eprintln!("{:<12} {} range {:.0} combos ({:.1}%)  {} range {:.0} combos ({:.1}%)", sc.id, sc.oop_seat, combos(&ranges[i][0]), combos(&ranges[i][0]) / 13.26, sc.ip_seat, combos(&ranges[i][1]), combos(&ranges[i][1]) / 13.26);
    }

    std::fs::create_dir_all(&out).unwrap();
    let next = AtomicUsize::new(0);
    let stats_log = Mutex::new(Vec::<(usize, usize, String)>::new());
    let t0 = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= tasks.len() {
                    break;
                }
                let (si, fi) = tasks[i];
                let sc = &SCENARIOS[si];
                let board: Vec<u8> = FLOPS[fi].split_whitespace().map(card).collect();
                let cfg = Config { pot: sc.pot, stack: sc.stack, turn_cards, river_cards, seed: 11 + fi as u64, ..Config::default() };
                let t = Instant::now();
                let tree = build_tree(&cfg, &board);
                let mut solver = Solver::new(&tree, &ranges[si]);
                for i in 0..iters {
                    if i == (iters as f32 * avg_from) as u32 && avg_from > 0.0 {
                        solver.reset_average();
                    }
                    solver.iterate();
                }
                solver.finalize_avg();
                let expl = solver.exploitability();
                let ev = solver.evaluate();
                let (eq_oop, eq_ip) = (solver.range_equity(0), solver.range_equity(1));
                let stats = flop_stats(&tree, &ev, eq_oop, eq_ip, 100.0 * expl / sc.pot);
                stats_log.lock().unwrap().push((si, fi, stats));
                let bytes = export(&tree, &ev, min_reach);
                let dir = format!("{}/{}", out, sc.id);
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(format!("{}/{}.bin", dir, fi), &bytes).unwrap();
                let msg = format!("{} flop {:2} {:<9} nodes {:4}  expl {:.3} chips ({:.2}% pot)  {:>7} B  {:.0}s", sc.id, fi, FLOPS[fi], tree.nodes.len(), expl, 100.0 * expl / sc.pot, bytes.len(), t.elapsed().as_secs_f32());
                eprintln!("{}", msg);
            });
        }
    });
    // index of what was produced
    let mut idx = String::from("{\"format\":1,\"flops\":[");
    for (i, f) in FLOPS.iter().take(n_flops.min(FLOPS.len())).enumerate() {
        if i > 0 {
            idx.push(',');
        }
        idx.push_str(&format!("\"{}\"", f));
    }
    idx.push_str("],\"scenarios\":[");
    let mut first = true;
    for (i, sc) in SCENARIOS.iter().enumerate() {
        if !only.is_empty() && !only.split(',').any(|x| x == sc.id) {
            continue;
        }
        if !first {
            idx.push(',');
        }
        first = false;
        let stat = |r: &Vec<f32>| r.iter().sum::<f32>() / 13.26;
        idx.push_str(&format!(
            "{{\"id\":\"{}\",\"title\":\"{}\",\"pot\":{},\"stack\":{},\"oop\":\"{}\",\"ip\":\"{}\",\"oopPct\":{:.2},\"ipPct\":{:.2},\"iterations\":{},\"turnCards\":{},\"riverCards\":{}}}",
            sc.id, sc.title, sc.pot, sc.stack, sc.oop_seat, sc.ip_seat, stat(&ranges[i][0]), stat(&ranges[i][1]), iters, turn_cards, river_cards
        ));
    }
    idx.push_str("],\"stats\":{");
    let mut st = stats_log.lock().unwrap().clone();
    st.sort_by_key(|x| (x.0, x.1));
    for (i, (si, fi, js)) in st.iter().enumerate() {
        if i > 0 {
            idx.push(',');
        }
        idx.push_str(&format!("\"{}/{}\":{}", SCENARIOS[*si].id, fi, js));
    }
    idx.push_str("}}");
    std::fs::write(format!("{}/index.json", out), idx).unwrap();
    eprintln!("done in {:.0}s", t0.elapsed().as_secs_f32());
    let _ = (class_info as fn(usize) -> _, RANK_CHARS, NUM_CLASSES);
}
