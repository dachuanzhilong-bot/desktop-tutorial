//! Solves a set of representative flops for several preflop scenarios and writes `TSP1` files.
//!
//!   cargo run --release --bin gen_postflop -- --pre out/cash6max-100bb --out out/postflop
//!
//! Every turn / river card (REFACTOR_PLAN 3-3; regrets of the river only, no river average, docs/14 §2 (a)):
//!   ... --turn-cards 49 --river-cards 48 --flop-runouts 1176 --no-average-from 2
//!
//! Production of plan B (REFACTOR_PLAN 3-3-5, `TSP1` v3: flop and turn nodes + the reach ranges at every river start,
//! the river is solved on the device):
//!
//!   ... --all-cards [--scenario srp-btn-bb] [--only-flop 0] --threads 1 --solve-threads 4 [--checkpoint DIR]
//!
//! `--all-cards` = `--turn-cards 49 --river-cards 48 --flop-runouts 1176 --no-average-from 2` (each can still be given,
//! e.g. `--river-cards 2` for a quick run) and writes `TSP1` v3.  Every flop's `<n>.bin` and `<n>.stats.json` are
//! written as soon as it is solved, and `index.json` is rewritten from all the `.stats.json` files after every flop, so
//! an interrupted run loses at most the flops being solved; running the same command again skips the flops whose
//! `.bin` and `.stats.json` are there.  `--checkpoint DIR` also saves each flop's solver every `--checkpoint-every`
//! iterations (default 100) to `DIR/<scenario>-<flop>/` and resumes from there (REFACTOR_PLAN 3-3-3; bit for bit the
//! same result), removed once the flop is written.
//!
//! Production with the all-card value looked at (REFACTOR_PLAN 3-3-7): `--g1-target 0.5` replaces the fixed `--iters` with
//! "iterate, look at the all-card exploitability (G1, % of the pot, the whole tree under the average strategy, the
//! river's average made on demand) every `--check-every 500` iterations, stop at the first value at most the target, give
//! up at `--max-iters 5000`".  The strategy average restarts once, before iteration `--avg-restart 500` + 1 (the first look
//! is at 1,000), so the river's `ssum` is kept (about 8 GB for an SRP flop, against 4.6 GB without it).  Each flop's
//! `<n>.g1.json` (written before its `.bin`) holds the iterations, the values looked at and whether the target was met; a flop
//! that is not met is written all the same and listed at the end (the exit code is 3), so that the hours are not lost.
//! `index.json` names `--max-iters` as the scenario's `iterations`.  `--checkpoint` works as above (its tag does not name
//! the iteration count).  Without `--g1-target` nothing of this exists: the output is what it was.
//!
//! Threads: `--threads N` solves N flops at a time; `--solve-threads M` walks one flop's turn card subtrees on M
//! threads (REFACTOR_PLAN 3-3-2; default 1, the results are bit for bit the same for every M).  The two
//! multiply: up to N x M busy threads, so keep N x M at most the number of cores (e.g. one big flop at a time:
//! `--threads 1 --solve-threads 4`).  Memory grows with N (one tree per flop being solved), not with M.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tessera_solver::allcards::{run_iterations, run_until, Checkpoints, Looks, Plan};
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

/// A preflop amount as the web app's position keys write it (`keyAmount` in web/src/lib/solution/positionKey.ts):
/// rounded to 0.01bb, no trailing zeros ("2.5", "11", "100").
fn key_amount(x: f32) -> String {
    format!("{}", (x as f64 * 100.0).round() / 100.0)
}

