//! REFACTOR_PLAN 3-1: the equity realisation of solved flops, by hand class (`eqr.rs`).
//!
//! `gen_eqr --dir DIR --scenario ID=ip|oop [--scenario ID2=... ...] [--out REPORT.tsv] [--table-out EQR.tsv]`
//!
//! `ID=ip` says that the in-position player is the pot's aggressor (a single-raised pot: the opener acts last),
//! `ID=oop` that the out-of-position player is (a 3-bet pot: the 3-bettor).  Without `=...`: `srp*` is `ip`, `3bp*` is `oop`.
//! `--table-out` writes the table the preflop model reads (`eqr::EqrTable`, `gen_preflop --eqr`).
//!
//! reads `DIR/<scenario>/<n>.bin.gz` (or `.bin`), n = 0, 1, ... (`gen_postflop` output, `web/public/postflop`), and
//! for every hand class and role (OOP / IP) prints the share of the flop's initial pot the equilibrium play realises
//! (`s`), the raw equity (`e`) and their ratio `R = s / e`, next to the hand-made model `Realization` of `preflop.rs`
//! at the scenario's SPR.  The table goes to `--out` (TSV), the checks of every flop (zero-sum identity of the values,
//! of the equities, the pruned share) to stderr.
use std::collections::HashMap;
use tessera_solver::cards::class_name;
use tessera_solver::eqr::{anchor, build_table, calibrate, flop_values, matchups, model_shares, Aggr, ClassAcc, ScenarioFit};
use tessera_solver::equity;
use tessera_solver::measure::parse_tsp1;
use tessera_solver::preflop::Realization;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn args_all(args: &[String], name: &str) -> Vec<String> {
    args.iter().enumerate().filter(|(_, a)| *a == name).filter_map(|(i, _)| args.get(i + 1).cloned()).collect()
}

