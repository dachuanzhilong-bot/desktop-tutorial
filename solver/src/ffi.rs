//! C ABI around the postflop solver so it can run as WebAssembly in a Web Worker
//! (`wasm32-unknown-unknown`, no wasm-bindgen).  The same `Session` type is unit tested natively.
//!
//! Config layout (f32 array), see `config_from_f32`:
//!   [0] pot  [1] stack  [2] raise_mult  [3] allin_ratio  [4] allow_allin
//!   [5..8) raise_sizes (flop, turn, river)  [8] turn_cards  [9] river_cards  [10] flop_runouts  [11] seed
//!   then for each street: n, followed by n pot fractions
use crate::postflop::*;
use std::cell::RefCell;
use std::mem::ManuallyDrop;

pub fn config_from_f32(c: &[f32]) -> Result<Config, String> {
    if c.len() < 15 {
        return Err("config too short".into());
    }
    let mut cfg = Config {
        pot: c[0],
        stack: c[1],
        raise_mult: c[2],
        allin_ratio: c[3],
        allow_allin: c[4] > 0.5,
        raise_sizes: [c[5] > 0.5, c[6] > 0.5, c[7] > 0.5],
        turn_cards: c[8] as usize,
        river_cards: c[9] as usize,
        flop_runouts: c[10] as usize,
        seed: c[11] as u64,
        ..Config::default()
    };
    let mut i = 12;
    for street in 0..3 {
        let n = *c.get(i).ok_or("config truncated")? as usize;
        i += 1;
        let v = c.get(i..i + n).ok_or("config truncated")?;
        cfg.bets[street] = v.to_vec();
        i += n;
    }
    if !(cfg.pot > 0.0 && cfg.stack > 0.0) {
        return Err("pot and stack must be positive".into());
    }
    Ok(cfg)
}

/// A solve in progress: the tree, the solver and the last export.
pub struct Session {
    solver: ManuallyDrop<Solver<'static>>,
    tree: *mut Tree,
    pub out: Vec<u8>,
    pub map: Vec<u32>,
}

impl Session {
    pub fn new(cfg: Config, board: Vec<u8>, ranges: [Vec<f32>; 2]) -> Result<Session, String> {
        if !(3..=5).contains(&board.len()) {
            return Err("board must have 3 to 5 cards".into());
        }
        let tree = Box::into_raw(Box::new(build_tree(&cfg, &board)));
        // SAFETY: the tree outlives the solver; `Drop` drops the solver first.
        let solver = Solver::new(unsafe { &*tree }, &ranges);
        Ok(Session { solver: ManuallyDrop::new(solver), tree, out: Vec::new(), map: Vec::new() })
    }

    pub fn run(&mut self, n: u32) {
        for _ in 0..n {
            self.solver.iterate();
        }
    }

    pub fn iterations(&self) -> u32 {
        self.solver.iters
    }

    pub fn node_count(&self) -> usize {
        unsafe { &*self.tree }.nodes.len()
    }

    pub fn reset_average(&mut self) {
        self.solver.reset_average();
    }

    /// exploitability as a percentage of the initial pot
    pub fn exploit_pct(&mut self) -> f32 {
        self.solver.finalize_avg();
        let pot = unsafe { &*self.tree }.cfg.pot;
        100.0 * self.solver.exploitability() / pot
    }

    pub fn export(&mut self, min_reach: f32) -> usize {
        self.solver.finalize_avg();
        let ev = self.solver.evaluate();
        let (bytes, map) = export_with_map(unsafe { &*self.tree }, &ev, min_reach);
        self.out = bytes;
        self.map = map;
        self.out.len()
    }

    pub fn lock(&mut self, node: usize, strategy: Vec<f32>) -> Result<(), String> {
        self.solver.lock_node(node, strategy)
    }

