//! The size of a postflop tree for several sets of bet sizes, without solving (REFACTOR_PLAN 3-4: "before the mass production,
//! measure the tree, the memory and the time of one flop").  It builds the tree of one flop of a scenario (every turn and river
//! card, as `gen_postflop --all-cards`), the supports of the acting players, and from them the memory of the regrets and strategy
//! sums (4 bytes x actions x combos of the support, per decision node; `Solver::strategy_bytes`) and the work of one iteration
//! (the same sum: an iteration reads and writes each of those once), and the river tree the device solves (a river start with
//! the same ranges), against the current sizes.
//!
//!   cargo run --release --bin tree_size -- --pre out/pre/cash6max-100bb [--scenario srp-btn-bb] [--flop "As 7d 2c"]
//!       [--river "As 7d 2c Kh 9s"]
//!
//! The memory is that of `gen_postflop --all-cards --g1-target` (the river's strategy sums kept: regret + ssum everywhere).
use tessera_solver::postflop::*;
use tessera_solver::solution_io;

/// a preflop line of one player: the path and the action kinds of the range
type Line = (&'static str, &'static [u8]);

/// (name, bets of flop / turn / river, may a bet be raised: flop / turn / river)
type Variant = (&'static str, [Vec<f32>; 3], [bool; 3]);

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

/// (decision nodes, nodes, the sum over decision nodes of actions x support combos, the same sum by street: flop / turn / river)
fn measure(tree: &Tree, ranges: &[Vec<f32>; 2]) -> (usize, usize, f64, [f64; 3]) {
    let (supports, support_of) = decision_supports(tree, ranges);
    let (mut decisions, mut work, mut by_street) = (0usize, 0f64, [0f64; 3]);
    for (n, &sid) in tree.nodes.iter().zip(&support_of) {
        if let PKind::Decision { children, .. } = &n.kind {
            decisions += 1;
            let w = (children.len() * supports[sid as usize].len()) as f64;
            work += w;
            by_street[(n.street as usize).min(2)] += w;
        }
    }
    (decisions, tree.nodes.len(), work, by_street)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pre = arg(&args, "--pre").expect("--pre <raw preflop solution dir>");
    let scenario = arg(&args, "--scenario").unwrap_or_else(|| "srp-btn-bb".into());
    let flop = arg(&args, "--flop").unwrap_or_else(|| "As 7d 2c".into());
    let river = arg(&args, "--river").unwrap_or_else(|| "As 7d 2c Kh 9s".into());
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
    let flop_cards: Vec<u8> = flop.split_whitespace().map(card).collect();
    let river_cards: Vec<u8> = river.split_whitespace().map(card).collect();
    // (name, bets of flop / turn / river, may a bet be raised: flop / turn / river)
    let variants: Vec<Variant> = vec![
        ("current: flop 33/75, turn 66, river 50/100", [vec![0.33, 0.75], vec![0.66], vec![0.5, 1.0]], [true, false, false]),
        ("plan 3-4: flop 33/75/125, turn 50/100/150, river 33/75/150", [vec![0.33, 0.75, 1.25], vec![0.5, 1.0, 1.5], vec![0.33, 0.75, 1.5]], [true, false, false]),
        ("flop only: flop 33/75/125, turn 66, river 50/100", [vec![0.33, 0.75, 1.25], vec![0.66], vec![0.5, 1.0]], [true, false, false]),
        ("turn and river only: flop 33/75, turn 50/100/150, river 33/75/150", [vec![0.33, 0.75], vec![0.5, 1.0, 1.5], vec![0.33, 0.75, 1.5]], [true, false, false]),
        ("two sizes each: flop 33/75, turn 50/100, river 50/100", [vec![0.33, 0.75], vec![0.5, 1.0], vec![0.5, 1.0]], [true, false, false]),
        ("flop 33/75/125, turn 50/100, river 50/100", [vec![0.33, 0.75, 1.25], vec![0.5, 1.0], vec![0.5, 1.0]], [true, false, false]),
        ("flop 33/75/125, turn 50/100, river 33/75/150", [vec![0.33, 0.75, 1.25], vec![0.5, 1.0], vec![0.33, 0.75, 1.5]], [true, false, false]),
        ("flop 33/75/125, turn 50/100/150, river 50/100", [vec![0.33, 0.75, 1.25], vec![0.5, 1.0, 1.5], vec![0.5, 1.0]], [true, false, false]),
        ("plan 3-4 sizes, raises on every street", [vec![0.33, 0.75, 1.25], vec![0.5, 1.0, 1.5], vec![0.33, 0.75, 1.5]], [true, true, true]),
    ];
    println!("{} {} pot {} stack {}; river start {}", scenario, flop, pot, stack, river);
    println!("{:<70} {:>10} {:>9} {:>9} {:>8} {:>8} {:>10} {:>8} | river tree: {:>6} {:>9}", "bet sizes", "nodes", "decisions", "work (G)", "mem GB", "x now", "river share", "no-avg GB", "nodes", "work x now");
    let mut base: Option<(f64, f64)> = None;
    for (name, bets, raise_sizes) in variants {
        let cfg = Config { pot, stack, bets, raise_sizes, allow_allin: true, turn_cards: 49, river_cards: 48, flop_runouts: 1176, seed: 11, ..Config::default() };
        let t = build_tree(&cfg, &flop_cards);
        let (decisions, nodes, work, by_street) = measure(&t, &ranges);
        drop(t);
        let rt = build_tree(&cfg, &river_cards);
        let (_, rnodes, rwork, _) = measure(&rt, &ranges);
        let mem = work * 8.0 / 1e9; // regret + strategy sum, 4 bytes each
        // without the river's strategy sums (`gen_postflop --all-cards` without --g1-target): regret everywhere, strategy sums on the flop and turn
        let mem_no_river_avg = (work * 4.0 + (by_street[0] + by_street[1]) * 4.0) / 1e9;
        let (w0, rw0) = *base.get_or_insert((work, rwork));
        println!("{:<70} {:>10} {:>9} {:>9.2} {:>8.2} {:>8.2} {:>9.0}% {:>8.2} | {:>20} {:>9.2}", name, nodes, decisions, work / 1e9, mem, work / w0, 100.0 * by_street[2] / work, mem_no_river_avg, rnodes, rwork / rw0);
    }
}