/// The preflop line that ends with the action of `kinds` taken at the node `path` leads to (the first matching action,
/// as `PfSolution::range` takes it), in the position-key format of web/src/lib/solution/positionKey.ts:
/// tokens joined by "-", F fold, C call, X check, R<to> raise, A<to> all-in (e.g. "F-F-F-R2.5-F-C").
/// `blinds` are posted by the last two seats of `players` seats. Returns the line and the seat that takes the last action.
fn line_key(sol: &solution_io::PfSolution, players: usize, blinds: (f32, f32), path: &str, kinds: &[u8]) -> (String, usize) {
    let mut inv = vec![0f32; players];
    inv[players - 2] = blinds.0;
    inv[players - 1] = blinds.1;
    let mut bet = blinds.1;
    let mut node = 0usize;
    let mut tokens = Vec::new();
    let mut actor = 0usize;
    let steps: Vec<&[u8]> = path
        .chars()
        .map(|ch| match ch {
            'F' => &[0u8][..],
            'C' => &[1u8][..],
            'R' => &[2u8, 3][..],
            _ => panic!("bad path {}", path),
        })
        .chain(std::iter::once(kinds))
        .collect();
    for (i, want) in steps.iter().enumerate() {
        let n = &sol.nodes[node];
        actor = n.actor as usize;
        let a = n.actions.iter().find(|a| want.contains(&a.kind)).unwrap_or_else(|| panic!("no action {:?} on {}", want, path));
        tokens.push(match a.kind {
            0 => "F".to_string(),
            1 => {
                let t = if inv[actor] >= bet { "X" } else { "C" };
                inv[actor] = bet;
                t.to_string()
            }
            k => {
                inv[actor] = a.to;
                bet = a.to;
                format!("{}{}", if k == 3 { "A" } else { "R" }, key_amount(a.to))
            }
        });
        if i + 1 < steps.len() {
            assert!(a.child >= 0, "path {} leaves the tree", path);
            node = a.child as usize;
        }
    }
    (tokens.join("-"), actor)
}

/// `"pre"` of a scenario in index.json: where it joins the preflop solution (REFACTOR_PLAN 2-4). The web app
/// (lib/postflop/link.ts) continues a preflop hand on this scenario when each player's line through their last
/// preflop action is `oopPath` / `ipPath`.
fn pre_json(sol: &solution_io::PfSolution, seats: &[String], stack: f64, blinds: (f32, f32), sc: &Scenario) -> String {
    let path = |(p, kinds): (&str, &[u8]), seat: &str| {
        let (key, actor) = line_key(sol, seats.len(), blinds, p, kinds);
        assert_eq!(seats.get(actor).map(String::as_str), Some(seat), "{}: {} is not played by {}", sc.id, key, seat);
        key
    };
    format!(
        "{{\"stack\":{},\"oopSeat\":\"{}\",\"ipSeat\":\"{}\",\"oopPath\":\"{}\",\"ipPath\":\"{}\"}}",
        stack,
        sc.oop_seat,
        sc.ip_seat,
        path(sc.oop, sc.oop_seat),
        path(sc.ip, sc.ip_seat)
    )
}

/// seat names, stack and blinds of the preflop solution's raw manifest.json
fn manifest_table(dir: &str) -> (Vec<String>, f64, (f32, f32)) {
    let m = solution_io::parse_json(&std::fs::read_to_string(format!("{}/manifest.json", dir)).expect("preflop manifest.json"));
    let solution_io::J::Obj(fields) = m else { panic!("manifest") };
    let get = |k: &str| fields.iter().find(|(n, _)| n == k).map(|(_, v)| v).unwrap_or_else(|| panic!("manifest has no {}", k));
    let num = |j: &solution_io::J| match j {
        solution_io::J::Num(x) => *x,
        _ => panic!("manifest: not a number"),
    };
    let seats = match get("players") {
        solution_io::J::Arr(v) => v
            .iter()
            .map(|x| match x {
                solution_io::J::Str(s) => s.clone(),
                _ => panic!("manifest players"),
            })
            .collect::<Vec<_>>(),
        _ => panic!("manifest players"),
    };
    let blinds = match get("blinds") {
        solution_io::J::Arr(v) if v.len() == 2 => (num(&v[0]) as f32, num(&v[1]) as f32),
        _ => panic!("manifest blinds"),
    };
    assert!(seats.len() >= 2, "manifest players");
    (seats, num(get("stack")), blinds)
}

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

