//! REFACTOR_PLAN 3-1: the equity realisation of solved flops.
//!
//! The preflop model (`preflop.rs`, docs/07 §2) values a hand that sees the flop as `pot * share - invested`, with
//! `share = e R_ip / (e R_ip + (1 - e) R_oop)` and a hand-made realisation `R(hand class, role, SPR)`.  The flops solved
//! by `gen_postflop` (`TSP1`, docs/03) hold what those `R` stand for: per hand, the raw equity against the opponent's range
//! (`eq`) and the value of the equilibrium play (`best - sum freq * loss`).  The solver's payoffs are "share of the
//! final pot minus chips put in postflop", so the initial pot belongs to nobody and `v_oop + v_ip = pot` at every
//! terminal: `s = v / pot` is the share of the flop's initial pot a hand really gets.
//!
//! `flop_values` turns one flop file into `(w, e, s)` per hand and role; `ClassAcc` averages them over flops by
//! hand class.  OOP's values are at the root.  IP does not act at the root, so its value is composed from the IP nodes after
//! each of OOP's actions: `v_ip(h) = sum_a P(a | h) v_ip(h | a)`, `P(a | h)` the probability that OOP, holding a hand that
//! does not share a card with `h`, takes `a`.  The same weights compose the equity (law of total expectation).
use crate::cards::{class_count, class_of};
use crate::measure::{FileNode, Tsp1};
use crate::postflop::{ct, decode_loss, NC};

/// One role's hands at the flop root: range weight `w` (0 = not in the range), raw equity `e` against the other
/// range and the share `s` of the initial pot the equilibrium play realises.  1326 wide.
#[derive(Clone)]
pub struct RoleHands {
    pub w: Vec<f32>,
    pub e: Vec<f32>,
    pub s: Vec<f32>,
}

impl RoleHands {
    fn empty() -> RoleHands {
        RoleHands { w: vec![0.0; NC], e: vec![0.0; NC], s: vec![0.0; NC] }
    }
}

/// What one flop file says about the equity realisation: `hands[0]` OOP, `hands[1]` IP.
pub struct FlopValues {
    pub pot: f32,
    pub board: Vec<u8>,
    pub hands: [RoleHands; 2],
    /// the check of the zero-sum identity: `(E[v_oop] + E[v_ip] - pot) / pot` over the pairs of hands that do not share
    /// a card (range weights); 0 for exact values (the file's quantization and pruned lines make it small, not 0)
    pub zero_sum_gap: f32,
    /// the same for the raw equity: `E[e_oop] + E[e_ip] - 1`
    pub equity_gap: f32,
    /// the share of OOP's root actions whose IP node is not in the file (rare lines): IP's value ignores them
    pub pruned_mass: f32,
}

/// `out[h]` = the sum of `x[o]` over the hands `o` that share no card with `h` (hand `h` itself shares both).
pub fn compat_mass(x: &[f32]) -> Vec<f32> {
    let t = ct();
    let total: f64 = x.iter().map(|&v| v as f64).sum();
    let mut by_card = [0f64; 52];
    for (h, &v) in x.iter().enumerate() {
        let (a, b) = t.cards[h];
        by_card[a as usize] += v as f64;
        by_card[b as usize] += v as f64;
    }
    (0..NC)
        .map(|h| {
            let (a, b) = t.cards[h];
            (total - by_card[a as usize] - by_card[b as usize] + x[h] as f64) as f32
        })
        .collect()
}

/// the average strategy's EV (bb) of hand `j` (index into the node's bitmap) at a decision node
fn avg_ev(n: &FileNode, j: usize) -> f32 {
    let k = n.hands.len();
    let na = n.edges.len();
    let tot: f32 = (0..na).map(|a| n.freq[a * k + j] as f32).sum();
    let best = n.best[j] as f32 / 64.0;
    if tot <= 0.0 {
        return best;
    }
    let loss: f32 = (0..na).map(|a| n.freq[a * k + j] as f32 / tot * decode_loss(n.loss[a * k + j])).sum();
    best - loss
}

