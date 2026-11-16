//! Rake (REFACTOR_PLAN 3-2): the house takes `pct`% of the pot, at most `cap` bb, and nothing from a pot that ends
//! before the flop ("no flop, no drop").
//!
//! * Preflop (`preflop.rs`): the terminals that go to the flop (a flop valued by the equity-realisation model, an
//!   all-in) pay the rake of their pot (every chip put in, the folded players' dead money included); a hand that
//!   ends with everybody folding pays none.
//! * Postflop (`postflop.rs`, `river.rs`, `measure.rs`): every terminal has seen the flop, so every terminal pays
//!   the rake of the pot the winner takes: the pot before the flop plus what both players matched
//!   (`pot + 2 * min(inv0, inv1)`; a bet nobody called goes back to the bettor and is not raked).
//!
//! The rake leaves the game: the players' payouts at a terminal add up to the pot minus the rake.
//! `pct = 0` (the default) is no rake: `amount` is exactly 0.0 and every payoff is computed as before, bit for bit.

/// `cap` of "no cap"
pub const NO_CAP: f32 = f32::INFINITY;

/// The rake of a pot of `pot` bb: `pct`% of it, at most `cap` bb (0 when `pct` is not positive).
pub fn amount(pot: f32, pct: f32, cap: f32) -> f32 {
    if pct > 0.0 {
        (pot * pct / 100.0).min(cap).max(0.0)
    } else {
        0.0
    }
}

/// a number as the solution ids and manifests write it: at most 2 decimals, no trailing zeros ("5", "4.5", "0.25")
fn num(x: f32) -> String {
    format!("{}", (x as f64 * 100.0).round() / 100.0)
}

/// The part of a solution id that names the rake (docs/03): "" without rake (the ids of the solutions made before
/// rake existed keep their meaning), otherwise `-r<pct>` and, with a cap, `c<cap>` (`-r5c3`: 5%, at most 3bb;
/// `-r5`: 5% without cap).
pub fn id_suffix(pct: f32, cap: f32) -> String {
    if pct <= 0.0 {
        String::new()
    } else if cap.is_finite() {
        format!("-r{}c{}", num(pct), num(cap))
    } else {
        format!("-r{}", num(pct))
    }
}

/// The manifest field (docs/03): `None` without rake (the field is left out, as in the manifests made before rake
/// existed), otherwise `{"pct":5,"cap":3}` (`"cap":null` without cap).
pub fn json(pct: f32, cap: f32) -> Option<String> {
    if pct <= 0.0 {
        return None;
    }
    let cap = if cap.is_finite() { num(cap) } else { "null".into() };
    Some(format!("{{\"pct\":{},\"cap\":{}}}", num(pct), cap))
}

/// `--rake-pct P --rake-cap C` of the command-line tools: (pct, cap); no `--rake-cap` = no cap
pub fn from_args(args: &[String]) -> (f32, f32) {
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse::<f32>().ok());
    let pct = get("--rake-pct").unwrap_or(0.0);
    let cap = get("--rake-cap").unwrap_or(NO_CAP);
    assert!((0.0..100.0).contains(&pct), "--rake-pct must be in [0, 100)");
    assert!(cap >= 0.0, "--rake-cap must not be negative");
    (pct, cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amount_is_a_capped_share_of_the_pot() {
        assert_eq!(amount(20.0, 5.0, 3.0), 1.0);
        assert_eq!(amount(100.0, 5.0, 3.0), 3.0);
        assert_eq!(amount(100.0, 5.0, NO_CAP), 5.0);
        // no rake is exactly 0, whatever the cap
        for cap in [0.0, 3.0, NO_CAP] {
            assert_eq!(amount(57.25, 0.0, cap).to_bits(), 0f32.to_bits());
        }
    }

    #[test]
    fn ids_and_manifest_fields() {
        // no rake: the ids and manifests of the solutions made before rake existed
        assert_eq!(id_suffix(0.0, NO_CAP), "");
        assert_eq!(id_suffix(0.0, 3.0), "");
        assert_eq!(json(0.0, 3.0), None);
        assert_eq!(format!("cash6max-100bb{}", id_suffix(5.0, NO_CAP)), "cash6max-100bb-r5");
        assert_eq!(format!("cash6max-100bb{}", id_suffix(5.0, 3.0)), "cash6max-100bb-r5c3");
        assert_eq!(id_suffix(4.5, 0.6), "-r4.5c0.6");
        assert_eq!(json(5.0, 3.0).unwrap(), "{\"pct\":5,\"cap\":3}");
        assert_eq!(json(4.5, NO_CAP).unwrap(), "{\"pct\":4.5,\"cap\":null}");
        let args: Vec<String> = ["x", "--rake-pct", "5", "--rake-cap", "3"].iter().map(|s| s.to_string()).collect();
        assert_eq!(from_args(&args), (5.0, 3.0));
        assert_eq!(from_args(&args[..3]), (5.0, NO_CAP));
        assert_eq!(from_args(&args[..1]), (0.0, NO_CAP));
    }
}