/// the process's peak resident set in GB (10^9 bytes; VmHWM of /proc/self/status, "?" where there is none)
fn peak_rss() -> String {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmHWM:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|kb| kb.parse::<f64>().ok()))
        .map(|kb| format!("{:.2} GB", kb * 1024.0 / 1e9))
        .unwrap_or_else(|| "?".into())
}

/// write `bytes` to `path` through a temporary file and a rename, so that `path` is never half written
fn write_atomic(path: &str, bytes: &[u8]) {
    let tmp = format!("{}.tmp", path);
    std::fs::write(&tmp, bytes).unwrap_or_else(|e| panic!("{}: {}", tmp, e));
    std::fs::rename(&tmp, path).unwrap_or_else(|e| panic!("{}: {}", path, e));
}

/// `index.json`: the flops, the scenarios that were run (with their ranges and settings) and the stats
/// (`(scenario index, flop index, stats JSON)`, in any order)
#[allow(clippy::too_many_arguments)] // the run's settings, as main has them
fn index_json(n_flops: usize, only: &str, ranges: &[[Vec<f32>; 2]], iters: u32, turn_cards: usize, river_cards: usize, rake: &str, pre_of: &[String], stats: &[(usize, usize, String)]) -> String {
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
            "{{\"id\":\"{}\",\"title\":\"{}\",\"pot\":{},\"stack\":{},\"oop\":\"{}\",\"ip\":\"{}\",\"oopPct\":{:.2},\"ipPct\":{:.2},\"iterations\":{},\"turnCards\":{},\"riverCards\":{}{},\"pre\":{}}}",
            sc.id, sc.title, sc.pot, sc.stack, sc.oop_seat, sc.ip_seat, stat(&ranges[i][0]), stat(&ranges[i][1]), iters, turn_cards, river_cards, rake, pre_of[i]
        ));
    }
    idx.push_str("],\"stats\":{");
    let mut st = stats.to_vec();
    st.sort_by_key(|x| (x.0, x.1));
    for (i, (si, fi, js)) in st.iter().enumerate() {
        if i > 0 {
            idx.push(',');
        }
        idx.push_str(&format!("\"{}/{}\":{}", SCENARIOS[*si].id, fi, js));
    }
    idx.push_str("}}");
    idx
}

