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

#[no_mangle]
pub unsafe extern "C" fn tsr_free_f32(ptr: *mut f32, len: usize) {
    drop(Vec::from_raw_parts(ptr, len.max(1), len.max(1)));
}

/// returns a handle (>= 0) or a negative error code (-1 bad config, -2 bad board)
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
}
