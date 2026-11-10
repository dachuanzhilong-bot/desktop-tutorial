//! Heads-up push/fold Nash ranges for a few stack sizes (also used in docs/tests).
use tessera_solver::{cards::*, engine::Solver, equity, games};

fn main() {
    std::fs::create_dir_all("cache").ok();
    let samples = 60_000;
    let cache = format!("cache/equity-{}-{}.bin", samples, 20260101);
    let t = equity::load(&cache).unwrap_or_else(|| {
        let t = equity::compute_equity(samples, 20260101, 4);
        equity::save(&t, &cache).ok();
        t
    });
    println!("stack(bb)  SB jam%  BB call%  exploitability(bb)");
    for stack in [3.0f32, 5.0, 8.0, 10.0, 15.0, 20.0] {
        let g = games::pushfold(stack, &t);
        let mut s = Solver::new(&g);
        for _ in 0..4000 {
            s.iterate();
        }
        s.finalize_avg();
        let gaps = s.br_gaps();
        let (mut jam, mut call, mut w) = (0f64, 0f64, 0f64);
        for h in 0..NUM_CLASSES {
            let n = class_count(h) as f64;
            w += n;
            jam += n * s.avg[0][NUM_CLASSES + h] as f64;
            call += n * s.avg[2][NUM_CLASSES + h] as f64;
        }
        println!("{:8.1}  {:6.1}  {:8.1}  {:.5}", stack, 100.0 * jam / w, 100.0 * call / w, gaps[0] + gaps[1]);
    }
}