/// `--all-cards`: the stats of the flops written so far (`<out>/<scenario>/<flop>.stats.json` next to a `.bin`), for the
/// scenarios and flops of the run
fn stats_on_disk(out: &str, tasks: &[(usize, usize)]) -> Vec<(usize, usize, String)> {
    tasks
        .iter()
        .filter_map(|&(si, fi)| {
            let base = format!("{}/{}/{}", out, SCENARIOS[si].id, fi);
            if !std::path::Path::new(&format!("{}.bin", base)).exists() {
                return None;
            }
            std::fs::read_to_string(format!("{}.stats.json", base)).ok().map(|js| (si, fi, js.trim().to_string()))
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
    // plan B's production (see the top of the file): every card, no river average, TSP1 v3, one flop at a time on disk
    let all_cards = args.iter().any(|a| a == "--all-cards");
    let pre: String = arg(&args, "--pre", "out/cash6max-100bb".to_string());
    let out: String = arg(&args, "--out", "out/postflop".to_string());
    let iters: u32 = arg(&args, "--iters", 700);
    let threads: usize = arg(&args, "--threads", std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let only: String = arg(&args, "--scenario", String::new());
    let n_flops: usize = arg(&args, "--flops", FLOPS.len());
    let min_reach: f32 = arg(&args, "--min-reach", 0.004);
    let turn_cards: usize = arg(&args, "--turn-cards", if all_cards { 49 } else { 6 });
    let river_cards: usize = arg(&args, "--river-cards", if all_cards { 48 } else { 2 });
    let avg_from: f32 = arg(&args, "--avg-from", 0.5);
    let only_flop: i32 = arg(&args, "--only-flop", -1);
    let from_flop: usize = arg(&args, "--from-flop", 0);
    // run-outs that value a flop all-in (1176 = every turn / river pair) and the first street without a
    // strategy average (3 = none; 2 = no river average, plan B of REFACTOR_PLAN 3-3)
    let flop_runouts: usize = arg(&args, "--flop-runouts", if all_cards { 1176 } else { Config::default().flop_runouts });
    let no_average_from: u8 = arg(&args, "--no-average-from", if all_cards { 2 } else { SolverOptions::default().no_average_from });
    // --all-cards: save each flop's solver every K iterations to DIR/<scenario>-<flop>/ and resume from there
    let checkpoint: String = arg(&args, "--checkpoint", String::new());
    let checkpoint_every: u32 = arg(&args, "--checkpoint-every", 100);
    assert!(all_cards || checkpoint.is_empty(), "--checkpoint needs --all-cards");
    // --g1-target (see the top of the file): 0 = off
    let g1_target: f32 = arg(&args, "--g1-target", 0.0);
    let check_every: u32 = arg(&args, "--check-every", 500);
    let max_iters: u32 = arg(&args, "--max-iters", 5000);
    let avg_restart: u32 = arg(&args, "--avg-restart", 500);
    assert!(g1_target == 0.0 || all_cards, "--g1-target needs --all-cards");
    assert!(g1_target == 0.0 || (check_every > 0 && max_iters > avg_restart), "--max-iters must be more than --avg-restart (and --check-every more than 0)");
    let g1_mode = g1_target > 0.0;
    if g1_mode {
        eprintln!("--g1-target {}%: looking every {} iterations from {} (the average restarts before iteration {}), at most {}; the river's average is kept (about 8 GB for an SRP flop)", g1_target, check_every, avg_restart + 1, avg_restart + 1, max_iters);
    }
    let g1_missed = Mutex::new(Vec::<String>::new());
    assert!(!all_cards || no_average_from >= 2, "--all-cards writes the flop and turn averages: --no-average-from must be at least 2");
    // threads inside one flop (see the top of the file: N x M threads with --threads N, keep it <= the cores)
    let solve_threads: usize = arg(&args, "--solve-threads", SolverOptions::default().threads).max(1);
    // rake (REFACTOR_PLAN 3-2): `--rake-pct 5 --rake-cap 3` = 5% of every pot (all terminals have seen the flop), at
    // most 3bb; written to every scenario of index.json as "rake" (left out without rake: the index made before)
    let (rake_pct, rake_cap) = tessera_solver::rake::from_args(&args);
    let rake_field = tessera_solver::rake::json(rake_pct, rake_cap).map(|r| format!(",\"rake\":{}", r)).unwrap_or_default();

    let sol = solution_io::load(&pre).expect("preflop solution");
    let (seats, pre_stack, blinds) = manifest_table(&pre);
    // made before solving: a scenario whose line the preflop solution does not have stops here, not after hours
    let pre_of: Vec<String> = SCENARIOS.iter().map(|sc| pre_json(&sol, &seats, pre_stack, blinds, sc)).collect();
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
    let busy = threads.min(tasks.len()) * solve_threads;
    if busy > std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) {
        eprintln!("warning: {} flops at a time x --solve-threads {} = {} threads, more than the cores of this machine", threads.min(tasks.len()), solve_threads, busy);
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
    let index_lock = Mutex::new(());
    // --all-cards: index.json from the stats written so far, of every flop of the scenarios run (also those of earlier
    // runs, e.g. with another --only-flop)
    let indexed: Vec<(usize, usize)> = (0..SCENARIOS.len())
        .filter(|&si| only.is_empty() || only.split(',').any(|x| x == SCENARIOS[si].id))
        .flat_map(|si| (0..n_flops.min(FLOPS.len())).map(move |fi| (si, fi)))
        .collect();
    let write_index = || {
        let _guard = index_lock.lock().unwrap();
        let idx = index_json(n_flops, &only, &ranges, if g1_mode { max_iters } else { iters }, turn_cards, river_cards, &rake_field, &pre_of, &stats_on_disk(&out, &indexed));
        write_atomic(&format!("{}/index.json", out), idx.as_bytes());
    };
    if all_cards {
        write_index();
    }
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
                let dir = format!("{}/{}", out, sc.id);
                if all_cards && stats_on_disk(&out, &[(si, fi)]).len() == 1 {
                    eprintln!("{} flop {:2} {:<9} already written (skipped)", sc.id, fi, FLOPS[fi]);
                    continue;
                }
                let board: Vec<u8> = FLOPS[fi].split_whitespace().map(card).collect();
                let cfg = Config { pot: sc.pot, stack: sc.stack, turn_cards, river_cards, flop_runouts, seed: 11 + fi as u64, rake_pct, rake_cap, ..Config::default() };
                let t = Instant::now();
                let tree = build_tree(&cfg, &board);
                let opts = if g1_mode { SolverOptions { no_average_from: 3, avg_on_demand_from: 2, threads: solve_threads, ..Default::default() } } else { SolverOptions { no_average_from, threads: solve_threads, ..Default::default() } };
                let mut solver = Solver::with_options(&tree, &ranges[si], opts);
                let t_build = t.elapsed().as_secs_f32();
                let n_dec = tree.nodes.iter().filter(|n| matches!(n.kind, PKind::Decision { .. })).count();
                eprintln!("{} flop {:2} {:<9} built: {} nodes ({} decisions), {:.2} GB regret+ssum, {:.1}s, peak RSS {}", sc.id, fi, FLOPS[fi], tree.nodes.len(), n_dec, solver.strategy_bytes() as f64 / 1e9, t_build, peak_rss());
                let mut ck = None;
                let mut until = None;
                if all_cards && g1_mode {
                    // looking at G1 every `check_every` iterations; the checkpoint's tag does not name the iteration count
                    if !checkpoint.is_empty() {
                        ck = Some(Checkpoints::new(format!("{}/{}-{}", checkpoint, sc.id, fi), format!("gen_postflop g1 reset_at={}", avg_restart)).expect("checkpoint directory"));
                    }
                    let mut log = |m: &str| eprintln!("{} flop {:2} {:<9} {}", sc.id, fi, FLOPS[fi], m);
                    let pot = sc.pot;
                    let mut g1 = |s: &mut Solver| -> f32 {
                        s.finalize_avg();
                        100.0 * s.exploitability() / pot
                    };
                    let info = run_until(&mut solver, &Looks { reset_at: avg_restart, check_every, max_iters, target: g1_target }, ck.as_ref(), if checkpoint.is_empty() { 0 } else { checkpoint_every }, &mut g1, &mut log).expect("checkpoint IO");
                    if info.resumed_from > 0 {
                        eprintln!("{} flop {:2} {:<9} resumed from iteration {}", sc.id, fi, FLOPS[fi], info.resumed_from);
                    }
                    until = Some(info);
                } else if all_cards {
                    // the same iterations (and restart of the average) as the loop below, resumable
                    let plan = Plan::new(iters, avg_from, if checkpoint.is_empty() { 0 } else { checkpoint_every });
                    if !checkpoint.is_empty() {
                        ck = Some(Checkpoints::new(format!("{}/{}-{}", checkpoint, sc.id, fi), format!("gen_postflop {}", plan.tag())).expect("checkpoint directory"));
                    }
                    let mut log = |m: &str| eprintln!("{} flop {:2} {:<9} {}", sc.id, fi, FLOPS[fi], m);
                    let info = run_iterations(&mut solver, &plan, ck.as_ref(), None, &mut log).expect("checkpoint IO");
                    if info.resumed_from > 0 {
                        eprintln!("{} flop {:2} {:<9} resumed from iteration {}", sc.id, fi, FLOPS[fi], info.resumed_from);
                    }
                } else {
                    for i in 0..iters {
                        if i == (iters as f32 * avg_from) as u32 && avg_from > 0.0 {
                            solver.reset_average();
                        }
                        solver.iterate();
                    }
                }
                let done_iters = if g1_mode { solver.iters } else { iters };
                let t_iter = (t.elapsed().as_secs_f32() - t_build) / done_iters.max(1) as f32;
                eprintln!("{} flop {:2} {:<9} {} iterations: {:.2} s/iteration, peak RSS {}", sc.id, fi, FLOPS[fi], done_iters, t_iter, peak_rss());
                solver.finalize_avg();
                let expl = solver.exploitability();
                let ev = solver.evaluate();
                let (eq_oop, eq_ip) = (solver.range_equity(0), solver.range_equity(1));
                let stats = flop_stats(&tree, &ev, eq_oop, eq_ip, 100.0 * expl / sc.pot);
                std::fs::create_dir_all(&dir).unwrap();
                let bytes = if all_cards {
                    let starts = solver.river_starts().expect("the flop and turn averages");
                    let bytes = export_v3(&tree, &ev, &starts, min_reach);
                    if let Some(info) = &until {
                        // G1 of the strategy that is written (`expl` above: the river's average, on demand), and how it was got
                        let g1 = 100.0 * expl / sc.pot;
                        let reached = g1 <= g1_target;
                        let hist: Vec<String> = info.history.iter().map(|(i, v)| format!("[{},{:.4}]", i, v)).collect();
                        let js = format!(
                            "{{\"target\":{},\"iterations\":{},\"g1Pct\":{:.4},\"reached\":{},\"avgRestart\":{},\"checkEvery\":{},\"resumedFrom\":{},\"secsPerIteration\":{:.2},\"looks\":[{}]}}",
                            g1_target, solver.iters, g1, reached, avg_restart, check_every, info.resumed_from, info.secs_per_iter, hist.join(",")
                        );
                        write_atomic(&format!("{}/{}.g1.json", dir, fi), js.as_bytes());
                        if !reached {
                            let m = format!("{} flop {} ({}): G1 {:.4}% after {} iterations, target {}%", sc.id, fi, FLOPS[fi], g1, solver.iters, g1_target);
                            eprintln!("{} flop {:2} {:<9} G1 TARGET NOT REACHED: {}", sc.id, fi, FLOPS[fi], m);
                            g1_missed.lock().unwrap().push(m);
                        }
                    }
                    // the file first, then its stats: a flop counts as written once both are there
                    write_atomic(&format!("{}/{}.bin", dir, fi), &bytes);
                    write_atomic(&format!("{}/{}.stats.json", dir, fi), stats.as_bytes());
                    write_index();
                    if let Some(ck) = &ck {
                        ck.clear().expect("remove the checkpoints");
                    }
                    bytes
                } else {
                    stats_log.lock().unwrap().push((si, fi, stats));
                    let bytes = export(&tree, &ev, min_reach);
                    std::fs::write(format!("{}/{}.bin", dir, fi), &bytes).unwrap();
                    bytes
                };
                let msg = format!("{} flop {:2} {:<9} nodes {:4}  expl {:.3} chips ({:.2}% pot)  {:>7} B  {:.0}s  peak RSS {}", sc.id, fi, FLOPS[fi], tree.nodes.len(), expl, 100.0 * expl / sc.pot, bytes.len(), t.elapsed().as_secs_f32(), peak_rss());
                eprintln!("{}", msg);
            });
        }
    });
    // index of what was produced
    if all_cards {
        write_index();
    } else {
        let idx = index_json(n_flops, &only, &ranges, iters, turn_cards, river_cards, &rake_field, &pre_of, &stats_log.lock().unwrap());
        std::fs::write(format!("{}/index.json", out), idx).unwrap();
    }
    eprintln!("done in {:.0}s", t0.elapsed().as_secs_f32());
    let missed = g1_missed.lock().unwrap();
    if !missed.is_empty() {
        eprintln!("G1 target not reached by {} flop(s) (written all the same; REFACTOR_PLAN 3-3-7: stop and report):", missed.len());
        for m in missed.iter() {
            eprintln!("  {}", m);
        }
        std::process::exit(3);
    }
    let _ = (class_info as fn(usize) -> _, RANK_CHARS, NUM_CLASSES);
}

