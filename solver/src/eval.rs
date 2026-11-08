//! Seven card hand evaluator.  Higher return value = stronger hand.
//! Layout: category << 20 | up to five 4-bit tie-break ranks.
use std::sync::OnceLock;

static STRAIGHT: OnceLock<Vec<u8>> = OnceLock::new();

/// table[mask] = (highest straight rank + 1) or 0 for a 13-bit rank mask
fn straight_table() -> &'static [u8] {
    STRAIGHT.get_or_init(|| {
        let mut t = vec![0u8; 8192];
        for mask in 0..8192usize {
            let mut best = 0u8;
            for high in (4..=12usize).rev() {
                let need = 0x1Fusize << (high - 4);
                if mask & need == need {
                    best = high as u8 + 1;
                    break;
                }
            }
            if best == 0 && mask & 0x100F == 0x100F {
                best = 4; // wheel: 5-high => rank index 3, +1
            }
            t[mask] = best;
        }
        t
    })
}

#[inline]
fn top_bit(m: u16) -> u32 {
    15 - m.leading_zeros()
}

pub fn eval7(cards: &[u8; 7]) -> u32 {
    let st = straight_table();
    let mut cnt = [0u8; 13];
    let mut sm = [0u16; 4];
    for &c in cards {
        let r = (c >> 2) as usize;
        cnt[r] += 1;
        sm[(c & 3) as usize] |= 1 << r;
    }
    for s in 0..4 {
        if sm[s].count_ones() >= 5 {
            let m = sm[s];
            let h = st[m as usize];
            if h > 0 {
                return (8 << 20) | (h as u32 - 1);
            }
            let mut v = 0u32;
            let mut mm = m;
            for _ in 0..5 {
                let t = top_bit(mm);
                v = (v << 4) | t;
                mm &= !(1 << t);
            }
            return (5 << 20) | v;
        }
    }
    let rank_mask = sm[0] | sm[1] | sm[2] | sm[3];

    let mut quad = -1i32;
    let mut trips = [-1i32; 2];
    let mut nt = 0;
    let mut pairs = [-1i32; 3];
    let mut np = 0;
    for r in (0..13).rev() {
        match cnt[r] {
            4 => quad = r as i32,
            3 => {
                if nt < 2 {
                    trips[nt] = r as i32;
                    nt += 1;
                }
            }
            2 => {
                if np < 3 {
                    pairs[np] = r as i32;
                    np += 1;
                }
            }
            _ => {}
        }
    }
    if quad >= 0 {
        let rest = rank_mask & !(1 << quad);
        let k = top_bit(rest);
        return (7 << 20) | ((quad as u32) << 4) | k;
    }
    if nt >= 1 && (np >= 1 || nt >= 2) {
        let pair = if nt >= 2 && (np == 0 || trips[1] > pairs[0]) {
            trips[1]
        } else {
            pairs[0]
        };
        return (6 << 20) | ((trips[0] as u32) << 4) | pair as u32;
    }
    let h = st[rank_mask as usize];
    if h > 0 {
        return (4 << 20) | (h as u32 - 1);
    }
    if nt == 1 {
        let mut rest = rank_mask & !(1 << trips[0]);
        let k1 = top_bit(rest);
        rest &= !(1 << k1);
        let k2 = top_bit(rest);
        return (3 << 20) | ((trips[0] as u32) << 8) | (k1 << 4) | k2;
    }
    if np >= 2 {
        let rest = rank_mask & !(1 << pairs[0]) & !(1 << pairs[1]);
        let k = top_bit(rest);
        return (2 << 20) | ((pairs[0] as u32) << 8) | ((pairs[1] as u32) << 4) | k;
    }
    if np == 1 {
        let mut rest = rank_mask & !(1 << pairs[0]);
        let k1 = top_bit(rest);
        rest &= !(1 << k1);
        let k2 = top_bit(rest);
        rest &= !(1 << k2);
        let k3 = top_bit(rest);
        return (1 << 20) | ((pairs[0] as u32) << 12) | (k1 << 8) | (k2 << 4) | k3;
    }
    let mut v = 0u32;
    let mut mm = rank_mask;
    for _ in 0..5 {
        let t = top_bit(mm);
        v = (v << 4) | t;
        mm &= !(1 << t);
    }
    v
}