    pub fn unlock(&mut self, node: usize) {
        self.solver.unlock_node(node);
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        unsafe {
            ManuallyDrop::drop(&mut self.solver);
            drop(Box::from_raw(self.tree));
        }
    }
}

// ------------------------------------------------------------------ extern "C"

thread_local! {
    static SESSIONS: RefCell<Vec<Option<Box<Session>>>> = const { RefCell::new(Vec::new()) };
}

fn with<R>(h: i32, f: impl FnOnce(&mut Session) -> R) -> Option<R> {
    SESSIONS.with(|s| s.borrow_mut().get_mut(h as usize).and_then(|x| x.as_deref_mut()).map(f))
}

#[no_mangle]
pub extern "C" fn tsr_alloc(len: usize) -> *mut u8 {
    let mut v = vec![0u8; len.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must be a buffer this module returned (tsr_export / tsr_out_ptr) and not freed yet.
#[no_mangle]
pub unsafe extern "C" fn tsr_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, len.max(1), len.max(1)));
}

/// 4-byte aligned buffer of `len` f32 values
#[no_mangle]
pub extern "C" fn tsr_alloc_f32(len: usize) -> *mut f32 {
    let mut v = vec![0f32; len.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must be an f32 buffer this module returned and not freed yet.
#[no_mangle]
pub unsafe extern "C" fn tsr_free_f32(ptr: *mut f32, len: usize) {
    drop(Vec::from_raw_parts(ptr, len.max(1), len.max(1)));
}

/// returns a handle (>= 0) or a negative error code (-1 bad config, -2 bad board)
///
/// # Safety
/// `cfg` must point to `cfg_len` f32, `board` to `board_len` bytes, `r0` and `r1` to 1,326 f32 each.
#[no_mangle]
pub unsafe extern "C" fn tsr_create(cfg: *const f32, cfg_len: usize, board: *const u8, board_len: usize, r0: *const f32, r1: *const f32) -> i32 {
    let cfg = match config_from_f32(std::slice::from_raw_parts(cfg, cfg_len)) {
        Ok(c) => c,
        Err(_) => return -1,
    };
    let board = std::slice::from_raw_parts(board, board_len).to_vec();
    let ranges = [std::slice::from_raw_parts(r0, NC).to_vec(), std::slice::from_raw_parts(r1, NC).to_vec()];
    match Session::new(cfg, board, ranges) {
        Ok(s) => SESSIONS.with(|all| {
            let mut all = all.borrow_mut();
            if let Some(i) = all.iter().position(|x| x.is_none()) {
                all[i] = Some(Box::new(s));
                i as i32
            } else {
                all.push(Some(Box::new(s)));
                (all.len() - 1) as i32
            }
        }),
        Err(_) => -2,
    }
}

#[no_mangle]
pub extern "C" fn tsr_destroy(h: i32) {
    SESSIONS.with(|s| {
        if let Some(x) = s.borrow_mut().get_mut(h as usize) {
            *x = None;
        }
    });
}

#[no_mangle]
pub extern "C" fn tsr_run(h: i32, n: u32) {
    with(h, |s| s.run(n));
}

#[no_mangle]
pub extern "C" fn tsr_iterations(h: i32) -> u32 {
    with(h, |s| s.iterations()).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn tsr_node_count(h: i32) -> u32 {
    with(h, |s| s.node_count() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn tsr_reset_average(h: i32) {
    with(h, |s| s.reset_average());
}

#[no_mangle]
pub extern "C" fn tsr_exploit_pct(h: i32) -> f32 {
    with(h, |s| s.exploit_pct()).unwrap_or(-1.0)
}

/// builds the export; returns its length in bytes (see `tsr_out_ptr`)
#[no_mangle]
pub extern "C" fn tsr_export(h: i32, min_reach: f32) -> u32 {
    with(h, |s| s.export(min_reach) as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn tsr_out_ptr(h: i32) -> *const u8 {
    with(h, |s| s.out.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn tsr_map_ptr(h: i32) -> *const u32 {
    with(h, |s| s.map.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn tsr_map_len(h: i32) -> u32 {
    with(h, |s| s.map.len() as u32).unwrap_or(0)
}

/// lock `node` (a tree node id from the export map) to `strategy` (na * 1326 f32)
///
/// # Safety
/// `strategy` must point to `len` readable f32.
#[no_mangle]
pub unsafe extern "C" fn tsr_lock(h: i32, node: u32, strategy: *const f32, len: usize) -> i32 {
    let v = std::slice::from_raw_parts(strategy, len).to_vec();
    match with(h, |s| s.lock(node as usize, v)) {
        Some(Ok(())) => 0,
        Some(Err(_)) => -1,
        None => -2,
    }
}

#[no_mangle]
pub extern "C" fn tsr_unlock(h: i32, node: u32) {
    with(h, |s| s.unlock(node as usize));
}

// ------------------------------------------------------------------ ICM push/fold

use crate::cards::NUM_CLASSES;
use crate::engine::Solver as EngineSolver;
use crate::equity::{disjoint_counts, EquityTables};
use crate::icm::{self, IcmGame, IcmSpec, NodeReport};

/// config layout (f32): [n_players, sb, bb, ante, n_payouts, stacks x n, payouts x n_payouts]
pub fn icm_spec_from_f32(c: &[f32]) -> Result<IcmSpec, String> {
    if c.len() < 5 {
        return Err("config too short".into());
    }
    let n = c[0] as usize;
    let np = c[4] as usize;
    if !(2..=icm::MAX_PLAYERS).contains(&n) || np == 0 || c.len() < 5 + n + np {
        return Err("bad player / payout count".into());
    }
    let spec = IcmSpec { stacks: c[5..5 + n].to_vec(), sb: c[1], bb: c[2], ante: c[3], payouts: c[5 + n..5 + n + np].to_vec() };
    if spec.stacks.iter().any(|&s| !s.is_finite() || s <= 0.0) || spec.bb <= 0.0 || spec.payouts.iter().all(|&p| p <= 0.0) {
        return Err("stacks and the big blind must be positive and some prize must be paid".into());
    }
    Ok(spec)
}

pub struct IcmSession {
    solver: ManuallyDrop<EngineSolver<'static>>,
    game: *mut IcmGame,
    pub out: Vec<f32>,
}

impl IcmSession {
    pub fn new(spec: &IcmSpec, t: &EquityTables) -> IcmSession {
        let game = Box::into_raw(Box::new(icm::build(spec, t)));
        // SAFETY: the game outlives the solver; `Drop` drops the solver first.
        let solver = EngineSolver::new(unsafe { &(*game).game });
        IcmSession { solver: ManuallyDrop::new(solver), game, out: Vec::new() }
    }

    pub fn run(&mut self, n: u32) {
        for _ in 0..n {
            self.solver.iterate();
        }
    }

    pub fn iterations(&self) -> u32 {
        self.solver.iters
    }

    pub fn reset_average(&mut self) {
        self.solver.reset_average();
    }

    /// sum of every player's best-response gain, in % of the prize pool
    pub fn exploit_pct(&mut self) -> f32 {
        self.solver.finalize_avg();
        let total: f32 = unsafe { &*self.game }.spec.payouts.iter().sum();
        100.0 * self.solver.br_gaps().iter().sum::<f32>() / total.max(1e-9)
    }

    /// `[n_players, n_nodes, start_equity x n, then per node: player, facing (-1 = none), reach, weight x169, freq x169, ev_jam/call x169, ev_fold x169]`
    /// equities and EVs are in % of the prize pool
    pub fn export(&mut self) -> usize {
        self.solver.finalize_avg();
        let g = unsafe { &*self.game };
        let total: f32 = g.spec.payouts.iter().sum::<f32>().max(1e-9);
        let ev = self.solver.evaluate();
        let k = NUM_CLASSES;
        let mut reports: Vec<NodeReport> = Vec::new();
        for i in &g.info {
            if let Some(e) = ev[i.node].as_ref() {
                reports.push(NodeReport { player: i.player, facing: i.facing, reach: e.reach, weight: e.weight.clone(), freq: e.freq[k..2 * k].to_vec(), ev_act: e.ev[k..2 * k].to_vec(), ev_fold: e.ev[0..k].to_vec() });
            }
        }
        let n = g.spec.stacks.len();
        let mut out = vec![n as f32, reports.len() as f32];
        out.extend(g.start_equity.iter().map(|e| 100.0 * e / total));
        for r in &reports {
            out.push(r.player as f32);
            out.push(r.facing.map(|j| j as f32).unwrap_or(-1.0));
            out.push(r.reach);
            out.extend_from_slice(&r.weight);
            out.extend_from_slice(&r.freq);
            out.extend(r.ev_act.iter().map(|e| 100.0 * e / total));
            out.extend(r.ev_fold.iter().map(|e| 100.0 * e / total));
        }
        self.out = out;
        self.out.len()
    }
}

impl Drop for IcmSession {
    fn drop(&mut self) {
        unsafe {
            ManuallyDrop::drop(&mut self.solver);
            drop(Box::from_raw(self.game));
        }
    }
}

thread_local! {
    static EQUITY: RefCell<Option<EquityTables>> = const { RefCell::new(None) };
    static ICM_SESSIONS: RefCell<Vec<Option<Box<IcmSession>>>> = const { RefCell::new(Vec::new()) };
}

fn with_icm<R>(h: i32, f: impl FnOnce(&mut IcmSession) -> R) -> Option<R> {
    ICM_SESSIONS.with(|s| s.borrow_mut().get_mut(h as usize).and_then(|x| x.as_deref_mut()).map(f))
}

/// `eq`: 169*169 u16 values (equity * 65535), row = hand a, column = hand b
///
/// # Safety
/// `eq` must point to 169 * 169 readable u16.
#[no_mangle]
pub unsafe extern "C" fn tsr_icm_set_equity(eq: *const u16) {
    let raw = std::slice::from_raw_parts(eq, NUM_CLASSES * NUM_CLASSES);
    let table = EquityTables { eq: raw.iter().map(|&v| v as f32 / 65535.0).collect(), n: disjoint_counts(), samples: 0 };
    EQUITY.with(|e| *e.borrow_mut() = Some(table));
}

/// handle (>= 0), -1 bad config, -2 equity table not loaded
///
/// # Safety
/// `cfg` must point to `cfg_len` readable f32.
#[no_mangle]
pub unsafe extern "C" fn tsr_icm_create(cfg: *const f32, cfg_len: usize) -> i32 {
    let spec = match icm_spec_from_f32(std::slice::from_raw_parts(cfg, cfg_len)) {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let session = match EQUITY.with(|e| e.borrow().as_ref().map(|t| IcmSession::new(&spec, t))) {
        Some(s) => s,
        None => return -2,
    };
    ICM_SESSIONS.with(|all| {
        let mut all = all.borrow_mut();
        if let Some(i) = all.iter().position(|x| x.is_none()) {
            all[i] = Some(Box::new(session));
            i as i32
        } else {
            all.push(Some(Box::new(session)));
            (all.len() - 1) as i32
        }
    })
}

#[no_mangle]
pub extern "C" fn tsr_icm_destroy(h: i32) {
    ICM_SESSIONS.with(|s| {
        if let Some(x) = s.borrow_mut().get_mut(h as usize) {
            *x = None;
        }
    });
}

#[no_mangle]
pub extern "C" fn tsr_icm_run(h: i32, n: u32) {
    with_icm(h, |s| s.run(n));
}

#[no_mangle]
pub extern "C" fn tsr_icm_iterations(h: i32) -> u32 {
    with_icm(h, |s| s.iterations()).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn tsr_icm_reset_average(h: i32) {
    with_icm(h, |s| s.reset_average());
}

#[no_mangle]
pub extern "C" fn tsr_icm_exploit_pct(h: i32) -> f32 {
    with_icm(h, |s| s.exploit_pct()).unwrap_or(-1.0)
}

/// number of f32 values written; read them at `tsr_icm_out_ptr`
#[no_mangle]
pub extern "C" fn tsr_icm_export(h: i32) -> usize {
    with_icm(h, |s| s.export()).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn tsr_icm_out_ptr(h: i32) -> *const f32 {
    with_icm(h, |s| s.out.as_ptr()).unwrap_or(std::ptr::null())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(s: &str) -> u8 {
        let b = s.as_bytes();
        (b"23456789TJQKA".iter().position(|&x| x == b[0]).unwrap() as u8) * 4 + b"cdhs".iter().position(|&x| x == b[1]).unwrap() as u8
    }
    fn range(list: &[(&str, &str)]) -> Vec<f32> {
        let mut v = vec![0f32; NC];
        for &(a, b) in list {
            v[ct().index(card(a), card(b))] = 1.0;
        }
        v
    }

    fn cfg_vec(pot: f32, stack: f32, flop: &[f32], turn: &[f32], river: &[f32]) -> Vec<f32> {
        let mut c = vec![pot, stack, 3.0, 0.67, 0.0, 0.0, 0.0, 0.0, 6.0, 2.0, 60.0, 5.0];
        for v in [flop, turn, river] {
            c.push(v.len() as f32);
            c.extend_from_slice(v);
        }
        c
    }

    #[test]
    fn config_roundtrip() {
        let c = config_from_f32(&cfg_vec(10.0, 90.0, &[0.33, 0.75], &[0.66], &[0.5, 1.0])).unwrap();
        assert_eq!(c.pot, 10.0);
        assert_eq!(c.bets[0], vec![0.33, 0.75]);
        assert_eq!(c.bets[2], vec![0.5, 1.0]);
        assert!(!c.allow_allin);
        assert!(config_from_f32(&[1.0, 2.0]).is_err());
    }

    const NUTS: &[(&str, &str)] = &[("Ad", "Ac"), ("Ad", "As"), ("Ac", "As")];
    const AIR: &[(&str, &str)] = &[("6c", "5c"), ("6d", "5d"), ("6h", "5h"), ("6s", "5s"), ("9c", "4c"), ("9d", "4h")];
    const QQ: &[(&str, &str)] = &[("Qc", "Qd"), ("Qc", "Qh"), ("Qc", "Qs"), ("Qd", "Qh"), ("Qd", "Qs"), ("Qh", "Qs")];

    fn river_session() -> Session {
        let cfg = config_from_f32(&cfg_vec(10.0, 1000.0, &[], &[], &[0.75])).unwrap();
        let board: Vec<u8> = "Ah 8d 7c 2s 3d".split(' ').map(card).collect();
        let mut oop = NUTS.to_vec();
        oop.extend_from_slice(AIR);
        Session::new(cfg, board, [range(&oop), range(QQ)]).unwrap()
    }

    #[test]
    fn session_solves_exports_and_maps_nodes() {
        let mut s = river_session();
        s.run(1500);
        assert_eq!(s.iterations(), 1500);
        assert!(s.exploit_pct() < 3.0);
        let len = s.export(0.0);
        assert!(len > 100 && s.out.len() == len);
        assert_eq!(&s.out[0..4], b"TSP1");
        assert_eq!(s.map[0], 0); // the root is the first exported node
        assert!(s.map.len() >= 3);
    }

    /// node-lock: if the out-of-position player is locked into betting every hand, the bluff-catcher must call
    #[test]
    fn locking_a_node_makes_the_opponent_exploit_it() {
        let mut s = river_session();
        // lock OOP's root: bet (action 1) with 100 % of the range, check (action 0) never
        let mut strat = vec![0f32; 2 * NC];
        for h in 0..NC {
            strat[NC + h] = 1.0;
        }
        s.lock(0, strat).unwrap();
        s.run(1500);
        assert!(s.exploit_pct() < 3.0);
        s.export(0.0);
        // 50 % of the betting range bluffs (6 air vs 3 nuts combos -> 2/3 air): calling is always right
        let tree = unsafe { &*s.tree };
        let facing = tree.nodes.iter().position(|n| matches!(&n.kind, PKind::Decision { player: 1, acts, .. } if acts.len() == 2 && acts[0].kind == 0)).unwrap();
        let avg = &s.solver.avg[facing];
        let call: f32 = QQ.iter().map(|&(a, b)| avg[NC + ct().index(card(a), card(b))]).sum::<f32>() / 6.0;
        assert!(call > 0.95, "the bluff catcher must call a range that bluffs this much: {}", call);
        // a lock needs a decision node and the right size
        assert!(s.lock(9999, vec![0.0; 2 * NC]).is_err());
        assert!(s.lock(0, vec![0.0; 5]).is_err());
        s.unlock(0);
    }

    #[test]
    fn ffi_handles_are_independent() {
        let cfg = cfg_vec(10.0, 1000.0, &[], &[], &[0.75]);
        let board: Vec<u8> = "Ah 8d 7c 2s 3d".split(' ').map(card).collect();
        let mut oop = NUTS.to_vec();
        oop.extend_from_slice(AIR);
        let (r0, r1) = (range(&oop), range(QQ));
        let (a, b) = unsafe { (tsr_create(cfg.as_ptr(), cfg.len(), board.as_ptr(), 5, r0.as_ptr(), r1.as_ptr()), tsr_create(cfg.as_ptr(), cfg.len(), board.as_ptr(), 5, r0.as_ptr(), r1.as_ptr())) };
        assert!(a >= 0 && b >= 0 && a != b);
        tsr_run(a, 50);
        assert_eq!(tsr_iterations(a), 50);
        assert_eq!(tsr_iterations(b), 0);
        assert!(tsr_export(a, 0.0) > 0);
        assert!(!tsr_out_ptr(a).is_null());
        tsr_destroy(a);
        assert_eq!(tsr_iterations(a), 0);
        tsr_destroy(b);
        let bad = [1.0f32];
        assert_eq!(unsafe { tsr_create(bad.as_ptr(), 1, board.as_ptr(), 5, r0.as_ptr(), r1.as_ptr()) }, -1);
    }

    #[test]
    fn icm_session_round_trip() {
        let t = crate::equity::load("cache/equity-60000-20260101.bin").unwrap_or_else(|| crate::equity::compute_equity(20_000, 1, 4));
        let cfg = [3.0, 0.5, 1.0, 0.0, 3.0, 12.0, 6.0, 12.0, 50.0, 30.0, 20.0];
        let spec = icm_spec_from_f32(&cfg).unwrap();
        assert_eq!(spec.stacks, vec![12.0, 6.0, 12.0]);
        assert!(icm_spec_from_f32(&[1.0, 0.5, 1.0, 0.0, 1.0, 10.0, 1.0]).is_err());
        let mut s = IcmSession::new(&spec, &t);
        s.run(400);
        assert!(s.exploit_pct() < 3.0);
        let len = s.export();
        // header + start equity + 5 decision nodes of (3 + 4*169) values
        assert_eq!(len, 2 + 3 + 5 * (3 + 4 * NUM_CLASSES));
        assert_eq!(s.out[0], 3.0);
        assert_eq!(s.out[1], 5.0);
        let eq_sum: f32 = s.out[2..5].iter().sum();
        assert!((eq_sum - 100.0).abs() < 0.01, "start equities add up to the whole prize pool: {}", eq_sum);
        assert!(s.out.iter().all(|v| v.is_finite()));
    }
}