#[cfg(test)]
mod tests {
    use super::*;
    use solution_io::{PfAction, PfNode, PfSolution};

    /// a 6-max tree with only the lines the tests follow: UTG/HJ/CO fold, BTN opens 2.5 (or goes all-in),
    /// SB folds, BB calls or 3-bets to 11 and BTN calls; and folds to the SB, who limps, and the BB checks
    fn tiny() -> PfSolution {
        let a = |kind: u8, to: f32, child: i32| PfAction { kind, to, child };
        let n = |actor: u8, actions: Vec<PfAction>| PfNode { actor, reach: 1.0, chunk: 0, actions };
        PfSolution {
            nodes: vec![
                n(0, vec![a(0, 0.0, 1)]),                                 // 0 UTG
                n(1, vec![a(0, 0.0, 2)]),                                 // 1 HJ
                n(2, vec![a(0, 0.0, 3)]),                                 // 2 CO
                n(3, vec![a(0, 0.0, 7), a(2, 2.5, 4), a(3, 100.0, -1)]), // 3 BTN
                n(4, vec![a(0, 0.0, 5)]),                                 // 4 SB vs open
                n(5, vec![a(0, 0.0, -1), a(1, 2.5, -1), a(2, 11.0, 6)]), // 5 BB vs open
                n(3, vec![a(0, 0.0, -1), a(1, 11.0, -1)]),               // 6 BTN vs 3-bet
                n(4, vec![a(1, 1.0, 8)]),                                 // 7 SB unopened
                n(5, vec![a(1, 1.0, -1)]),                                // 8 BB after the limp
            ],
            data: vec![],
        }
    }