fn read_flop(dir: &str, scenario: &str, n: usize) -> Option<Result<Vec<u8>, String>> {
    let gz = format!("{}/{}/{}.bin.gz", dir, scenario, n);
    let raw = format!("{}/{}/{}.bin", dir, scenario, n);
    if std::path::Path::new(&gz).exists() {
        let out = std::process::Command::new("gzip").arg("-dc").arg(&gz).output();
        return Some(match out {
            Ok(o) if o.status.success() => Ok(o.stdout),
            _ => Err(format!("gzip failed on {}", gz)),
        });
    }
    if std::path::Path::new(&raw).exists() {
        return Some(std::fs::read(&raw).map_err(|e| format!("{}: {}", raw, e)));
    }
    None
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = arg(&args, "--dir").unwrap_or_else(|| "../web/public/postflop".into());
    let specs = args_all(&args, "--scenario");
    assert!(!specs.is_empty(), "usage: gen_eqr --dir DIR --scenario ID=ip|oop [--scenario ...] [--out REPORT.tsv] [--table-out EQR.tsv]");
    let scenarios: Vec<(String, bool)> = specs
        .iter()
        .map(|sp| match sp.split_once('=') {
            Some((id, "ip")) => (id.to_string(), true),
            Some((id, "oop")) => (id.to_string(), false),
            Some((_, x)) => panic!("--scenario ID=ip|oop, not {}", x),
            None if sp.starts_with("srp") => (sp.clone(), true),
            None if sp.starts_with("3bp") => (sp.clone(), false),
            None => panic!("--scenario {}: say who is the aggressor (ID=ip or ID=oop)", sp),
        })
        .collect();
    let out_path = arg(&args, "--out");
    let table_out = arg(&args, "--table-out");
    // which scenarios the table is made from (default: all); the others only judge it
    let train: Option<Vec<String>> = arg(&args, "--train").map(|t| t.split(',').map(|x| x.to_string()).collect());
    // `--fit ratio`: the measured ratio s / e as the factor; default `calibrated`: the factors that give the measured shares
    let fit_ratio = arg(&args, "--fit").as_deref() == Some("ratio");
    let mut fits: Vec<ScenarioFit> = Vec::new();
    let mut accs: Vec<(String, f32, bool, ClassAcc)> = Vec::new();
    let eq_path = arg(&args, "--equity").unwrap_or_else(|| "cache/equity-60000-20260101.bin".into());
    let tables = equity::load(&eq_path).unwrap_or_else(|| panic!("no equity table at {} (gen_preflop makes it)", eq_path));
    let model = Realization::default();
    let mut tsv = String::from("scenario\trole\tclass\tname\tweight\tshare\tequity\tR\tmodelR\tfitR\n");
    let mut stats: HashMap<String, (f64, f64)> = HashMap::new();
    for (sc, ip_aggr) in &scenarios {
        let mut acc = ClassAcc::new();
        let (mut pot, mut stack) = (0f32, 0f32);
        let (mut worst_zs, mut worst_eq, mut worst_pr) = (0f32, 0f32, 0f32);
        let mut n = 0;
        while let Some(bytes) = read_flop(&dir, sc, n) {
            let bytes = bytes.unwrap_or_else(|e| panic!("{}", e));
            let f = parse_tsp1(&bytes).unwrap_or_else(|e| panic!("{}/{}: {}", sc, n, e));
            pot = f.pot;
            stack = f.stack;
            let v = flop_values(&f).unwrap_or_else(|e| panic!("{}/{}: {}", sc, n, e));
            eprintln!("{} flop {:>2}: zero-sum gap {:+.4}, equity gap {:+.4}, pruned {:.5}", sc, n, v.zero_sum_gap, v.equity_gap, v.pruned_mass);
            worst_zs = worst_zs.max(v.zero_sum_gap.abs());
            worst_eq = worst_eq.max(v.equity_gap.abs());
            worst_pr = worst_pr.max(v.pruned_mass);
            acc.add(&v);
            n += 1;
        }
        assert!(n > 0, "no flop files of {} in {}", sc, dir);
        let spr = stack / pot;
        let k = model.k(spr);
        eprintln!("{}: {} flops, pot {} stack {} (SPR {:.2}, k {:.4}); worst |zero-sum gap| {:.4}, |equity gap| {:.4}, pruned {:.5}", sc, n, pot, stack, spr, k, worst_zs, worst_eq, worst_pr);
        // how well do the realisation factors reproduce the measured class shares through the preflop model's own formula?
        let mass: Vec<Vec<f64>> = (0..2).map(|r| (0..169).map(|c| acc.rw[r][c] / acc.flops as f64).collect()).collect();
        let pm = matchups(&mass[1], &mass[0], &tables.n); // rows = IP, cols = OOP
        let present = |r: usize, c: usize| acc.means(r, c).filter(|&(w, _, _)| w > 1.0);
        let target_ip: Vec<Option<f64>> = (0..169).map(|c| present(1, c).map(|(_, s, _)| s)).collect();
        let target_oop: Vec<Option<f64>> = (0..169).map(|c| present(0, c).map(|(_, s, _)| s)).collect();
        let ratio = |r: usize, c: usize| present(r, c).map(|(_, s, e)| (s / e) as f32).unwrap_or(1.0);
        let rho_ip: Vec<f32> = (0..169).map(|c| ratio(1, c)).collect();
        let rho_oop: Vec<f32> = (0..169).map(|c| ratio(0, c)).collect();
        let old_ip: Vec<f32> = (0..169).map(|c| model.factor(c, true, k)).collect();
        let old_oop: Vec<f32> = (0..169).map(|c| model.factor(c, false, k)).collect();
        let (mut fit_ip, mut fit_oop) = calibrate(&pm, &tables.eq, &target_ip, &target_oop, &rho_ip, &rho_oop, 0.3, 2.5, 40);
        let level = anchor(&pm, &tables.eq, &mut fit_ip, &mut fit_oop);
        eprintln!("{}: the calibration's level (divided out): {:.4}", sc, level);
        if fit_ratio {
            fit_ip = rho_ip.iter().map(|r| r.clamp(0.3, 2.5)).collect();
            fit_oop = rho_oop.iter().map(|r| r.clamp(0.3, 2.5)).collect();
        }
        let trained = train.as_ref().map(|t| t.contains(sc)).unwrap_or(true);
        if trained {
        fits.push(ScenarioFit {
            name: sc.clone(),
            k,
            ip_aggr: *ip_aggr,
            w: [acc.w[0].clone(), acc.w[1].clone()],
            r: [fit_oop.clone(), fit_ip.clone()],
            present: [(0..169).map(|c| present(0, c).is_some()).collect(), (0..169).map(|c| present(1, c).is_some()).collect()],
        });
        }
        accs.push((sc.clone(), k, *ip_aggr, acc.clone()));
        let report = |name: &str, ri: &[f32], ro: &[f32]| {
            let ([sip, zip], [soop, zoop]) = model_shares(&pm, &tables.eq, ri, ro);
            let mut line = format!("{}: share error of the model", name);
            for (role, s, z, t, w) in [("IP", &sip, &zip, &target_ip, &mass[1]), ("OOP", &soop, &zoop, &target_oop, &mass[0])] {
                let (mut num, mut den, mut bias) = (0f64, 0f64, 0f64);
                for c in 0..169 {
                    if let Some(tg) = t[c] {
                        if z[c] > 0.0 {
                            let d = s[c] - tg;
                            num += w[c] * d * d;
                            bias += w[c] * d;
                            den += w[c];
                        }
                    }
                }
                line.push_str(&format!("  {} rms {:.4} bias {:+.4}", role, (num / den).sqrt(), bias / den));
            }
            eprintln!("{}", line);
        };
        eprintln!("{}: fitted against the measured class shares (classes with weight > 1)", sc);
        report("  hand-made   ", &old_ip, &old_oop);
        report("  ratio s/e   ", &rho_ip, &rho_oop);
        report("  calibrated  ", &fit_ip, &fit_oop);
        for r in 0..2 {
            let role = if r == 0 { "OOP" } else { "IP" };
            let (mut tw, mut ts, mut te, mut tm) = (0f64, 0f64, 0f64, 0f64);
            for c in 0..169 {
                let Some((w, s, e)) = acc.means(r, c) else { continue };
                let mr = model.factor(c, r == 1, k) as f64;
                let fr = if r == 1 { fit_ip[c] } else { fit_oop[c] };
                tw += w;
                ts += w * s;
                te += w * e;
                tm += w * mr;
                tsv.push_str(&format!("{}\t{}\t{}\t{}\t{:.6}\t{:.5}\t{:.5}\t{:.4}\t{:.4}\t{:.4}\n", sc, role, c, class_name(c), w, s, e, s / e, mr, fr));
            }
            let key = format!("{} {}", sc, role);
            stats.insert(key.clone(), (ts / tw, te / tw));
            eprintln!("{} {}: mean share {:.4}, mean equity {:.4}, share/equity {:.4}; the model's mean R {:.4}", sc, role, ts / tw, te / tw, (ts / tw) / (te / tw), tm / tw);
        }
    }
    if let Some(p) = table_out {
        let note = format!(
            "tessera EQR table: R = 1 + k(SPR) m by role (OOP / IP), aggressor and hand class (REFACTOR_PLAN 3-1, docs/07 section 2)\nfrom the solved flops {} (`gen_eqr`: realised share of the initial pot / raw equity, calibrated through the model's own share formula)",
            fits.iter().map(|f| format!("{} ({} aggressor)", f.name, if f.ip_aggr { "IP" } else { "OOP" })).collect::<Vec<_>>().join(", ")
        );
        let table = build_table(&fits, note).unwrap_or_else(|e| panic!("{}", e));
        // the model with the table, against the measured class shares of every scenario
        for (sc, k, ip_aggr, acc) in &accs {
            let mass: Vec<Vec<f64>> = (0..2).map(|r| (0..169).map(|c| acc.rw[r][c] / acc.flops as f64).collect()).collect();
            let pm = matchups(&mass[1], &mass[0], &tables.n);
            let (a_ip, a_oop) = if *ip_aggr { (Aggr::Aggressor, Aggr::Caller) } else { (Aggr::Caller, Aggr::Aggressor) };
            let r_ip: Vec<f32> = (0..169).map(|c| 1.0 + k * table.get(c, true, a_ip)).collect();
            let r_oop: Vec<f32> = (0..169).map(|c| 1.0 + k * table.get(c, false, a_oop)).collect();
            let ([sip, zip], [soop, zoop]) = model_shares(&pm, &tables.eq, &r_ip, &r_oop);
            let trained = train.as_ref().map(|t| t.contains(sc)).unwrap_or(true);
            let mut line = format!("{}: the table's share error{}", sc, if trained { "" } else { " (NOT in the table)" });
            for (role, sh, z, r) in [("IP", &sip, &zip, 1usize), ("OOP", &soop, &zoop, 0usize)] {
                let (mut num, mut den, mut bias) = (0f64, 0f64, 0f64);
                for c in 0..169 {
                    if let Some((w, s, _)) = acc.means(r, c).filter(|&(w, _, _)| w > 1.0) {
                        if z[c] > 0.0 {
                            let d = sh[c] - s;
                            num += mass[r][c] * d * d;
                            bias += mass[r][c] * d;
                            den += mass[r][c];
                            let _ = w;
                        }
                    }
                }
                line.push_str(&format!("  {} rms {:.4} bias {:+.4}", role, (num / den).sqrt(), bias / den));
            }
            eprintln!("{}", line);
        }
        std::fs::write(&p, table.to_text()).unwrap_or_else(|e| panic!("{}: {}", p, e));
        eprintln!("EQR table written to {}", p);
    }
    if let Some(p) = out_path {
        std::fs::write(&p, tsv).unwrap_or_else(|e| panic!("{}: {}", p, e));
        eprintln!("table written to {}", p);
    }
}
