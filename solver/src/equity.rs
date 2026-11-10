//! 169 x 169 preflop equity table (all-in, five-card board run-out) estimated by
//! Monte-Carlo, plus exact "card removal" counts.
use crate::cards::*;
use crate::eval::eval7;
use crate::rng::Rng;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

pub struct EquityTables {
    /// eq[a * 169 + b] = equity of class a against class b (ties = 1/2), card removal aware.
    pub eq: Vec<f32>,
    /// n[a * 169 + b] = number of ordered, non-overlapping (combo of a, combo of b) pairs.
    pub n: Vec<f32>,
    pub samples: u32,
}

pub fn disjoint_counts() -> Vec<f32> {
    let mut n = vec![0f32; NUM_CLASSES * NUM_CLASSES];
    for a in 0..NUM_CLASSES {
        for b in 0..NUM_CLASSES {
            n[a * NUM_CLASSES + b] = disjoint_pairs(a, b) as f32;
        }
    }
    n
}

fn pair_equity(a: usize, b: usize, samples: u32, seed: u64) -> f32 {
    if a == b {
        return 0.5;
    }
    let ca = class_combos(a);
    let cb = class_combos(b);
    let mut pairs: Vec<((u8, u8), (u8, u8))> = Vec::new();
    for &x in &ca {
        for &y in &cb {
            if disjoint(x, y) {
                pairs.push((x, y));
            }
        }
    }
    let mut rng = Rng::new(seed ^ ((a as u64) << 20) ^ ((b as u64) << 40) ^ 0xA5A5);
    let mut score = 0f64;
    let mut deck = [0u8; 48];
    for _ in 0..samples {
        let (x, y) = pairs[rng.below(pairs.len() as u32) as usize];
        let mut k = 0;
        for c in 0..52u8 {
            if c != x.0 && c != x.1 && c != y.0 && c != y.1 {
                deck[k] = c;
                k += 1;
            }
        }
        for i in 0..5 {
            let j = i + rng.below(48 - i as u32) as usize;
            deck.swap(i, j);
        }
        let h1 = [x.0, x.1, deck[0], deck[1], deck[2], deck[3], deck[4]];
        let h2 = [y.0, y.1, deck[0], deck[1], deck[2], deck[3], deck[4]];
        let (s1, s2) = (eval7(&h1), eval7(&h2));
        if s1 > s2 {
            score += 1.0;
        } else if s1 == s2 {
            score += 0.5;
        }
    }
    (score / samples as f64) as f32
}

/// Estimate the full equity table. Deterministic for a given `(samples, seed)`
/// regardless of thread count.
pub fn compute_equity(samples: u32, seed: u64, threads: usize) -> EquityTables {
    let mut tasks = Vec::new();
    for a in 0..NUM_CLASSES {
        for b in (a + 1)..NUM_CLASSES {
            tasks.push((a, b));
        }
    }
    let next = AtomicUsize::new(0);
    let out = Mutex::new(vec![0f32; NUM_CLASSES * NUM_CLASSES]);
    std::thread::scope(|s| {
        for _ in 0..threads.max(1) {
            s.spawn(|| {
                let mut local = Vec::new();
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= tasks.len() {
                        break;
                    }
                    let (a, b) = tasks[i];
                    local.push((a, b, pair_equity(a, b, samples, seed)));
                }
                let mut g = out.lock().unwrap();
                for (a, b, e) in local {
                    g[a * NUM_CLASSES + b] = e;
                    g[b * NUM_CLASSES + a] = 1.0 - e;
                }
            });
        }
    });
    let mut eq = out.into_inner().unwrap();
    for a in 0..NUM_CLASSES {
        eq[a * NUM_CLASSES + a] = 0.5;
    }
    EquityTables { eq, n: disjoint_counts(), samples }
}

pub fn save(t: &EquityTables, path: &str) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(8 + t.eq.len() * 8);
    bytes.extend_from_slice(b"EQ16");
    bytes.extend_from_slice(&t.samples.to_le_bytes());
    for v in &t.eq {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    std::fs::write(path, bytes)
}

pub fn load(path: &str) -> Option<EquityTables> {
    let b = std::fs::read(path).ok()?;
    if b.len() != 8 + NUM_CLASSES * NUM_CLASSES * 4 || &b[0..4] != b"EQ16" {
        return None;
    }
    let samples = u32::from_le_bytes([b[4], b[5], b[6], b[7]]);
    let mut eq = Vec::with_capacity(NUM_CLASSES * NUM_CLASSES);
    for i in 0..NUM_CLASSES * NUM_CLASSES {
        let o = 8 + i * 4;
        eq.push(f32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]));
    }
    Some(EquityTables { eq, n: disjoint_counts(), samples })
}

/// Equity of class `a` against a (weighted) range of classes, card-removal aware.
pub fn equity_vs_range(t: &EquityTables, a: usize, range: &[f32]) -> f32 {
    let mut num = 0f64;
    let mut den = 0f64;
    for b in 0..NUM_CLASSES {
        let w = range[b] as f64 * t.n[a * NUM_CLASSES + b] as f64;
        num += w * t.eq[a * NUM_CLASSES + b] as f64;
        den += w;
    }
    if den > 0.0 {
        (num / den) as f32
    } else {
        0.5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cls(name: &str) -> usize {
        (0..NUM_CLASSES).find(|&c| class_name(c) == name).unwrap()
    }

    /// Well known preflop equities (± Monte-Carlo error).
    #[test]
    fn known_matchups() {
        let n = 200_000;
        let e = |a: &str, b: &str| pair_equity(cls(a), cls(b), n, 7);
        assert!((e("AA", "KK") - 0.8195).abs() < 0.006, "AA-KK {}", e("AA", "KK"));
        assert!((e("AKs", "22") - 0.5020).abs() < 0.008, "AKs-22 {}", e("AKs", "22"));
        assert!((e("AKo", "QQ") - 0.4300).abs() < 0.008, "AKo-QQ {}", e("AKo", "QQ"));
        assert!((e("72o", "AA") - 0.1210).abs() < 0.006, "72o-AA {}", e("72o", "AA"));
        assert!((e("JTs", "AKo") - 0.4040).abs() < 0.008, "JTs-AKo {}", e("JTs", "AKo"));
    }

    #[test]
    fn counts() {
        let n = disjoint_counts();
        let aa = cls("AA");
        // 6 combos of AA, each blocks exactly 1 other AA combo
        assert_eq!(n[aa * NUM_CLASSES + aa], 6.0);
        // total over all b for a fixed combo is C(50,2)=1225
        for a in 0..NUM_CLASSES {
            let s: f32 = (0..NUM_CLASSES).map(|b| n[a * NUM_CLASSES + b]).sum();
            assert_eq!(s, class_count(a) as f32 * 1225.0);
        }
    }
}