    #[test]
    fn lines_use_the_web_position_key_format() {
        let s = tiny();
        let b = (0.5, 1.0);
        assert_eq!(line_key(&s, 6, b, "FFFRF", &[1]), ("F-F-F-R2.5-F-C".to_string(), 5));
        assert_eq!(line_key(&s, 6, b, "FFF", &[2, 3]), ("F-F-F-R2.5".to_string(), 3));
        assert_eq!(line_key(&s, 6, b, "FFFRF", &[2, 3]), ("F-F-F-R2.5-F-R11".to_string(), 5));
        assert_eq!(line_key(&s, 6, b, "FFFRFR", &[1]), ("F-F-F-R2.5-F-R11-C".to_string(), 3));
        assert_eq!(line_key(&s, 6, b, "FFF", &[3]), ("F-F-F-A100".to_string(), 3));
        // the big blind's call of a limp is a check
        assert_eq!(line_key(&s, 6, b, "FFFFC", &[1]), ("F-F-F-F-C-X".to_string(), 5));
        assert_eq!(key_amount(13.25), "13.25");
        assert_eq!(key_amount(2.2), "2.2");
    }

    #[test]
    fn pre_names_the_seats_and_the_stack() {
        let seats: Vec<String> = ["UTG", "HJ", "CO", "BTN", "SB", "BB"].iter().map(|x| x.to_string()).collect();
        assert_eq!(
            pre_json(&tiny(), &seats, 100.0, (0.5, 1.0), &SCENARIOS[1]),
            r#"{"stack":100,"oopSeat":"BB","ipSeat":"BTN","oopPath":"F-F-F-R2.5-F-R11","ipPath":"F-F-F-R2.5-F-R11-C"}"#
        );
    }
}