/// frequency (0..1) of action `a` for hand `j`
fn freq_of(n: &FileNode, a: usize, j: usize) -> f32 {
    let k = n.hands.len();
    let tot: f32 = (0..n.edges.len()).map(|b| n.freq[b * k + j] as f32).sum();
    if tot <= 0.0 {
        0.0
    } else {
        n.freq[a * k + j] as f32 / tot
    }
}

/// The realised values of one flop file (v2 or v3; only the flop's root and its children are read).
pub fn flop_values(f: &Tsp1) -> Result<FlopValues, String> {
    let root = f.nodes.first().ok_or("empty file")?;
    if root.kind != 0 || root.actor != 0 || root.street != 0 {
        return Err("the first node is not OOP's decision on the flop".into());
    }
    let pot = f.pot;
    if pot <= 0.0 {
        return Err("no pot".into());
    }
    let mut oop = RoleHands::empty();
    let mut v0 = vec![0f32; NC];
    for (j, &h) in root.hands.iter().enumerate() {
        let h = h as usize;
        oop.w[h] = root.weight[j] as f32 / 255.0;
        oop.e[h] = root.eq[j] as f32 / 255.0;
        v0[h] = avg_ev(root, j);
        oop.s[h] = v0[h] / pot;
    }
    // OOP's action mass M_a(h) for every IP hand h: the weight of OOP hands that take a and do not share a card with h
    let mut kids: Vec<(usize, &FileNode)> = Vec::new(); // (root action index, IP node)
    let mut pruned = 0f32;
    let total_w: f32 = oop.w.iter().sum();
    for (a, e) in root.edges.iter().enumerate() {
        let mass: f32 = root.hands.iter().enumerate().map(|(j, &h)| oop.w[h as usize] * freq_of(root, a, j)).sum();
        if e.code >= 0 && (e.code as usize) < f.nodes.len() {
            let c = &f.nodes[e.code as usize];
            if c.kind == 0 && c.actor == 1 {
                kids.push((a, c));
                continue;
            }
        }
        if e.code == -2 && total_w > 0.0 {
            pruned += mass / total_w;
        } else if e.code != -1 && total_w > 0.0 {
            // a terminal after OOP's own action (it cannot fold at the root): ignore it, count it as pruned
            pruned += mass / total_w;
        }
    }
    if kids.is_empty() {
        return Err("OOP's root has no IP node under it".into());
    }
    let mut masses: Vec<Vec<f32>> = Vec::with_capacity(kids.len());
    for &(a, _) in &kids {
        let mut x = vec![0f32; NC];
        for (j, &h) in root.hands.iter().enumerate() {
            x[h as usize] = oop.w[h as usize] * freq_of(root, a, j);
        }
        masses.push(compat_mass(&x));
    }
    let mut ip = RoleHands::empty();
    let mut v1 = vec![0f32; NC];
    // IP has not acted before its first node: its range weight is the same in every child
    let first = kids[0].1;
    for &h in &first.hands {
        ip.w[h as usize] = 0.0;
    }
    for (j, &h) in first.hands.iter().enumerate() {
        ip.w[h as usize] = first.weight[j] as f32 / 255.0;
    }
    for h in 0..NC {
        if ip.w[h] <= 0.0 {
            continue;
        }
        let tot: f32 = masses.iter().map(|m| m[h]).sum();
        if tot <= 0.0 {
            ip.w[h] = 0.0;
            continue;
        }
        let (mut v, mut e) = (0f32, 0f32);
        for (ki, &(_, c)) in kids.iter().enumerate() {
            let p = masses[ki][h] / tot;
            if p <= 0.0 {
                continue;
            }
            let Some(j) = c.hands.iter().position(|&x| x as usize == h) else { continue };
            v += p * avg_ev(c, j);
            e += p * c.eq[j] as f32 / 255.0;
        }
        v1[h] = v;
        ip.e[h] = e;
        ip.s[h] = v / pot;
    }
    // the identities on the pairs of hands that share no card
    let m_ip = compat_mass(&ip.w); // for an OOP hand: the IP weight it can meet
    let m_oop = compat_mass(&oop.w);
    let (mut pairs, mut sv, mut se) = (0f64, 0f64, 0f64);
    for h in 0..NC {
        let w0 = (oop.w[h] * m_ip[h]) as f64;
        let w1 = (ip.w[h] * m_oop[h]) as f64;
        pairs += w0;
        sv += w0 * v0[h] as f64 + w1 * v1[h] as f64;
        se += w0 * oop.e[h] as f64 + w1 * ip.e[h] as f64;
    }
    let (zero_sum_gap, equity_gap) = if pairs > 0.0 { (((sv / pairs) as f32 - pot) / pot, (se / pairs) as f32 - 1.0) } else { (f32::NAN, f32::NAN) };
    Ok(FlopValues { pot, board: f.board.clone(), hands: [oop, ip], zero_sum_gap, equity_gap, pruned_mass: pruned })
}

