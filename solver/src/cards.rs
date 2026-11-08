//! Card helpers and the 13x13 hand-class grid.
//!
//! Card index: `rank * 4 + suit`, rank 0 = deuce .. 12 = ace, suit 0..4.
//!
//! Hand-class index = `row * 13 + col` on the usual range chart:
//! row/col 0 = A ... 12 = 2.  Diagonal = pairs, above the diagonal (row < col)
//! = suited, below (row > col) = offsuit.

pub const NUM_CLASSES: usize = 169;
pub const RANK_CHARS: &[u8; 13] = b"23456789TJQKA";
pub const SUIT_CHARS: &[u8; 4] = b"cdhs";

#[inline]
pub fn rank(c: u8) -> usize {
    (c >> 2) as usize
}
#[inline]
pub fn suit(c: u8) -> usize {
    (c & 3) as usize
}

pub fn card_name(c: u8) -> String {
    format!("{}{}", RANK_CHARS[rank(c)] as char, SUIT_CHARS[suit(c)] as char)
}

/// class index of two hole cards
pub fn class_of(c1: u8, c2: u8) -> usize {
    let (r1, r2) = (rank(c1), rank(c2));
    let (hi, lo) = if r1 >= r2 { (r1, r2) } else { (r2, r1) };
    if hi == lo {
        (12 - hi) * 13 + (12 - hi)
    } else if suit(c1) == suit(c2) {
        (12 - hi) * 13 + (12 - lo)
    } else {
        (12 - lo) * 13 + (12 - hi)
    }
}

/// (high rank, low rank, suited, pair) for a class
pub fn class_info(cls: usize) -> (usize, usize, bool, bool) {
    let (i, j) = (cls / 13, cls % 13);
    if i == j {
        (12 - i, 12 - i, false, true)
    } else if i < j {
        (12 - i, 12 - j, true, false)
    } else {
        (12 - j, 12 - i, false, false)
    }
}

pub fn class_name(cls: usize) -> String {
    let (hi, lo, suited, pair) = class_info(cls);
    let mut s = String::new();
    s.push(RANK_CHARS[hi] as char);
    s.push(RANK_CHARS[lo] as char);
    if !pair {
        s.push(if suited { 's' } else { 'o' });
    }
    s
}

pub fn class_count(cls: usize) -> usize {
    let (_, _, suited, pair) = class_info(cls);
    if pair {
        6
    } else if suited {
        4
    } else {
        12
    }
}

/// All concrete two-card combos of a class.
pub fn class_combos(cls: usize) -> Vec<(u8, u8)> {
    let (hi, lo, suited, pair) = class_info(cls);
    let mut v = Vec::new();
    if pair {
        for s1 in 0..4u8 {
            for s2 in (s1 + 1)..4 {
                v.push(((hi * 4) as u8 + s1, (hi * 4) as u8 + s2));
            }
        }
    } else if suited {
        for s in 0..4u8 {
            v.push(((hi * 4) as u8 + s, (lo * 4) as u8 + s));
        }
    } else {
        for s1 in 0..4u8 {
            for s2 in 0..4u8 {
                if s1 != s2 {
                    v.push(((hi * 4) as u8 + s1, (lo * 4) as u8 + s2));
                }
            }
        }
    }
    v
}

#[inline]
pub fn disjoint(a: (u8, u8), b: (u8, u8)) -> bool {
    a.0 != b.0 && a.0 != b.1 && a.1 != b.0 && a.1 != b.1
}

/// number of ordered (combo of a, combo of b) pairs that do not share a card
pub fn disjoint_pairs(a: usize, b: usize) -> usize {
    let ca = class_combos(a);
    let cb = class_combos(b);
    let mut n = 0;
    for &x in &ca {
        for &y in &cb {
            if disjoint(x, y) {
                n += 1;
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_roundtrip_counts() {
        let total: usize = (0..NUM_CLASSES).map(class_count).sum();
        assert_eq!(total, 1326);
        let mut seen = vec![0usize; NUM_CLASSES];
        for c1 in 0..52u8 {
            for c2 in (c1 + 1)..52 {
                seen[class_of(c1, c2)] += 1;
            }
        }
        for cls in 0..NUM_CLASSES {
            assert_eq!(seen[cls], class_count(cls), "{}", class_name(cls));
            assert_eq!(class_combos(cls).len(), class_count(cls));
        }
    }

    #[test]
    fn grid_layout() {
        // AA top-left, AKs top row, AKo first column, 22 bottom-right
        assert_eq!(class_name(0), "AA");
        assert_eq!(class_name(1), "AKs");
        assert_eq!(class_name(13), "AKo");
        assert_eq!(class_name(168), "22");
    }
}
