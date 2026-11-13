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
            "{{\"id\":\"{}\",\"title\":\"{}\",\"pot\":{},\"stack\":{},\"oop\":\"{}\",\"ip\":\"{}\",\"oopPct\":{:.2},\"ipPct\":{:.2},\"iterations\":{},\"turnCards\":{},\"riverCards\":{},\"pre\":{}}}",
            sc.id, sc.title, sc.pot, sc.stack, sc.oop_seat, sc.ip_seat, stat(&ranges[i][0]), stat(&ranges[i][1]), iters, turn_cards, river_cards, pre_of[i]
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