/// Per hand class and role, sums over flops of `W`, `W s` and `W e`, `W` = the hand's range weight times the weight of the
/// opponent hands it can meet (the probability that this hand is in a matchup).
#[derive(Clone)]
pub struct ClassAcc {
    pub w: [Vec<f64>; 2],
    pub ws: [Vec<f64>; 2],
    pub we: [Vec<f64>; 2],
    /// the sum of the combos' range weights (before the matchup factor)
    pub rw: [Vec<f64>; 2],
    pub flops: usize,
}

impl Default for ClassAcc {
    fn default() -> Self {
        ClassAcc::new()
    }
}

impl ClassAcc {
    pub fn new() -> ClassAcc {
        let z = || vec![0f64; 169];
        ClassAcc { w: [z(), z()], ws: [z(), z()], we: [z(), z()], rw: [z(), z()], flops: 0 }
    }

    pub fn add(&mut self, f: &FlopValues) {
        let t = ct();
        let other = [compat_mass(&f.hands[1].w), compat_mass(&f.hands[0].w)];
        for r in 0..2 {
            let hs = &f.hands[r];
            for h in 0..NC {
                if hs.w[h] <= 0.0 {
                    continue;
                }
                let (a, b) = t.cards[h];
                let c = class_of(a, b);
                let w = (hs.w[h] * other[r][h]) as f64;
                self.w[r][c] += w;
                self.rw[r][c] += hs.w[h] as f64;
                self.ws[r][c] += w * hs.s[h] as f64;
                self.we[r][c] += w * hs.e[h] as f64;
            }
        }
        self.flops += 1;
    }

    /// `(share, equity)` per class and role: the averages over the flops added; 0 weight = the class never was in the range
    pub fn means(&self, r: usize, c: usize) -> Option<(f64, f64, f64)> {
        let w = self.w[r][c];
        if w <= 0.0 {
            None
        } else {
            Some((w, self.ws[r][c] / w, self.we[r][c] / w))
        }
    }
}

// ------------------------------------------------------------------ the table the preflop model reads

/// Who the pot's aggressor is, for the hand classes of one role in a pot: the player who raised last before the flop
/// (`Aggressor`) or one who only called (`Caller`).  A pot of limps has no aggressor (everybody is a caller).  `Mixed` is
/// the average of both, for the three-way pots (one table for the three pairs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Aggr {
    Caller = 0,
    Aggressor = 1,
    Mixed = 2,
}

/// The realisation of the equity by hand class, role and aggressor: `R = 1 + k(SPR) m`, `m` here.  `m[role][aggr][class]`,
/// `role` 0 = out of position, 1 = in position; `aggr` 0 = caller, 1 = aggressor.  Made by `gen_eqr` from solved flops
/// (REFACTOR_PLAN 3-1, docs/07 §2).
#[derive(Clone, Debug)]
pub struct EqrTable {
    pub m: [[Vec<f32>; 2]; 2],
    /// where the numbers come from (the comment lines of the file)
    pub note: String,
}

impl EqrTable {
    pub fn get(&self, class: usize, ip: bool, aggr: Aggr) -> f32 {
        let a = &self.m[ip as usize];
        match aggr {
            Aggr::Caller => a[0][class],
            Aggr::Aggressor => a[1][class],
            Aggr::Mixed => 0.5 * (a[0][class] + a[1][class]),
        }
    }

