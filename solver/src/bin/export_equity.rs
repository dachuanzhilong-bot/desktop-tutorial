//! Writes the 169x169 equity table as little-endian u16 (equity * 65535) for the browser's ICM solver.
use tessera_solver::equity;

fn main() {
    let out = std::env::args().nth(1).unwrap_or_else(|| "equity169.bin".into());
    let cache = "cache/equity-60000-20260101.bin";
    let t = equity::load(cache).unwrap_or_else(|| equity::compute_equity(60_000, 20260101, 4));
    let mut bytes = Vec::with_capacity(t.eq.len() * 2);
    for &v in &t.eq {
        bytes.extend_from_slice(&((v.clamp(0.0, 1.0) * 65535.0).round() as u16).to_le_bytes());
    }
    std::fs::write(&out, &bytes).unwrap();
    println!("wrote {} ({} bytes)", out, bytes.len());
}