pub fn category(score: u32) -> u32 {
    score >> 20
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> [u8; 7] {
        let b = s.as_bytes();
        let mut out = [0u8; 7];
        for i in 0..7 {
            let r = b"23456789TJQKA".iter().position(|&x| x == b[i * 2]).unwrap() as u8;
            let su = b"cdhs".iter().position(|&x| x == b[i * 2 + 1]).unwrap() as u8;
            out[i] = r * 4 + su;
        }
        out
    }

    #[test]
    fn categories() {
        assert_eq!(category(eval7(&parse("AsKsQsJsTs2c3d"))), 8); // royal
        assert_eq!(category(eval7(&parse("9s8s7s6s5s2c3d"))), 8);
        assert_eq!(category(eval7(&parse("AsAhAdAc9s2c3d"))), 7);
        assert_eq!(category(eval7(&parse("AsAhAd9c9s2c3d"))), 6);
        assert_eq!(category(eval7(&parse("AsAhAd9c9s9d3d"))), 6); // two trips
        assert_eq!(category(eval7(&parse("As2s5s9sKs2c3d"))), 5);
        assert_eq!(category(eval7(&parse("As2c3d4h5s9c9d"))), 4); // wheel
        assert_eq!(category(eval7(&parse("AsAhAd9c8s2c3d"))), 3);
        assert_eq!(category(eval7(&parse("AsAh9d9c8s2c3d"))), 2);
        assert_eq!(category(eval7(&parse("AsAh9d8c7s2c3d"))), 1);
        assert_eq!(category(eval7(&parse("AsKh9d8c7s2c3d"))), 0);
    }

    #[test]
    fn ordering() {
        let w = eval7(&parse("As2c3d4h5s9c9d")); // wheel
        let s6 = eval7(&parse("6s2c3d4h5s9c9d"));
        assert!(s6 > w);
        // kickers
        let a = eval7(&parse("AsKhQd9c8s2c3d"));
        let b = eval7(&parse("AsKhQd9c7s2c3d"));
        assert!(a > b);
        // three pair picks best two + best kicker
        let tp = eval7(&parse("AsAhKdKcQsQc2d"));
        let tp2 = eval7(&parse("AsAhKdKcQs2c2d"));
        assert_eq!(tp, tp2); // both are AAKK + Q kicker
        // full house: higher pair of two trips
        let fh = eval7(&parse("AsAhAdKcKsKd2c"));
        assert_eq!(category(fh), 6);
        // flush vs flush
        assert!(eval7(&parse("AsKs9s5s2s3c4d")) > eval7(&parse("KsQs9s5s2s3c4d")));
    }

    /// Exact category frequencies over all C(52,7) hands would be 133M evals;
    /// sample instead and compare with the textbook probabilities.
    #[test]
    fn sampled_category_frequencies() {
        let mut rng = crate::rng::Rng::new(42);
        let n = 600_000;
        let mut hist = [0u32; 9];
        let mut deck: Vec<u8> = (0..52).collect();
        for _ in 0..n {
            for i in 0..7 {
                let j = i + rng.below(52 - i as u32) as usize;
                deck.swap(i, j);
            }
            let h = [deck[0], deck[1], deck[2], deck[3], deck[4], deck[5], deck[6]];
            hist[category(eval7(&h)) as usize] += 1;
        }
        let f = |c: usize| hist[c] as f64 / n as f64;
        // textbook 7-card probabilities
        assert!((f(0) - 0.1741).abs() < 0.004, "high {}", f(0));
        assert!((f(1) - 0.4380).abs() < 0.006, "pair {}", f(1));
        assert!((f(2) - 0.2350).abs() < 0.005, "two pair {}", f(2));
        assert!((f(3) - 0.0483).abs() < 0.003, "trips {}", f(3));
        assert!((f(4) - 0.0462).abs() < 0.003, "straight {}", f(4));
        assert!((f(5) - 0.0303).abs() < 0.003, "flush {}", f(5));
        assert!((f(6) - 0.0260).abs() < 0.003, "full house {}", f(6));
        assert!((f(7) - 0.00168).abs() < 0.0006, "quads {}", f(7));
    }
}