    /// Text form: `# ...` comment lines, then one `role<TAB>aggr<TAB>class<TAB>m` line per entry (role OOP / IP, aggr caller /
    /// aggressor, class 0..168).
    pub fn to_text(&self) -> String {
        let mut s = String::new();
        for l in self.note.lines() {
            s.push_str("# ");
            s.push_str(l);
            s.push('\n');
        }
        s.push_str("role\taggr\tclass\tm\n");
        for (r, rn) in ["OOP", "IP"].iter().enumerate() {
            for (a, an) in ["caller", "aggressor"].iter().enumerate() {
                for c in 0..169 {
                    s.push_str(&format!("{}\t{}\t{}\t{:.5}\n", rn, an, c, self.m[r][a][c]));
                }
            }
        }
        s
    }

    pub fn from_text(text: &str) -> Result<EqrTable, String> {
        let mut m: [[Vec<f32>; 2]; 2] = [[vec![f32::NAN; 169], vec![f32::NAN; 169]], [vec![f32::NAN; 169], vec![f32::NAN; 169]]];
        let mut note = String::new();
        for line in text.lines() {
            if let Some(c) = line.strip_prefix('#') {
                note.push_str(c.trim_start());
                note.push('\n');
                continue;
            }
            if line.trim().is_empty() || line.starts_with("role") {
                continue;
            }
            let f: Vec<&str> = line.split('\t').collect();
            if f.len() != 4 {
                return Err(format!("bad line: {}", line));
            }
            let r = match f[0] {
                "OOP" => 0,
                "IP" => 1,
                x => return Err(format!("bad role {}", x)),
            };
            let a = match f[1] {
                "caller" => 0,
                "aggressor" => 1,
                x => return Err(format!("bad aggressor {}", x)),
            };
            let c: usize = f[2].parse().map_err(|_| format!("bad class {}", f[2]))?;
            let v: f32 = f[3].parse().map_err(|_| format!("bad value {}", f[3]))?;
            if c >= 169 || !v.is_finite() {
                return Err(format!("bad entry: {}", line));
            }
            m[r][a][c] = v;
        }
        if m.iter().flatten().any(|v| v.iter().any(|x| x.is_nan())) {
            return Err("the table is incomplete (every role, aggressor and class needs a value)".into());
        }
        Ok(EqrTable { m, note: note.trim_end().to_string() })
    }
}

/// The equity of every hand class against a random hand (the table's `eq` weighted by the card-removal counts `n`).
pub fn class_strength(eq: &[f32], n: &[f32]) -> Vec<f64> {
    (0..169)
        .map(|a| {
            let (mut s, mut z) = (0f64, 0f64);
            for c in 0..169 {
                s += n[a * 169 + c] as f64 * eq[a * 169 + c] as f64;
                z += n[a * 169 + c] as f64;
            }
            if z > 0.0 {
                s / z
            } else {
                0.5
            }
        })
        .collect()
}

/// What the fit of one scenario gives: the calibrated factors per role (0 OOP, 1 IP) and class, where the class was in the
/// data (`present`), its weight, the scenario's `k(SPR)` and whether IP is the pot's aggressor (otherwise OOP is).
pub struct ScenarioFit {
    pub name: String,
    pub k: f32,
    pub ip_aggr: bool,
    pub w: [Vec<f64>; 2],
    pub r: [Vec<f32>; 2],
    pub present: [Vec<bool>; 2],
}

/// Bounds of `m` (`R = 1 + k m` is 0.3 .. 2.5 at k = 1).
pub const M_MIN: f32 = -0.7;
pub const M_MAX: f32 = 1.5;

/// The table from the fits of several scenarios: for each role and aggressor, the weighted mean of `m = (R - 1) / k` of the
/// scenarios in which that role is (or is not) the aggressor.  A class the data hold thinly is pulled to its neighbours (`shrink`
/// times the mean class weight is half way), a class the data do not hold at all takes them: the neighbours are the observed
/// classes of the same kind (pair / suited / offsuit) whose strength (`class_strength`) is closest, so no value is ever
/// extrapolated beyond what was observed.
pub fn build_table(fits: &[ScenarioFit], strength: &[f64], shrink: f64, note: String) -> Result<EqrTable, String> {
    let mut m: [[Vec<f32>; 2]; 2] = [[vec![0.0; 169], vec![0.0; 169]], [vec![0.0; 169], vec![0.0; 169]]];
    for role in 0..2usize {
        for aggr in 0..2usize {
            let group: Vec<&ScenarioFit> = fits.iter().filter(|f| ((role == 1) == f.ip_aggr) == (aggr == 1)).collect();
            if group.is_empty() {
                let who = if role == 1 { "IP" } else { "OOP" };
                return Err(format!("no scenario in which {} is {}", who, if aggr == 1 { "the aggressor" } else { "a caller" }));
            }
            let mut wsum = vec![0f64; 169];
            let mut msum = vec![0f64; 169];
            for f in &group {
                for c in 0..169 {
                    if f.present[role][c] && f.w[role][c] > 0.0 && f.k > 1e-6 {
                        wsum[c] += f.w[role][c];
                        msum[c] += f.w[role][c] * ((f.r[role][c] - 1.0) / f.k) as f64;
                    }
                }
            }
            let obs: Vec<Option<f64>> = (0..169).map(|c| if wsum[c] > 0.0 { Some(msum[c] / wsum[c]) } else { None }).collect();
            if obs.iter().all(|o| o.is_none()) {
                return Err("a role and aggressor with no observed class".into());
            }
            let present_w: Vec<f64> = wsum.iter().copied().filter(|&w| w > 0.0).collect();
            let w0 = shrink * present_w.iter().sum::<f64>() / present_w.len().max(1) as f64;
            // the weighted mean of the (up to) 4 nearest observed classes of the same kind, then of the same pair-ness, then any
            let near = |c: usize| -> f64 {
                let (_, _, suited, pair) = crate::cards::class_info(c);
                let pick = |same_suit: bool| -> Vec<(f64, usize)> {
                    let mut v: Vec<(f64, usize)> = (0..169)
                        .filter(|&d| d != c && obs[d].is_some())
                        .filter(|&d| {
                            let (_, _, s2, p2) = crate::cards::class_info(d);
                            p2 == pair && (!same_suit || s2 == suited)
                        })
                        .map(|d| ((strength[d] - strength[c]).abs(), d))
                        .collect();
                    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                    v
                };
                let mut v = pick(true);
                if v.len() < 3 {
                    v = pick(false);
                }
                if v.len() < 3 {
                    v = (0..169).filter(|&d| d != c && obs[d].is_some()).map(|d| ((strength[d] - strength[c]).abs(), d)).collect();
                    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                }
                let top = &v[..v.len().min(4)];
                let (num, den) = top.iter().fold((0f64, 0f64), |(n, d), &(_, k)| (n + wsum[k] * obs[k].unwrap(), d + wsum[k]));
                if den > 0.0 {
                    num / den
                } else {
                    0.0
                }
            };
            for c in 0..169 {
                let v = match obs[c] {
                    Some(v) => (wsum[c] * v + w0 * near(c)) / (wsum[c] + w0),
                    None => near(c),
                };
                // a realisation of 0.3 .. 2.5 at k = 1 is what a hand can plausibly have
                m[role][aggr][c] = (v as f32).clamp(M_MIN, M_MAX);
            }
        }
    }
    Ok(EqrTable { m, note })
}

// ------------------------------------------------------------------ fitting the preflop model

/// The matchup probabilities of the two ranges over hand classes: `pm[a * 169 + c]`, `a` IP's class, `c` OOP's, proportional
/// to `mass_ip[a] * mass_oop[c] * (the share of the combo pairs of a and c that share no card)`, summing to 1.
/// `n[a * 169 + c]` = the number of such pairs (`EquityTables::n`).
pub fn matchups(mass_ip: &[f64], mass_oop: &[f64], n: &[f32]) -> Vec<f64> {
    let mut pm = vec![0f64; 169 * 169];
    let mut z = 0f64;
    for a in 0..169 {
        for c in 0..169 {
            let denom = (class_count(a) * class_count(c)) as f64;
            let v = mass_ip[a] * mass_oop[c] * n[a * 169 + c] as f64 / denom;
            pm[a * 169 + c] = v;
            z += v;
        }
    }
    if z > 0.0 {
        for v in &mut pm {
            *v /= z;
        }
    }
    pm
}

/// The preflop model's share for IP class `a` against OOP class `c`: `e R_a / (e R_a + (1 - e) R_c)` (preflop.rs)
#[inline]
pub fn pair_share(e: f32, r_ip: f32, r_oop: f32) -> f32 {
    let (x, y) = (e * r_ip, (1.0 - e) * r_oop);
    if x + y > 1e-9 {
        x / (x + y)
    } else {
        0.5
    }
}

/// The mean share the model gives each class: IP classes (against OOP's range), OOP classes (against IP's range), by `pm`.
/// `e[a * 169 + c]` is the raw equity of IP's class a against OOP's class c.
pub fn model_shares(pm: &[f64], e: &[f32], r_ip: &[f32], r_oop: &[f32]) -> ([Vec<f64>; 2], [Vec<f64>; 2]) {
    let (mut sip, mut zip, mut soop, mut zoop) = (vec![0f64; 169], vec![0f64; 169], vec![0f64; 169], vec![0f64; 169]);
    for a in 0..169 {
        for c in 0..169 {
            let w = pm[a * 169 + c];
            if w <= 0.0 {
                continue;
            }
            let s = pair_share(e[a * 169 + c], r_ip[a], r_oop[c]) as f64;
            sip[a] += w * s;
            zip[a] += w;
            soop[c] += w * (1.0 - s);
            zoop[c] += w;
        }
    }
    let norm = |s: &mut Vec<f64>, z: &Vec<f64>| {
        for i in 0..169 {
            s[i] = if z[i] > 0.0 { s[i] / z[i] } else { 0.0 };
        }
    };
    norm(&mut sip, &zip);
    norm(&mut soop, &zoop);
    ([sip, zip], [soop, zoop])
}

/// The model's share `e R_a / (e R_a + (1 - e) R_c)` does not change when both factors are multiplied by the same number, so the
/// calibration leaves the level free.  This fixes it where the measured ratios `s / e` are: the mean of the denominator
/// `e R_a + (1 - e) R_c` over the matchups is 1 (the zero-sum identity of the data: `e rho_ip + (1 - e) rho_oop = 1`).
/// Without it the tables of different scenarios would sit at arbitrary levels and could not be combined (a limped pot uses
/// IP's caller table against OOP's caller table, which come from different scenarios).
pub fn anchor(pm: &[f64], e: &[f32], r_ip: &mut [f32], r_oop: &mut [f32]) -> f32 {
    let (mut d, mut z) = (0f64, 0f64);
    for a in 0..169 {
        for c in 0..169 {
            let w = pm[a * 169 + c];
            if w > 0.0 {
                d += w * (e[a * 169 + c] * r_ip[a] + (1.0 - e[a * 169 + c]) * r_oop[c]) as f64;
                z += w;
            }
        }
    }
    let f = if z > 0.0 && d > 0.0 { (d / z) as f32 } else { 1.0 };
    for v in r_ip.iter_mut().chain(r_oop.iter_mut()) {
        *v /= f;
    }
    f
}

/// Realisation factors for which the model's class shares are those measured (`target_*`: the mean share of the class in the
/// data, `None` where the class is not in the range): Gauss-Seidel sweeps of bisections, one class at a time, within
/// `[lo, hi]`.  A class whose target the model cannot reach (the model's share is at most 1; a strong hand's measured share
/// of the initial pot is more) ends at the bound.  Returns `(r_ip, r_oop)`; classes without a target keep `start`.
#[allow(clippy::too_many_arguments)]
pub fn calibrate(pm: &[f64], e: &[f32], target_ip: &[Option<f64>], target_oop: &[Option<f64>], start_ip: &[f32], start_oop: &[f32], lo: f32, hi: f32, sweeps: usize) -> (Vec<f32>, Vec<f32>) {
    let mut r_ip = start_ip.to_vec();
    let mut r_oop = start_oop.to_vec();
    for _ in 0..sweeps {
        for a in 0..169 {
            let Some(t) = target_ip[a] else { continue };
            let (mut l, mut h) = (lo, hi);
            for _ in 0..30 {
                let m = 0.5 * (l + h);
                let (mut s, mut z) = (0f64, 0f64);
                for c in 0..169 {
                    let w = pm[a * 169 + c];
                    if w > 0.0 {
                        s += w * pair_share(e[a * 169 + c], m, r_oop[c]) as f64;
                        z += w;
                    }
                }
                if z <= 0.0 {
                    break;
                }
                if s / z < t {
                    l = m;
                } else {
                    h = m;
                }
            }
            r_ip[a] = 0.5 * (l + h);
        }
        for c in 0..169 {
            let Some(t) = target_oop[c] else { continue };
            let (mut l, mut h) = (lo, hi);
            for _ in 0..30 {
                let m = 0.5 * (l + h);
                let (mut s, mut z) = (0f64, 0f64);
                for a in 0..169 {
                    let w = pm[a * 169 + c];
                    if w > 0.0 {
                        s += w * (1.0 - pair_share(e[a * 169 + c], r_ip[a], m)) as f64;
                        z += w;
                    }
                }
                if z <= 0.0 {
                    break;
                }
                if s / z < t {
                    l = m;
                } else {
                    h = m;
                }
            }
            r_oop[c] = 0.5 * (l + h);
        }
        // the shares do not change with the level: keep it where the data are, so that the bounds mean what they say
        anchor(pm, e, &mut r_ip, &mut r_oop);
    }
    (r_ip, r_oop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measure::parse_tsp1;

    /// the small `TSP1` v3 file of the web's e2e tests (As7d2c, a few turn cards, no bet on the flop): its flop and
    /// turn nodes are those of a v2 file
    fn fixture() -> Tsp1 {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../web/src/lib/__tests__/fixtures/tsp1-v3-e2e.bin");
        parse_tsp1(&std::fs::read(path).expect("fixture")).expect("parse")
    }

    #[test]
    fn compat_mass_is_the_mass_of_the_hands_that_share_no_card() {
        let t = ct();
        let x: Vec<f32> = (0..NC).map(|h| ((h * 37 + 11) % 17) as f32 / 17.0).collect();
        let got = compat_mass(&x);
        for &h in &[0usize, 1, 51, 200, 777, 1325] {
            let (a, b) = t.cards[h];
            let want: f32 = (0..NC)
                .filter(|&o| {
                    let (c, d) = t.cards[o];
                    c != a && c != b && d != a && d != b
                })
                .map(|o| x[o])
                .sum();
            assert!((got[h] - want).abs() < 1e-3, "hand {}: {} vs {}", h, got[h], want);
        }
    }

    /// the values of a solved flop obey the identities the model needs: the two roles' values add up to the pot, the two
    /// equities to 1 (up to the file's quantization and the solution's own error)
    #[test]
    fn the_values_of_a_solved_flop_are_zero_sum() {
        let f = fixture();
        let v = flop_values(&f).expect("values");
        assert_eq!(v.pot, f.pot);
        assert!(v.zero_sum_gap.abs() < 0.03, "zero-sum gap {}", v.zero_sum_gap);
        assert!(v.equity_gap.abs() < 0.02, "equity gap {}", v.equity_gap);
        for r in 0..2 {
            let hs = &v.hands[r];
            let n = hs.w.iter().filter(|&&w| w > 0.0).count();
            assert!(n > 100, "role {} has {} hands", r, n);
            for h in 0..NC {
                if hs.w[h] > 0.0 {
                    assert!((0.0..=1.0).contains(&hs.e[h]), "equity {}", hs.e[h]);
                    // a strong hand wins chips the others put in after the flop: its share of the *initial* pot passes 1
                    assert!(hs.s[h] > -0.5 && hs.s[h] < 10.0, "share {}", hs.s[h]);
                }
            }
        }
    }

    #[test]
    fn class_means_are_weighted_by_the_matchups() {
        let f = fixture();
        let v = flop_values(&f).expect("values");
        let mut acc = ClassAcc::new();
        acc.add(&v);
        assert_eq!(acc.flops, 1);
        // the equity of the whole OOP range against the IP range plus IP's against OOP's is 1 (zero-sum), and the shares add up to 1
        let (mut e, mut s) = (0f64, 0f64);
        for r in 0..2 {
            let tw: f64 = acc.w[r].iter().sum();
            e += acc.we[r].iter().sum::<f64>() / tw;
            s += acc.ws[r].iter().sum::<f64>() / tw;
        }
        assert!((e - 1.0).abs() < 0.02, "equities add up to {}", e);
        assert!((s - 1.0).abs() < 0.03, "shares add up to {}", s);
        // AA is in OOP's and IP's range on this flop and realises at least its equity ... as a sanity bound only
        let aa = class_of(51, 50); // two aces of different suits (card = rank * 4 + suit)
        assert!(acc.means(0, aa).is_some() || acc.means(1, aa).is_some());
    }

    #[test]
    fn the_table_text_round_trips() {
        let mut t = EqrTable { m: [[vec![0.0; 169], vec![0.0; 169]], [vec![0.0; 169], vec![0.0; 169]]], note: "a note\nsecond line".into() };
        for r in 0..2 {
            for a in 0..2 {
                for c in 0..169 {
                    t.m[r][a][c] = ((r * 7 + a * 3 + c) % 23) as f32 / 10.0 - 1.0;
                }
            }
        }
        let back = EqrTable::from_text(&t.to_text()).expect("parse");
        assert_eq!(back.note, t.note);
        for r in 0..2 {
            for a in 0..2 {
                for c in 0..169 {
                    assert!((back.m[r][a][c] - t.m[r][a][c]).abs() < 1e-4);
                }
            }
        }
        assert!(EqrTable::from_text("role\taggr\tclass\tm\nOOP\tcaller\t0\t0.5\n").is_err(), "an incomplete table is refused");
        assert_eq!(t.get(5, true, Aggr::Mixed), 0.5 * (t.m[1][0][5] + t.m[1][1][5]));
    }

    #[test]
    fn calibration_reproduces_the_shares_it_is_given() {
        // two ranges of 169 classes against each other with a made-up equity matrix; the shares come from known factors
        let mut e = vec![0.5f32; 169 * 169];
        for a in 0..169 {
            for c in 0..169 {
                e[a * 169 + c] = 0.5 + 0.4 * ((a as f32 - c as f32) / 168.0);
            }
        }
        let n = vec![16.0f32; 169 * 169];
        let mass = vec![1.0f64; 169];
        let pm = matchups(&mass, &mass, &n);
        let r_ip: Vec<f32> = (0..169).map(|c| 0.8 + 0.5 * (c % 13) as f32 / 12.0).collect();
        let r_oop: Vec<f32> = (0..169).map(|c| 1.3 - 0.4 * (c % 7) as f32 / 6.0).collect();
        let ([sip, _], [soop, _]) = model_shares(&pm, &e, &r_ip, &r_oop);
        let t_ip: Vec<Option<f64>> = sip.iter().map(|&v| Some(v)).collect();
        let t_oop: Vec<Option<f64>> = soop.iter().map(|&v| Some(v)).collect();
        let start = vec![1.0f32; 169];
        let (fi, fo) = calibrate(&pm, &e, &t_ip, &t_oop, &start, &start, 0.2, 3.0, 60);
        let ([sip2, _], [soop2, _]) = model_shares(&pm, &e, &fi, &fo);
        for c in 0..169 {
            assert!((sip2[c] - sip[c]).abs() < 2e-3, "IP class {}: {} vs {}", c, sip2[c], sip[c]);
            assert!((soop2[c] - soop[c]).abs() < 2e-3, "OOP class {}: {} vs {}", c, soop2[c], soop[c]);
        }
    }
}
