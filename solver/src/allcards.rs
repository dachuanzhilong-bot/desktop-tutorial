//! One flop solved over every turn and river card, and the river re-solved on its own (REFACTOR_PLAN 3-3-3).
//!
//! * `run_iterations`: CFR+ iterations with the strategy average restarted part-way (as `gen_postflop`), saving the
//!   solver's state to a `Checkpoints` directory every K iterations; a later call on a fresh solver of the same tree
//!   continues from the newest valid checkpoint and ends bit for bit where an uninterrupted run would.
//! * `all_cards_values`: the exploitability of the solved strategy on the whole tree (on a tree built with every card,
//!   `Solver::exploitability` is the full-card value of 3-0's `FullBr`, `docs/QUALITY.md` §1), with the river playing
//!   its average strategy (made on demand from `ssum`, `SolverOptions::avg_on_demand_from`) or its current strategy.
//! * `Upstream`: the flop and turn average strategies of a solve, in a small file.
//! * `resolve_river`: those strategies locked (`lock_node`), the river solved again from zero for N iterations, then
//!   the value with only the river best-responding (locks kept) and over the whole tree (locks removed).  With the
//!   flop and turn fixed, every river subgame is independent, so this is the computation of plan B's device, which
//!   re-solves the river from the reach ranges alone (`docs/14` §3).
//!
//! Files (little endian):
//! * checkpoint `ckpt-<iteration>.tsck`: `"TSCK"`, u32 version 1, u64 fingerprint, u32 iterations,
//!   u32 start of the average, u64 regret floats, u64 strategy sum floats, u32 tag length, tag (UTF-8), the regrets
//!   (every node's `regret` vector in node order), the strategy sums (likewise), u32 CRC-32 of everything before it,
//!   u64 length of the whole file.  The fingerprint covers the tree, the supports, the starting ranges, every node's
//!   vector lengths (so the options that change the layout) and the tag (the run's plan: iterations, restart of the
//!   average, ...), so a checkpoint is only ever loaded into the run that wrote it.  Written to `ckpt.tmp`, synced,
//!   then renamed; at most 2 complete checkpoints are kept (the older one is removed before a new one is written).
//! * upstream `upstream.tsup`: `"TSUP"`, u32 version 1, u64 tree fingerprint, u32 tag length, tag, u32 node count,
//!   per node: u32 node, u32 actions, actions x 1,326 f32 (the average strategy, `na * NC` as `Solver::avg`);
//!   u32 CRC-32, u64 file length.  Written the same way (temporary file, then rename).
use crate::postflop::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;

// ------------------------------------------------------------------ CRC-32 (IEEE, slicing by 8)

fn crc_tables() -> &'static [[u32; 256]; 8] {
    static T: OnceLock<[[u32; 256]; 8]> = OnceLock::new();
    T.get_or_init(|| {
        let mut t = [[0u32; 256]; 8];
        for i in 0..256u32 {
            let mut c = i;
            for _ in 0..8 {
                c = if c & 1 == 1 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            t[0][i as usize] = c;
        }
        for k in 1..8 {
            for i in 0..256 {
                let p = t[k - 1][i];
                t[k][i] = (p >> 8) ^ t[0][(p & 0xff) as usize];
            }
        }
        t
    })
}

/// CRC-32 (the one of zip / gzip / PNG)
pub struct Crc(u32);

impl Default for Crc {
    fn default() -> Self {
        Crc(0xFFFF_FFFF)
    }
}

impl Crc {
    pub fn update(&mut self, b: &[u8]) {
        let t = crc_tables();
        let mut c = self.0;
        let (words, rest) = b.as_chunks::<8>();
        for x in words {
            let one = u32::from_le_bytes([x[0], x[1], x[2], x[3]]) ^ c;
            let two = u32::from_le_bytes([x[4], x[5], x[6], x[7]]);
            c = t[7][(one & 0xff) as usize]
                ^ t[6][((one >> 8) & 0xff) as usize]
                ^ t[5][((one >> 16) & 0xff) as usize]
                ^ t[4][(one >> 24) as usize]
                ^ t[3][(two & 0xff) as usize]
                ^ t[2][((two >> 8) & 0xff) as usize]
                ^ t[1][((two >> 16) & 0xff) as usize]
                ^ t[0][(two >> 24) as usize];
        }
        for &x in rest {
            c = t[0][((c ^ x as u32) & 0xff) as usize] ^ (c >> 8);
        }
        self.0 = c;
    }
    pub fn finish(&self) -> u32 {
        !self.0
    }
}

// ------------------------------------------------------------------ fingerprints

struct Fnv(u64);
impl Fnv {
    fn new() -> Fnv {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
    fn bytes(&mut self, b: &[u8]) {
        for &x in b {
            self.0 = (self.0 ^ x as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
    fn u64(&mut self, x: u64) {
        self.bytes(&x.to_le_bytes());
    }
    fn f32(&mut self, x: f32) {
        self.bytes(&x.to_bits().to_le_bytes());
    }
}

/// The tree (configuration, every node's kind, street, board, actions and cards), the supports and the starting
/// ranges of a solver: equal for two solvers of the same flop, scenario and tree settings.
pub fn tree_fingerprint(s: &Solver) -> u64 {
    fingerprint(s.tree, &s.prior, &s.supports, &s.support_of)
}

/// `tree_fingerprint` of a solver of `tree` with the starting ranges `ranges` (as given to `Solver::new`), without
/// making the solver (whose regrets a 49 x 48 tree could not hold next to another solve).
pub fn tree_fingerprint_of(tree: &Tree, ranges: &[Vec<f32>; 2]) -> u64 {
    let prior = starting_prior(tree, ranges);
    let (supports, support_of) = decision_supports(tree, &prior);
    fingerprint(tree, &prior, &supports, &support_of)
}

fn fingerprint(t: &Tree, prior: &[Vec<f32>; 2], supports: &[Vec<u16>], support_of: &[u32]) -> u64 {
    fingerprint_of_text(t, &format!("{:?}", t.cfg), prior, supports, support_of)
}

/// What `Config`'s `{:?}` printed before it got the rake fields (REFACTOR_PLAN 3-2), for a configuration without
/// rake; `None` for one with rake (there was no such file).
fn config_text_before_rake(cfg: &Config) -> Option<String> {
    format!("{:?}", cfg).strip_suffix(", rake_pct: 0.0, rake_cap: inf }").map(|head| format!("{} }}", head))
}

/// `fingerprint` of a tree without rake as it was computed before the rake fields: the `upstream.tsup` files written
/// then (the measurements of `docs/14` §11-8) stay readable.  `None` for a tree with rake.
fn legacy_fingerprint(t: &Tree, prior: &[Vec<f32>; 2], supports: &[Vec<u16>], support_of: &[u32]) -> Option<u64> {
    config_text_before_rake(&t.cfg).map(|text| fingerprint_of_text(t, &text, prior, supports, support_of))
}

fn fingerprint_of_text(t: &Tree, cfg_text: &str, prior: &[Vec<f32>; 2], supports: &[Vec<u16>], support_of: &[u32]) -> u64 {
    let mut h = Fnv::new();
    h.bytes(cfg_text.as_bytes());
    h.bytes(&t.board);
    h.u64(t.nodes.len() as u64);
    for (i, n) in t.nodes.iter().enumerate() {
        h.bytes(&[n.street, n.board.len() as u8]);
        h.bytes(&n.board);
        h.f32(n.inv[0]);
        h.f32(n.inv[1]);
        match &n.kind {
            PKind::Decision { player, acts, children } => {
                h.bytes(&[0, *player, acts.len() as u8]);
                for (a, &c) in acts.iter().zip(children) {
                    h.bytes(&[a.kind]);
                    h.f32(a.amount);
                    h.u64(c as u64);
                }
                h.u64(supports[support_of[i] as usize].len() as u64);
            }
            PKind::Chance { cards, children, weight } => {
                h.bytes(&[1]);
                h.bytes(cards);
                children.iter().for_each(|&c| h.u64(c as u64));
                h.f32(*weight);
            }
            PKind::Fold { winner } => h.bytes(&[2, *winner]),
            PKind::Showdown { table } => {
                h.bytes(&[3]);
                h.u64(*table as u64);
            }
            PKind::AllIn { tables, weight } => {
                h.bytes(&[4]);
                tables.iter().for_each(|&x| h.u64(x as u64));
                h.f32(*weight);
            }
        }
    }
    for sup in supports {
        h.u64(sup.len() as u64);
        sup.iter().for_each(|&x| h.bytes(&x.to_le_bytes()));
    }
    for p in prior {
        p.iter().for_each(|&x| h.f32(x));
    }
    h.0
}

/// what a checkpoint must match: the tree, the layout of the regrets / strategy sums, the run's tag
fn state_fingerprint(s: &Solver, tag: &str) -> u64 {
    let mut h = Fnv::new();
    h.u64(tree_fingerprint(s));
    for (r, ss) in s.regret.iter().zip(&s.ssum) {
        h.u64(r.len() as u64);
        h.u64(ss.len() as u64);
    }
    h.bytes(tag.as_bytes());
    h.0
}

// ------------------------------------------------------------------ raw f32 IO

const CHUNK: usize = 1 << 16;

fn write_f32s(w: &mut dyn Write, crc: &mut Crc, v: &[f32], buf: &mut Vec<u8>) -> std::io::Result<()> {
    for c in v.chunks(CHUNK) {
        buf.clear();
        for x in c {
            buf.extend_from_slice(&x.to_le_bytes());
        }
        crc.update(buf);
        w.write_all(buf)?;
    }
    Ok(())
}

fn read_f32s(r: &mut impl Read, crc: &mut Crc, v: &mut [f32], buf: &mut Vec<u8>) -> std::io::Result<()> {
    for c in v.chunks_mut(CHUNK) {
        buf.resize(c.len() * 4, 0);
        r.read_exact(buf)?;
        crc.update(buf);
        // `buf` holds exactly 4 bytes per value, so `chunks(4)` never yields a short chunk
        for (x, b) in c.iter_mut().zip(buf.chunks(4)) {
            *x = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        }
    }
    Ok(())
}

fn read_u32(r: &mut impl Read, crc: &mut Crc) -> std::io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    crc.update(&b);
    Ok(u32::from_le_bytes(b))
}

fn read_u64(r: &mut impl Read, crc: &mut Crc) -> std::io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    crc.update(&b);
    Ok(u64::from_le_bytes(b))
}

/// Write `body` to `path` atomically: a temporary file next to it, synced, renamed over `path`, the directory synced.
/// `body` writes through the CRC; the CRC and the file length are appended.  `fail_after` (tests) stops after that
/// many body bytes with an error, as a crash would, leaving the temporary file.
fn write_atomic(path: &Path, tmp: &Path, fail_after: Option<u64>, body: &mut dyn FnMut(&mut dyn Write, &mut Crc) -> std::io::Result<()>) -> std::io::Result<u64> {
    struct Limited<W: Write> {
        w: W,
        left: Option<u64>,
        n: u64,
    }
    impl<W: Write> Write for Limited<W> {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            if let Some(l) = self.left {
                if self.n + b.len() as u64 > l {
                    let k = (l - self.n) as usize;
                    self.w.write_all(&b[..k])?;
                    self.w.flush()?;
                    return Err(std::io::Error::other("simulated crash while writing"));
                }
            }
            self.w.write_all(b)?;
            self.n += b.len() as u64;
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.w.flush()
        }
    }
    let f = File::create(tmp)?;
    let mut w = Limited { w: BufWriter::with_capacity(8 << 20, f), left: fail_after, n: 0 };
    let mut crc = Crc::default();
    body(&mut w, &mut crc)?;
    let c = crc.finish();
    w.write_all(&c.to_le_bytes())?;
    let len = w.n + 8;
    w.write_all(&len.to_le_bytes())?;
    w.flush()?;
    let f = w.w.into_inner().map_err(|e| e.into_error())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(tmp, path)?;
    if let Some(dir) = path.parent() {
        if let Ok(d) = File::open(if dir.as_os_str().is_empty() { Path::new(".") } else { dir }) {
            let _ = d.sync_all();
        }
    }
    Ok(len)
}

/// Check the trailer (CRC of everything before it, file length) of a file whose body was read through `crc`.
fn check_trailer(r: &mut impl Read, crc: &Crc, file_len: u64) -> Result<(), String> {
    let mut b = [0u8; 12];
    r.read_exact(&mut b).map_err(|e| format!("trailer: {}", e))?;
    let want = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let len = u64::from_le_bytes([b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11]]);
    if want != crc.finish() {
        return Err(format!("CRC {:08x}, expected {:08x}", crc.finish(), want));
    }
    if len != file_len {
        return Err(format!("length {} recorded, file has {}", len, file_len));
    }
    let mut extra = [0u8; 1];
    if r.read(&mut extra).map_err(|e| e.to_string())? != 0 {
        return Err("bytes after the trailer".into());
    }
    Ok(())
}

// ------------------------------------------------------------------ checkpoints

const CKPT_MAGIC: &[u8; 4] = b"TSCK";
const UP_MAGIC: &[u8; 4] = b"TSUP";
const VERSION: u32 = 1;

/// what one save cost
#[derive(Clone, Copy, Debug)]
pub struct SaveInfo {
    pub iters: u32,
    pub bytes: u64,
    pub secs: f32,
}

/// A directory of checkpoints of one run (`tag` names the run's plan; see the module documentation).
pub struct Checkpoints {
    pub dir: PathBuf,
    pub tag: String,
}

impl Checkpoints {
    pub fn new(dir: impl Into<PathBuf>, tag: impl Into<String>) -> std::io::Result<Checkpoints> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        Ok(Checkpoints { dir, tag: tag.into() })
    }

    fn tmp(&self) -> PathBuf {
        self.dir.join("ckpt.tmp")
    }

    /// the complete checkpoint files (by name), oldest first: (iterations, path)
    pub fn generations(&self) -> Vec<(u32, PathBuf)> {
        let mut v: Vec<(u32, PathBuf)> = std::fs::read_dir(&self.dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let name = e.file_name().into_string().ok()?;
                        let it = name.strip_prefix("ckpt-")?.strip_suffix(".tsck")?.parse::<u32>().ok()?;
                        Some((it, e.path()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    }

    /// Save the solver's state (see the module documentation).  Keeps at most 2 checkpoints: the older ones are
    /// removed before writing, so the disk holds at most the newest old one plus the one being written.
    pub fn save(&self, s: &Solver) -> std::io::Result<SaveInfo> {
        self.save_impl(s, None)
    }

    fn save_impl(&self, s: &Solver, fail_after: Option<u64>) -> std::io::Result<SaveInfo> {
        let t0 = Instant::now();
        let gens = self.generations();
        for (it, p) in &gens[..gens.len().saturating_sub(1)] {
            if *it != s.iters {
                std::fs::remove_file(p)?;
            }
        }
        let fp = state_fingerprint(s, &self.tag);
        let n_reg: u64 = s.regret.iter().map(|v| v.len() as u64).sum();
        let n_ss: u64 = s.ssum.iter().map(|v| v.len() as u64).sum();
        let path = self.dir.join(format!("ckpt-{:08}.tsck", s.iters));
        let tag = self.tag.as_bytes();
        let bytes = write_atomic(&path, &self.tmp(), fail_after, &mut |w, crc| {
            let mut head = Vec::new();
            head.extend_from_slice(CKPT_MAGIC);
            head.extend_from_slice(&VERSION.to_le_bytes());
            head.extend_from_slice(&fp.to_le_bytes());
            head.extend_from_slice(&s.iters.to_le_bytes());
            head.extend_from_slice(&s.avg_start().to_le_bytes());
            head.extend_from_slice(&n_reg.to_le_bytes());
            head.extend_from_slice(&n_ss.to_le_bytes());
            head.extend_from_slice(&(tag.len() as u32).to_le_bytes());
            head.extend_from_slice(tag);
            crc.update(&head);
            w.write_all(&head)?;
            let mut buf = Vec::with_capacity(CHUNK * 4);
            for v in &s.regret {
                write_f32s(w, crc, v, &mut buf)?;
            }
            for v in &s.ssum {
                write_f32s(w, crc, v, &mut buf)?;
            }
            Ok(())
        })?;
        // the older of the two that were kept, if a third one exists now
        let gens = self.generations();
        if gens.len() > 2 {
            for (_, p) in &gens[..gens.len() - 2] {
                std::fs::remove_file(p)?;
            }
        }
        Ok(SaveInfo { iters: s.iters, bytes, secs: t0.elapsed().as_secs_f32() })
    }

    /// Load one checkpoint into `s` (a solver of the same tree, options and ranges, just created).  On an error the
    /// solver's regrets and strategy sums may be partly overwritten; `load_latest` zeroes them again.
    fn load(&self, path: &Path, s: &mut Solver) -> Result<u32, String> {
        let file_len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        let mut r = BufReader::with_capacity(8 << 20, File::open(path).map_err(|e| e.to_string())?);
        let mut crc = Crc::default();
        let io = |e: std::io::Error| format!("read: {}", e);
        let mut magic = [0u8; 4];
        r.read_exact(&mut magic).map_err(io)?;
        crc.update(&magic);
        if &magic != CKPT_MAGIC {
            return Err("not a checkpoint".into());
        }
        let ver = read_u32(&mut r, &mut crc).map_err(io)?;
        if ver != VERSION {
            return Err(format!("version {}", ver));
        }
        let fp = read_u64(&mut r, &mut crc).map_err(io)?;
        let iters = read_u32(&mut r, &mut crc).map_err(io)?;
        let avg_start = read_u32(&mut r, &mut crc).map_err(io)?;
        let n_reg = read_u64(&mut r, &mut crc).map_err(io)?;
        let n_ss = read_u64(&mut r, &mut crc).map_err(io)?;
        let tag_len = read_u32(&mut r, &mut crc).map_err(io)? as usize;
        if tag_len > 1 << 16 {
            return Err("bad tag length".into());
        }
        let mut tag = vec![0u8; tag_len];
        r.read_exact(&mut tag).map_err(io)?;
        crc.update(&tag);
        if tag != self.tag.as_bytes() {
            return Err(format!("written by another run ({:?}, this run is {:?})", String::from_utf8_lossy(&tag), self.tag));
        }
        if fp != state_fingerprint(s, &self.tag) {
            return Err("tree / ranges / layout differ from this run (fingerprint)".into());
        }
        let want_reg: u64 = s.regret.iter().map(|v| v.len() as u64).sum();
        let want_ss: u64 = s.ssum.iter().map(|v| v.len() as u64).sum();
        if (n_reg, n_ss) != (want_reg, want_ss) {
            return Err("sizes differ".into());
        }
        let head = 4 + 4 + 8 + 4 + 4 + 8 + 8 + 4 + tag_len as u64;
        if file_len != head + 4 * (n_reg + n_ss) + 12 {
            return Err(format!("file has {} bytes, a complete checkpoint has {}", file_len, head + 4 * (n_reg + n_ss) + 12));
        }
        if avg_start > iters {
            return Err("bad counters".into());
        }
        let mut buf = Vec::with_capacity(CHUNK * 4);
        for v in s.regret.iter_mut() {
            read_f32s(&mut r, &mut crc, v, &mut buf).map_err(io)?;
        }
        for v in s.ssum.iter_mut() {
            read_f32s(&mut r, &mut crc, v, &mut buf).map_err(io)?;
        }
        check_trailer(&mut r, &crc, file_len)?;
        s.restore_counters(iters, avg_start);
        Ok(iters)
    }

    /// Continue `s` (a solver just created, at iteration 0) from the newest checkpoint that is complete and belongs to
    /// this run; a checkpoint that does not is skipped with a warning (`log`).  Returns the iteration reached, or
    /// `None` (no usable checkpoint: `s` is left at iteration 0 with zero regrets).
    pub fn load_latest(&self, s: &mut Solver, log: &mut dyn FnMut(&str)) -> Option<u32> {
        assert_eq!(s.iters, 0, "load into a new solver");
        if self.tmp().exists() {
            log(&format!("warning: {} is an unfinished save (the run stopped while writing it); removed", self.tmp().display()));
            let _ = std::fs::remove_file(self.tmp());
        }
        for (_, p) in self.generations().iter().rev() {
            let t0 = Instant::now();
            match self.load(p, s) {
                Ok(it) => {
                    log(&format!("resumed from {} (iteration {}, {:.1} s to load)", p.display(), it, t0.elapsed().as_secs_f32()));
                    return Some(it);
                }
                Err(e) => {
                    log(&format!("warning: checkpoint {} not used: {}", p.display(), e));
                    s.regret.iter_mut().chain(s.ssum.iter_mut()).for_each(|v| v.fill(0.0));
                    s.restore_counters(0, 0);
                }
            }
        }
        None
    }

    /// remove every checkpoint of the directory (and an unfinished save)
    pub fn clear(&self) -> std::io::Result<()> {
        for (_, p) in self.generations() {
            std::fs::remove_file(p)?;
        }
        if self.tmp().exists() {
            std::fs::remove_file(self.tmp())?;
        }
        Ok(())
    }
}

// ------------------------------------------------------------------ iterations

/// The iterations of a solve: `iters` in all, the strategy average restarted before iteration `reset_at + 1`
/// (`gen_postflop`'s `--avg-from`: `reset_at = iters * avg_from`), a checkpoint every `every` iterations (0 = none)
/// and after the last one.
#[derive(Clone, Copy, Debug)]
pub struct Plan {
    pub iters: u32,
    pub reset_at: Option<u32>,
    pub every: u32,
}

impl Plan {
    /// `gen_postflop`'s rule: restart the average when `i == (iters as f32 * avg_from) as u32`, if `avg_from > 0`
    pub fn new(iters: u32, avg_from: f32, every: u32) -> Plan {
        Plan { iters, reset_at: if avg_from > 0.0 { Some((iters as f32 * avg_from) as u32) } else { None }, every }
    }

    /// names the plan in a checkpoint's tag (a checkpoint of another plan is not loaded)
    pub fn tag(&self) -> String {
        format!("iters={} reset_at={:?}", self.iters, self.reset_at)
    }
}

/// The checkpoint tag of an all-card solve trained with `SolverOptions::tremble` (0: the tag as it always was), so
/// that a solve never continues the checkpoints of another tremble.
pub fn solve_tag(plan: &Plan, tremble: f32) -> String {
    let base = format!("all-cards {}", plan.tag());
    if tremble == 0.0 {
        base
    } else {
        format!("{} tremble={:e}", base, tremble)
    }
}

/// how a `run_iterations` call went
#[derive(Clone, Debug, Default)]
pub struct RunInfo {
    /// the iteration the run started from (0, or the checkpoint it resumed)
    pub resumed_from: u32,
    /// seconds per iteration of the iterations run by this call
    pub secs_per_iter: f32,
    pub saves: Vec<SaveInfo>,
    /// the run reached `plan.iters` (false: stopped by `stop_after`)
    pub finished: bool,
}

/// Run `s` to `plan.iters` iterations, resuming from `ck`'s newest checkpoint and saving to it as planned.  The
/// arithmetic is that of an uninterrupted `gen_postflop` loop, so the result does not depend on where it was
/// interrupted.  `stop_after` (tests, `--stop-after`) stops once that iteration is done, as a kill would (the
/// iterations since the last checkpoint are lost).
pub fn run_iterations(s: &mut Solver, plan: &Plan, ck: Option<&Checkpoints>, stop_after: Option<u32>, log: &mut dyn FnMut(&str)) -> std::io::Result<RunInfo> {
    let mut info = RunInfo::default();
    if let Some(ck) = ck {
        info.resumed_from = ck.load_latest(s, log).unwrap_or(0);
    }
    let t0 = Instant::now();
    let mut ran = 0u32;
    let mut t_save = 0f32;
    let mut last_log = Instant::now();
    while s.iters < plan.iters {
        let i = s.iters;
        if Some(i) == plan.reset_at {
            s.reset_average();
        }
        s.iterate();
        ran += 1;
        if stop_after.is_some_and(|x| s.iters >= x) {
            info.secs_per_iter = (t0.elapsed().as_secs_f32() - t_save) / ran as f32;
            return Ok(info);
        }
        if let Some(ck) = ck {
            if plan.every > 0 && s.iters.is_multiple_of(plan.every) && s.iters < plan.iters {
                let si = ck.save(s)?;
                t_save += si.secs;
                log(&format!("iteration {}: checkpoint {:.2} GB in {:.1} s", si.iters, si.bytes as f64 / 1e9, si.secs));
                info.saves.push(si);
            }
        }
        if last_log.elapsed().as_secs() >= 60 {
            last_log = Instant::now();
            log(&format!("iteration {} / {}: {:.2} s/iteration, peak RSS {}", s.iters, plan.iters, (t0.elapsed().as_secs_f32() - t_save) / ran as f32, fmt_gb(peak_rss_bytes())));
        }
    }
    if ran > 0 {
        info.secs_per_iter = (t0.elapsed().as_secs_f32() - t_save) / ran as f32;
    }
    if let Some(ck) = ck {
        // the end state too, so that a crash during the evaluation does not cost the solve
        if ck.generations().last().map(|g| g.0) != Some(s.iters) {
            let si = ck.save(s)?;
            log(&format!("iteration {}: final checkpoint {:.2} GB in {:.1} s", si.iters, si.bytes as f64 / 1e9, si.secs));
            info.saves.push(si);
        }
    }
    info.finished = true;
    Ok(info)
}

/// When `run_until` looks and gives up.
#[derive(Clone, Copy, Debug)]
pub struct Looks {
    /// the strategy average restarts before iteration `reset_at + 1`
    pub reset_at: u32,
    /// look every this many iterations (once past `reset_at`)
    pub check_every: u32,
    /// give up at this many iterations
    pub max_iters: u32,
    /// stop at the first value at most this
    pub target: f32,
}

/// How a `run_until` call went.
#[derive(Clone, Debug, Default)]
pub struct UntilInfo {
    /// the iteration the run started from (0, or the checkpoint it resumed)
    pub resumed_from: u32,
    /// the iteration count and the value (`measure`'s unit) at each evaluation of this call, in order
    pub history: Vec<(u32, f32)>,
    /// the last value was at most `target`
    pub reached: bool,
    /// seconds per iteration of the iterations run by this call (evaluations and saves not counted)
    pub secs_per_iter: f32,
}

/// Iterate `s` until `measure` (the all-card exploitability, say) is at most `target`, looking every `check_every`
/// iterations once the average has started (`reset_at`: the strategy average restarts before iteration `reset_at + 1`,
/// so the first look is at the first multiple of `check_every` after it), and give up at `max_iters`
/// (REFACTOR_PLAN 3-3-7: every 500 iterations, at most 5,000).  Saving to `ck` every `every` iterations (0 = none) and
/// before each evaluation, and resuming from its newest checkpoint, as `run_iterations`; the arithmetic is the same
/// as an uninterrupted run (`measure` must not change the solver's training state: `finalize_avg` and the
/// exploitability do not), so the strategy at iteration `n` does not depend on when it was looked at or interrupted.
/// A checkpoint's tag must not name the iteration count (the count is open-ended here).
pub fn run_until(s: &mut Solver, looks: &Looks, ck: Option<&Checkpoints>, every: u32, measure: &mut dyn FnMut(&mut Solver) -> f32, log: &mut dyn FnMut(&str)) -> std::io::Result<UntilInfo> {
    let Looks { reset_at, check_every, max_iters, target } = *looks;
    assert!(check_every > 0 && max_iters > 0);
    let mut info = UntilInfo::default();
    if let Some(ck) = ck {
        info.resumed_from = ck.load_latest(s, log).unwrap_or(0);
    }
    let t0 = Instant::now();
    let (mut ran, mut t_other) = (0u32, 0f32);
    let mut last_log = Instant::now();
    let mut measured_at = 0u32;
    loop {
        if s.iters > reset_at && s.iters.is_multiple_of(check_every) && measured_at != s.iters {
            measured_at = s.iters;
            let t = Instant::now();
            let v = measure(s);
            t_other += t.elapsed().as_secs_f32();
            info.history.push((s.iters, v));
            log(&format!("iteration {}: value {:.4} (target {:.4})", s.iters, v, target));
            if v <= target {
                info.reached = true;
                break;
            }
        }
        if s.iters >= max_iters {
            break;
        }
        let stop = (s.iters / check_every + 1).saturating_mul(check_every).min(max_iters);
        while s.iters < stop {
            if s.iters == reset_at {
                s.reset_average();
            }
            s.iterate();
            ran += 1;
            if let Some(ck) = ck {
                if every > 0 && s.iters.is_multiple_of(every) && s.iters < stop {
                    let si = ck.save(s)?;
                    t_other += si.secs;
                    log(&format!("iteration {}: checkpoint {:.2} GB in {:.1} s", si.iters, si.bytes as f64 / 1e9, si.secs));
                }
            }
            if last_log.elapsed().as_secs() >= 60 {
                last_log = Instant::now();
                log(&format!("iteration {} / {}: {:.2} s/iteration, peak RSS {}", s.iters, max_iters, (t0.elapsed().as_secs_f32() - t_other) / ran as f32, fmt_gb(peak_rss_bytes())));
            }
        }
        if let Some(ck) = ck {
            // before the evaluation: a crash in it (it takes about a minute and a lot of memory) does not cost the iterations
            if ck.generations().last().map(|g| g.0) != Some(s.iters) {
                let si = ck.save(s)?;
                t_other += si.secs;
                log(&format!("iteration {}: checkpoint {:.2} GB in {:.1} s", si.iters, si.bytes as f64 / 1e9, si.secs));
            }
        }
    }
    if ran > 0 {
        info.secs_per_iter = (t0.elapsed().as_secs_f32() - t_other) / ran as f32;
    }
    Ok(info)
}

// ------------------------------------------------------------------ values

/// Exploitability (chips, the sum of both best-response gains) of a solved all-card tree.
#[derive(Clone, Copy, Debug)]
pub struct AllCardsValues {
    /// the whole tree: average strategy on the flop and turn; on the river the average if the solver keeps it
    /// (`river_average`), else the current strategy
    pub full: f32,
    /// with `river_average`: the same with the river's current strategy (what a solve without river averages,
    /// plan B's precomputation `no_average_from: 2`, would measure)
    pub full_river_current: Option<f32>,
    /// the flop and turn locked to their average strategy, only the river best-responding
    pub river_only: f32,
}

/// Is the river's average kept by this solver (`ssum` on the river nodes)?
pub fn keeps_river_average(s: &Solver) -> bool {
    s.tree.nodes.iter().enumerate().any(|(i, n)| n.street == 2 && matches!(n.kind, PKind::Decision { .. }) && s.has_average(i))
}

/// The values of `AllCardsValues` (calls `finalize_avg`; the solver's locks are left as they were: none).
pub fn all_cards_values(s: &mut Solver) -> AllCardsValues {
    s.finalize_avg();
    let full = s.exploitability();
    let full_river_current = if keeps_river_average(s) {
        s.set_current_strategy_from(2);
        let v = s.exploitability();
        s.set_current_strategy_from(3);
        Some(v)
    } else {
        None
    };
    let up = upstream_of(s);
    for (i, st) in &up {
        s.lock_node(*i as usize, st.clone()).expect("a decision node");
    }
    let river_only = s.exploitability();
    for (i, _) in &up {
        s.unlock_node(*i as usize);
    }
    AllCardsValues { full, full_river_current, river_only }
}

// ------------------------------------------------------------------ the flop / turn strategies

/// the decision nodes that `Upstream` holds: the flop and turn ones
fn upstream_nodes(tree: &Tree) -> impl Iterator<Item = (usize, usize)> + '_ {
    tree.nodes.iter().enumerate().filter_map(|(i, n)| match &n.kind {
        PKind::Decision { children, .. } if n.street < 2 => Some((i, children.len())),
        _ => None,
    })
}

/// the average strategy (`na * NC`) of every flop and turn decision node (after `finalize_avg`)
pub fn upstream_of(s: &Solver) -> Vec<(u32, Vec<f32>)> {
    upstream_nodes(s.tree).map(|(i, _)| (i as u32, s.avg[i].clone())).collect()
}

/// The flop and turn strategies of an all-card solve, as written to / read from `upstream.tsup`.
pub struct Upstream {
    /// `tree_fingerprint` of the solver they come from
    pub tree: u64,
    /// the solve's plan and settings (informative; part of the re-solve's checkpoint tag through `crc`)
    pub tag: String,
    pub nodes: Vec<(u32, Vec<f32>)>,
    /// CRC-32 of the file
    pub crc: u32,
}

impl Upstream {
    pub fn write(path: &Path, tree: u64, tag: &str, nodes: &[(u32, Vec<f32>)]) -> std::io::Result<u64> {
        let tmp = path.with_extension("tmp");
        write_atomic(path, &tmp, None, &mut |w, crc| {
            let mut head = Vec::new();
            head.extend_from_slice(UP_MAGIC);
            head.extend_from_slice(&VERSION.to_le_bytes());
            head.extend_from_slice(&tree.to_le_bytes());
            head.extend_from_slice(&(tag.len() as u32).to_le_bytes());
            head.extend_from_slice(tag.as_bytes());
            head.extend_from_slice(&(nodes.len() as u32).to_le_bytes());
            crc.update(&head);
            w.write_all(&head)?;
            let mut buf = Vec::with_capacity(CHUNK * 4);
            for (i, st) in nodes {
                let mut h = Vec::new();
                h.extend_from_slice(&i.to_le_bytes());
                h.extend_from_slice(&((st.len() / NC) as u32).to_le_bytes());
                crc.update(&h);
                w.write_all(&h)?;
                write_f32s(w, crc, st, &mut buf)?;
            }
            Ok(())
        })
    }

    pub fn read(path: &Path) -> Result<Upstream, String> {
        let file_len = std::fs::metadata(path).map_err(|e| format!("{}: {}", path.display(), e))?.len();
        let mut r = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
        let mut crc = Crc::default();
        let io = |e: std::io::Error| format!("{}: {}", path.display(), e);
        let mut magic = [0u8; 4];
        r.read_exact(&mut magic).map_err(io)?;
        crc.update(&magic);
        if &magic != UP_MAGIC || read_u32(&mut r, &mut crc).map_err(io)? != VERSION {
            return Err(format!("{}: not an upstream file of this version", path.display()));
        }
        let tree = read_u64(&mut r, &mut crc).map_err(io)?;
        let tl = read_u32(&mut r, &mut crc).map_err(io)? as usize;
        if tl > 1 << 16 {
            return Err("bad tag length".into());
        }
        let mut tag = vec![0u8; tl];
        r.read_exact(&mut tag).map_err(io)?;
        crc.update(&tag);
        let n = read_u32(&mut r, &mut crc).map_err(io)? as usize;
        if (n as u64) * 8 > file_len {
            return Err("bad node count".into());
        }
        let mut nodes = Vec::with_capacity(n);
        let mut buf = Vec::new();
        for _ in 0..n {
            let i = read_u32(&mut r, &mut crc).map_err(io)?;
            let na = read_u32(&mut r, &mut crc).map_err(io)? as usize;
            if na == 0 || na > 16 {
                return Err("bad action count".into());
            }
            let mut st = vec![0f32; na * NC];
            read_f32s(&mut r, &mut crc, &mut st, &mut buf).map_err(io)?;
            nodes.push((i, st));
        }
        check_trailer(&mut r, &crc, file_len).map_err(|e| format!("{}: {}", path.display(), e))?;
        Ok(Upstream { tree, tag: String::from_utf8_lossy(&tag).into_owned(), nodes, crc: crc.finish() })
    }
}

// ------------------------------------------------------------------ the river re-solved

/// Lock every flop and turn decision node of `s` to the strategies of `up` (from a solver of the same tree and ranges).
pub fn lock_upstream(s: &mut Solver, up: &Upstream) -> Result<(), String> {
    if up.tree != tree_fingerprint(s) && Some(up.tree) != legacy_fingerprint(s.tree, &s.prior, &s.supports, &s.support_of) {
        return Err("the upstream strategies belong to another tree / scenario / ranges".into());
    }
    let want: Vec<(usize, usize)> = upstream_nodes(s.tree).collect();
    if want.len() != up.nodes.len() {
        return Err(format!("{} flop / turn nodes in the tree, {} in the file", want.len(), up.nodes.len()));
    }
    for ((i, na), (j, st)) in want.iter().zip(&up.nodes) {
        if *i != *j as usize || st.len() != na * NC {
            return Err(format!("node {} does not match the file", i));
        }
        s.lock_node(*i, st.clone())?;
    }
    Ok(())
}

/// The flop / turn strategies of `up`, checked against `tree` (fingerprint, node ids, action counts) and normalized as
/// `Solver::lock_node` plays them, by node.
fn upstream_strategies(tree: &Tree, ranges: &[Vec<f32>; 2], up: &Upstream) -> Result<HashMap<usize, Vec<f32>>, String> {
    let prior = starting_prior(tree, ranges);
    let (supports, support_of) = decision_supports(tree, &prior);
    if up.tree != fingerprint(tree, &prior, &supports, &support_of) && Some(up.tree) != legacy_fingerprint(tree, &prior, &supports, &support_of) {
        return Err("the upstream strategies belong to another tree / scenario / ranges".into());
    }
    let want: Vec<(usize, usize)> = upstream_nodes(tree).collect();
    if want.len() != up.nodes.len() {
        return Err(format!("{} flop / turn nodes in the tree, {} in the file", want.len(), up.nodes.len()));
    }
    let mut out = HashMap::with_capacity(want.len());
    for ((i, na), (j, st)) in want.iter().zip(&up.nodes) {
        if *i != *j as usize || st.len() != na * NC {
            return Err(format!("node {} does not match the file", i));
        }
        out.insert(*i, normalize_strategy(st.clone(), *na));
    }
    Ok(out)
}

/// The reach ranges at every river start of `tree` (REFACTOR_PLAN 3-3-5, `TSP1` v3) when the flop and turn play the
/// strategies of `up`, computed forward from the starting ranges without a `Solver` (so without the river's regrets).
/// They are bit for bit the ranges with which `resolve_river` (flop and turn locked to `up`) solves each river, i.e. the
/// ranges the device re-solves the river from (test `upstream_ranges_are_the_ranges_of_the_resolve`).
pub fn upstream_river_starts(tree: &Tree, ranges: &[Vec<f32>; 2], up: &Upstream) -> Result<Vec<RiverStart>, String> {
    let st = upstream_strategies(tree, ranges, up)?;
    river_starts(tree, &starting_prior(tree, ranges), &|i| st.get(&i).map(|v| v.as_slice()))
}

/// The flop / turn strategies of `up`, written by a solve of `from` (e.g. the 49 x 48 tree), for `to`: a tree of the
/// same flop, configuration and ranges except the river cards (e.g. 49 x 2), whose flop and turn are those of `from`
/// node for node but numbered otherwise.  Lets a small tree play the strategies of a big solve (`measure_exploit
/// --upstream-river-cards`).  The result's fingerprint is `to`'s.
pub fn upstream_onto(up: &Upstream, from: &Tree, ranges: &[Vec<f32>; 2], to: &Tree) -> Result<Upstream, String> {
    upstream_strategies(from, ranges, up)?;
    let (a, b): (Vec<_>, Vec<_>) = (upstream_nodes(from).collect(), upstream_nodes(to).collect());
    if a.len() != b.len() {
        return Err(format!("{} flop / turn decision nodes in one tree, {} in the other", a.len(), b.len()));
    }
    let mut nodes = Vec::with_capacity(b.len());
    for (((i, na), (j, nb)), (_, st)) in a.iter().zip(&b).zip(&up.nodes) {
        let (x, y) = (&from.nodes[*i], &to.nodes[*j]);
        let same = na == nb
            && x.street == y.street
            && x.board == y.board
            && x.inv == y.inv
            && match (&x.kind, &y.kind) {
                (PKind::Decision { player: p, acts: aa, .. }, PKind::Decision { player: q, acts: ab, .. }) => p == q && aa.iter().zip(ab).all(|(u, v)| u.kind == v.kind && u.amount == v.amount),
                _ => false,
            };
        if !same {
            return Err(format!("node {} of the solved tree and node {} of the other differ", i, j));
        }
        nodes.push((*j as u32, st.clone()));
    }
    Ok(Upstream { tree: tree_fingerprint_of(to, ranges), tag: format!("{} (onto another tree)", up.tag), nodes, crc: up.crc })
}

/// The river tree that the device solves for river start `start` of `tree` and river card `card`: the 5 card board,
/// the pot of the river start (`pot + inv0 + inv1`) and the stack behind (`stack - inv0`), the tree's bet settings.  It
/// is the river subtree of `tree` node for node (checked by `resolve_rivers_alone`); its payoffs leave out the chips
/// put in before the river (a constant per player, which changes no strategy).
pub fn river_tree_of(tree: &Tree, start: usize, card: u8) -> Tree {
    let n = &tree.nodes[start];
    assert!(is_river_start(n), "node {} is not a river start", start);
    assert!((n.inv[0] - n.inv[1]).abs() < 1e-6, "a street starts with equal investments");
    let cfg = Config { pot: tree.cfg.pot + n.inv[0] + n.inv[1], stack: tree.cfg.stack - n.inv[0], ..tree.cfg.clone() };
    let mut b = n.board.clone();
    b.push(card);
    build_tree(&cfg, &b)
}

/// does `alone` (from `river_tree_of`) have the shape of the subtree of `tree` at `root`
fn same_river_subtree(tree: &Tree, root: usize, alone: &Tree) -> bool {
    alone.nodes.iter().enumerate().all(|(k, a)| {
        let Some(t) = tree.nodes.get(root + k) else { return false };
        a.street == t.street
            && a.board == t.board
            && match (&a.kind, &t.kind) {
                (PKind::Decision { player: p, acts: x, children: cx }, PKind::Decision { player: q, acts: y, children: cy }) => {
                    p == q && x.len() == y.len() && x.iter().zip(y).all(|(u, v)| u.kind == v.kind && u.amount == v.amount) && cx.iter().zip(cy).all(|(&c, &d)| c as usize + root == d as usize)
                }
                (PKind::Fold { winner: u }, PKind::Fold { winner: v }) => u == v,
                (PKind::Showdown { .. }, PKind::Showdown { .. }) => true,
                _ => false,
            }
    })
}

/// The values of `resolve_rivers_alone` (chips).
#[derive(Clone, Copy, Debug)]
pub struct AloneValues {
    /// flop and turn locked: only the river best-responds
    pub river_only: f32,
    /// no lock: both players best-respond everywhere against "upstream + the rivers solved alone"
    pub full: f32,
    /// river subgames solved
    pub subgames: usize,
}

/// Plan B as the device plays it (REFACTOR_PLAN 3-3-5 / 3-3-6): the flop and turn play `up`, and every river subgame of
/// `tree` (each river start x each river card of the tree) is solved **on its own** (`river_tree_of`, `plan`'s iterations
/// and restart of the average) from the ranges `start_ranges` gives for its river start (the river card's combos set to
/// 0 here), then measured over the whole tree as `resolve_river` measures.  With `start_ranges` = the exact ranges
/// (`RiverStart::ranges`) this is `resolve_river` up to rounding (the subgames are independent once the flop and turn
/// are fixed); with the ranges read from a `TSP1` v3 file it measures what the file's quantization costs.  Memory: a
/// solver of `tree` with every average stored (small trees only, e.g. 49 x 2).
pub fn resolve_rivers_alone(tree: &Tree, ranges: &[Vec<f32>; 2], up: &Upstream, plan: &Plan, start_ranges: &dyn Fn(&RiverStart) -> [Vec<f32>; 2], log: &mut dyn FnMut(&str)) -> Result<AloneValues, String> {
    let starts = upstream_river_starts(tree, ranges, up)?;
    let mut s = Solver::new(tree, ranges);
    s.finalize_avg();
    let st = upstream_strategies(tree, ranges, up)?;
    for (&i, v) in &st {
        s.avg[i] = v.clone();
    }
    let t0 = Instant::now();
    let mut last = Instant::now();
    let mut subgames = 0;
    for (k, rs) in starts.iter().enumerate() {
        let r = start_ranges(rs);
        let PKind::Chance { cards, children, .. } = &tree.nodes[rs.node as usize].kind else { unreachable!() };
        for (&c, &ch) in cards.iter().zip(children) {
            let alone_tree = river_tree_of(tree, rs.node as usize, c);
            if !same_river_subtree(tree, ch as usize, &alone_tree) {
                return Err(format!("river start {} card {}: the river tree differs from the subtree", rs.node, c));
            }
            let mut a = Solver::new(&alone_tree, &[zero_card(&r[0], c), zero_card(&r[1], c)]);
            run_iterations(&mut a, plan, None, None, &mut |_| {}).map_err(|e| e.to_string())?;
            a.finalize_avg();
            for (j, v) in a.avg.into_iter().enumerate() {
                if !v.is_empty() {
                    s.avg[ch as usize + j] = v;
                }
            }
            subgames += 1;
        }
        if last.elapsed().as_secs() >= 60 {
            last = Instant::now();
            log(&format!("rivers solved alone: {} / {} river starts, {} subgames, {:.0} s", k + 1, starts.len(), subgames, t0.elapsed().as_secs_f32()));
        }
    }
    let full = s.exploitability();
    for (&i, v) in &st {
        s.lock_node(i, v.clone())?;
    }
    let river_only = s.exploitability();
    Ok(AloneValues { river_only, full, subgames })
}

/// The value of a river re-solve (chips).
#[derive(Clone, Copy, Debug)]
pub struct ResolveValues {
    /// flop and turn locked: only the river best-responds (`docs/14` §3: what a locked measure can show)
    pub river_only: f32,
    /// locks removed: both players best-respond everywhere against "upstream strategy + re-solved river average"
    pub full: f32,
    /// `full` by player (OOP, IP): the gain of that player's best response alone; `full` is their sum
    pub full_by_player: [f32; 2],
}

/// The re-solve's checkpoint tag (`eps`: `resolve_river_eps`; 0 gives the tag of `resolve_river`)
pub fn resolve_tag(plan: &Plan, up: &Upstream, eps: f32) -> String {
    let base = format!("resolve-river {} upstream={:08x}", plan.tag(), up.crc);
    if eps == 0.0 {
        base
    } else {
        format!("{} eps={:e}", base, eps)
    }
}

/// The strategies of `up` with a tremble: at every flop / turn decision node and for every hand,
/// `sigma' = (1 - eps) sigma + eps u`, `u` uniform over the actions that keep the hand going (check / call and
/// bet / raise; not fold, not all-in).  With them every river start is reached by a thin slice of the whole range
/// of each player, whatever `up` plays (`docs/14` §8-1, `--resolve-eps`).
pub fn tremble_upstream(tree: &Tree, up: &Upstream, eps: f32) -> Result<Upstream, String> {
    if !(0.0..=1.0).contains(&eps) {
        return Err(format!("eps {} is not in 0..=1", eps));
    }
    let mut nodes = up.nodes.clone();
    for (i, st) in nodes.iter_mut() {
        let Some(PKind::Decision { acts, .. }) = tree.nodes.get(*i as usize).map(|n| &n.kind) else {
            return Err(format!("node {} is not a decision node", i));
        };
        let na = acts.len();
        if st.len() != na * NC {
            return Err(format!("node {} does not match the file", i));
        }
        *st = normalize_strategy(std::mem::take(st), na);
        tremble_strategy(st, acts, eps);
    }
    Ok(Upstream { tree: up.tree, tag: up.tag.clone(), nodes, crc: up.crc })
}

/// Re-solve the river of `s` (a new solver whose river averages are kept, e.g. `avg_on_demand_from: 2`) for
/// `plan.iters` iterations from zero with the flop and turn locked to `up`, then measure.  Resumes from / saves to
/// `ck` like `run_iterations`.  `None` if stopped by `stop_after`.  The locks are removed at the end, and the flop and
/// turn nodes' `avg` holds the locked strategies.
pub fn resolve_river(s: &mut Solver, up: &Upstream, plan: &Plan, ck: Option<&Checkpoints>, stop_after: Option<u32>, log: &mut dyn FnMut(&str)) -> Result<(Option<ResolveValues>, RunInfo), String> {
    resolve_river_eps(s, up, 0.0, plan, ck, stop_after, log)
}

/// `resolve_river` with the river's reach ranges taken from a trembling copy of the flop / turn strategies: during
/// the iterations the flop and turn are locked to `tremble_upstream(up, eps)`; the values are then measured with the
/// strategies of `up` themselves (locked for `river_only`, unlocked for `full`), so they are those of
/// "`up` + the rivers re-solved from the trembling reach".  `eps` 0 is `resolve_river`, bit for bit.  `ck`'s tag
/// must be `resolve_tag(plan, up, eps)`.
pub fn resolve_river_eps(s: &mut Solver, up: &Upstream, eps: f32, plan: &Plan, ck: Option<&Checkpoints>, stop_after: Option<u32>, log: &mut dyn FnMut(&str)) -> Result<(Option<ResolveValues>, RunInfo), String> {
    if !keeps_river_average(s) {
        return Err("the re-solve needs the river averages (avg_on_demand_from: 2, no_average_from: 3)".into());
    }
    if eps == 0.0 {
        lock_upstream(s, up)?;
    } else {
        lock_upstream(s, &tremble_upstream(s.tree, up, eps)?)?;
    }
    let info = run_iterations(s, plan, ck, stop_after, log).map_err(|e| e.to_string())?;
    if !info.finished {
        return Ok((None, info));
    }
    if eps != 0.0 {
        // measure with the strategies of `up`, not the trembling ones the river was solved against
        lock_upstream(s, up)?;
    }
    s.finalize_avg();
    let river_only = s.exploitability();
    for (i, _) in upstream_nodes(s.tree).collect::<Vec<_>>() {
        let st = s.locked_strategy(i).expect("locked").to_vec();
        s.avg[i] = st;
        s.unlock_node(i);
    }
    let full_by_player = s.exploitability_by_player();
    let full = full_by_player[0] + full_by_player[1];
    Ok((Some(ResolveValues { river_only, full, full_by_player }), info))
}

// ------------------------------------------------------------------ where the exploitability sits

/// The gain of a best response that may deviate in the subtree of one flop decision node (`breakdown`).
#[derive(Clone, Debug)]
pub struct NodeGain {
    pub node: u32,
    /// 0 OOP, 1 IP: the player who decides at `node` and who best-responds
    pub player: u8,
    /// the actions from the root to `node` (`f` fold, `c` check / call, `b<amount>` bet / raise, `a` all-in), `-` apart
    pub path: String,
    /// chips
    pub gain: f32,
}

/// Where the exploitability of a re-solved tree (`resolve_river`) sits, by the nodes a best response may deviate at
/// (the player's other flop and turn nodes keep their strategies; chips).  `river` is the river alone (what
/// `ResolveValues::river_only` sums), `turn` the river and the player's turn nodes, `full` everything.  The
/// differences between them are what the flop and turn decisions add.  `flop_nodes` frees the river and the subtree
/// of one flop decision node of the player at a time (a gain of a deviation that starts there or later: the gains of
/// different nodes overlap, so they do not add up to `full`).
#[derive(Clone, Debug)]
pub struct Breakdown {
    pub river: [f32; 2],
    pub turn: [f32; 2],
    pub full: [f32; 2],
    pub flop_nodes: Vec<NodeGain>,
}

fn act_label(a: &ActInfo) -> String {
    match a.kind {
        0 => "f".into(),
        1 => "c".into(),
        2 => format!("b{}", a.amount),
        _ => "a".into(),
    }
}

/// The flop decision nodes with the actions that lead to them from the root: (node, player, path).
fn flop_decisions(tree: &Tree) -> Vec<(usize, u8, String)> {
    let mut is_child = vec![false; tree.nodes.len()];
    for n in &tree.nodes {
        if let PKind::Decision { children, .. } | PKind::Chance { children, .. } = &n.kind {
            for &c in children {
                is_child[c as usize] = true;
            }
        }
    }
    let mut out = Vec::new();
    let mut stack: Vec<(usize, Vec<String>)> = (0..tree.nodes.len()).filter(|&i| !is_child[i]).map(|i| (i, Vec::new())).collect();
    while let Some((i, path)) = stack.pop() {
        let n = &tree.nodes[i];
        if let (PKind::Decision { player, acts, children }, 0) = (&n.kind, n.street) {
            out.push((i, *player, path.join("-")));
            for (a, &c) in acts.iter().zip(children) {
                let mut p = path.clone();
                p.push(act_label(a));
                stack.push((c as usize, p));
            }
        }
    }
    out.sort_by_key(|(i, _, _)| *i);
    out
}

/// the nodes of the subtree of `root` (including it)
fn subtree(tree: &Tree, root: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(i) = stack.pop() {
        out.push(i);
        if let PKind::Decision { children, .. } | PKind::Chance { children, .. } = &tree.nodes[i].kind {
            stack.extend(children.iter().map(|&c| c as usize));
        }
    }
    out
}

/// lock every flop / turn node of `ups` to its strategy `avg`, except those `free` returns true for
fn relock(s: &mut Solver, ups: &[(usize, usize)], free: &dyn Fn(usize) -> bool) -> Result<(), String> {
    for &(i, _) in ups {
        if free(i) {
            s.unlock_node(i);
        } else {
            let st = s.avg[i].clone();
            s.lock_node(i, st)?;
        }
    }
    Ok(())
}

/// Measure where the exploitability of `s` sits (`Breakdown`).  `s` is a solver right after `resolve_river` /
/// `resolve_river_eps`: the flop and turn nodes' `avg` hold the strategies they were locked to, the locks are removed,
/// and the river averages are kept.  The locks are removed again at the end.  One best response is about as slow as
/// the exploitability's (a few tens of seconds at 49 x 48), and there are 6 + (the player's flop decision nodes).
pub fn breakdown(s: &mut Solver, log: &mut dyn FnMut(&str)) -> Result<Breakdown, String> {
    let tree = s.tree;
    let ups: Vec<(usize, usize)> = upstream_nodes(tree).collect();
    for &(i, na) in &ups {
        if s.avg.get(i).map(|a| a.len()) != Some(na * NC) {
            return Err(format!("node {} has no strategy in `avg` (run it right after the re-solve)", i));
        }
    }
    let street_player = |i: usize| match &tree.nodes[i].kind {
        PKind::Decision { player, .. } => (tree.nodes[i].street, *player as usize),
        _ => unreachable!("upstream nodes are decision nodes"),
    };
    let t0 = Instant::now();
    let base = s.root_values();
    let mut measure = |s: &mut Solver, p: usize, what: &str, free: &dyn Fn(usize) -> bool| -> Result<f32, String> {
        relock(s, &ups, free)?;
        let g = s.best_response_gain(p, base);
        log(&format!("[{:.0}s] breakdown: player {} {}: {:.5} chips", t0.elapsed().as_secs_f32(), p, what, g));
        Ok(g)
    };
    let (mut river, mut turn, mut full) = ([0f32; 2], [0f32; 2], [0f32; 2]);
    for p in 0..2 {
        river[p] = measure(s, p, "river", &|_| false)?;
        turn[p] = measure(s, p, "river + turn", &|i| street_player(i) == (1, p))?;
        full[p] = measure(s, p, "everywhere", &|i| street_player(i).1 == p)?;
    }
    let mut flop_nodes = Vec::new();
    for (node, player, path) in flop_decisions(tree) {
        let mut in_subtree = vec![false; tree.nodes.len()];
        for i in subtree(tree, node) {
            in_subtree[i] = true;
        }
        let p = player as usize;
        let gain = measure(s, p, &format!("from node {} ({})", node, path), &|i| in_subtree[i] && street_player(i).1 == p)?;
        flop_nodes.push(NodeGain { node: node as u32, player, path, gain });
    }
    for &(i, _) in &ups {
        s.unlock_node(i);
    }
    Ok(Breakdown { river, turn, full, flop_nodes })
}

// ------------------------------------------------------------------ the best response within the dealt lines

/// The best-response gains of a re-solved tree when the best response may deviate only within the lines the app
/// deals (`docs/14` §11-9).  chips, OOP / IP.
///
/// A line is dealt when the TSP1 v3 file keeps it (`dealt_nodes`: reach given the dealt cards >= `min_reach`, and
/// every line above it dealt).  The best response may deviate at the player's dealt flop / turn nodes and at the
/// river, and may not choose an action that leaves the dealt lines (a node that is not dealt, a river start that is
/// not dealt, but it may still play the node's strategy, which can enter such a line); the player's strategy at the
/// nodes that are not dealt, and the other player's everywhere, are as they are.  `river` / `turn` / `full` are as in
/// `Breakdown` (the river alone, + the dealt turn nodes, + the dealt flop nodes); `full_raw` is `full` without the
/// clamp at 0 (below 0 by rounding only).
#[derive(Clone, Debug)]
pub struct DealtGain {
    pub river: [f32; 2],
    pub turn: [f32; 2],
    pub full: [f32; 2],
    pub full_raw: [f32; 2],
    /// the flop and turn decision nodes, and how many of them are dealt
    pub upstream_decisions: usize,
    pub dealt_decisions: usize,
    /// the probability that a pair of hands plays into a line that is not dealt, from a dealt node (the lines the
    /// app does not show, as a share of all hands)
    pub undealt_reach: f64,
}

/// the probability of the line of `node` (a decision node's reach, a river start's, the sum of a chance node's cards)
fn line_reach(tree: &Tree, ev: &[Option<NodeEval>], starts: &HashMap<usize, &RiverStart>, node: usize) -> f64 {
    let n = &tree.nodes[node];
    match &n.kind {
        PKind::Decision { .. } => ev[node].as_ref().map_or(0.0, |e| e.reach as f64),
        PKind::Chance { .. } if is_river_start(n) => starts.get(&node).map_or(0.0, |s| s.reach as f64),
        PKind::Chance { children, .. } => children.iter().map(|&c| line_reach(tree, ev, starts, c as usize)).sum(),
        _ => 0.0,
    }
}

/// Measure the best response within the dealt lines (`DealtGain`).  `s` is a solver right after `resolve_river` /
/// `resolve_river_eps`, as for `breakdown` (the flop / turn nodes' `avg` hold the strategies they were locked to,
/// the locks are removed).  Takes the evaluation of the flop and turn nodes (`Solver::evaluate_upstream`) and six
/// best responses.  The locks and the forbidden actions are removed at the end.
pub fn dealt_breakdown(s: &mut Solver, min_reach: f32, log: &mut dyn FnMut(&str)) -> Result<DealtGain, String> {
    let tree = s.tree;
    let ups: Vec<(usize, usize)> = upstream_nodes(tree).collect();
    for &(i, na) in &ups {
        if s.avg.get(i).map(|a| a.len()) != Some(na * NC) {
            return Err(format!("node {} has no strategy in `avg` (run it right after the re-solve)", i));
        }
    }
    let t0 = Instant::now();
    let ev = s.evaluate_upstream();
    let starts = s.river_starts()?;
    let start_of: HashMap<usize, &RiverStart> = starts.iter().map(|x| (x.node as usize, x)).collect();
    let dealt = dealt_nodes(tree, &ev, Some(&starts), min_reach);
    // the actions that leave the dealt lines, per node
    let mut forbid = vec![0u64; tree.nodes.len()];
    let mut undealt_reach = 0f64;
    for &(i, _) in &ups {
        if !dealt[i] {
            continue;
        }
        let PKind::Decision { children, .. } = &tree.nodes[i].kind else { unreachable!("upstream nodes are decision nodes") };
        for (a, &c) in children.iter().enumerate() {
            let c = c as usize;
            let leaves = matches!(tree.nodes[c].kind, PKind::Decision { .. } | PKind::Chance { .. }) && !dealt[c];
            if leaves {
                forbid[i] |= 1 << a;
                undealt_reach += line_reach(tree, &ev, &start_of, c);
            }
        }
    }
    let dealt_decisions = ups.iter().filter(|&&(i, _)| dealt[i]).count();
    log(&format!("[{:.0}s] dealt lines: {} of {} flop / turn nodes; {:.5} of the hands leave them", t0.elapsed().as_secs_f32(), dealt_decisions, ups.len(), undealt_reach));
    let street_player = |i: usize| match &tree.nodes[i].kind {
        PKind::Decision { player, .. } => (tree.nodes[i].street, *player as usize),
        _ => unreachable!("upstream nodes are decision nodes"),
    };
    let base = s.root_values();
    s.set_br_forbidden(forbid);
    let mut measure = |s: &mut Solver, p: usize, what: &str, free: &dyn Fn(usize) -> bool| -> Result<f32, String> {
        relock(s, &ups, free)?;
        let g = s.best_response_delta(p, base);
        log(&format!("[{:.0}s] dealt: player {} {}: {:.5} chips", t0.elapsed().as_secs_f32(), p, what, g));
        Ok(g)
    };
    let (mut river, mut turn, mut full, mut full_raw) = ([0f32; 2], [0f32; 2], [0f32; 2], [0f32; 2]);
    for p in 0..2 {
        river[p] = measure(s, p, "river", &|_| false)?.max(0.0);
        turn[p] = measure(s, p, "river + dealt turn", &|i| dealt[i] && street_player(i) == (1, p))?.max(0.0);
        full_raw[p] = measure(s, p, "everywhere dealt", &|i| dealt[i] && street_player(i).1 == p)?;
        full[p] = full_raw[p].max(0.0);
    }
    s.set_br_forbidden(Vec::new());
    for &(i, _) in &ups {
        s.unlock_node(i);
    }
    Ok(DealtGain { river, turn, full, full_raw, upstream_decisions: ups.len(), dealt_decisions, undealt_reach })
}

// ------------------------------------------------------------------ memory

/// the process's peak resident set in bytes (VmHWM of /proc/self/status; `None` where there is none)
pub fn peak_rss_bytes() -> Option<u64> {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmHWM:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|kb| kb.parse::<u64>().ok()))
        .map(|kb| kb * 1024)
}

/// "1.23 GB" (10^9 bytes) or "?"
pub fn fmt_gb(b: Option<u64>) -> String {
    b.map(|b| format!("{:.2} GB", b as f64 / 1e9)).unwrap_or_else(|| "?".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measure::{Assign, FullBr};
    use crate::rng::Rng;

    fn card(s: &str) -> u8 {
        let b = s.as_bytes();
        let r = b"23456789TJQKA".iter().position(|&x| x == b[0]).unwrap() as u8;
        let su = b"cdhs".iter().position(|&x| x == b[1]).unwrap() as u8;
        r * 4 + su
    }
    fn board(s: &str) -> Vec<u8> {
        s.split_whitespace().map(card).collect()
    }

    /// deterministic ranges with partial weights and ~40 % of the combos outside the range (as in postflop's tests)
    fn mixed_ranges(seed: u64) -> [Vec<f32>; 2] {
        let mut rng = Rng::new(seed);
        let mut one = || {
            (0..NC)
                .map(|_| {
                    let x = rng.below(10);
                    if x < 4 {
                        0.0
                    } else {
                        x as f32 / 9.0
                    }
                })
                .collect::<Vec<f32>>()
        };
        [one(), one()]
    }

    /// a small flop tree: 5 turn cards x 2 river cards, flop all-ins over 24 run-outs
    fn small_flop() -> Tree {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        build_tree(&cfg, &board("Ks 7d 2c"))
    }

    /// a turn tree with every river card
    fn turn_tree() -> Tree {
        let cfg = Config { pot: 8.0, stack: 20.0, bets: [vec![], vec![0.5], vec![0.75]], raise_sizes: [false; 3], allow_allin: true, river_cards: 48, ..Config::default() };
        build_tree(&cfg, &board("Ks 9h 5h 2d"))
    }

    /// a flop tree with every card (49 x 48, every flop run-out), kept small by its bets (a river bet, so that the
    /// river's average and current strategies differ)
    fn all_card_flop() -> Tree {
        let cfg = Config { pot: 6.0, stack: 9.0, bets: [vec![0.5], vec![], vec![0.5]], raise_sizes: [false; 3], allow_allin: true, turn_cards: 49, river_cards: 48, flop_runouts: 1176, ..Config::default() };
        build_tree(&cfg, &board("Qs Jd 6s"))
    }

    fn on_demand(threads: usize) -> SolverOptions {
        SolverOptions { avg_on_demand_from: 2, threads, ..Default::default() }
    }

    fn solve<'t>(tree: &'t Tree, ranges: &[Vec<f32>; 2], opts: SolverOptions, iters: u32) -> Solver<'t> {
        let mut s = Solver::with_options(tree, ranges, opts);
        run_iterations(&mut s, &Plan::new(iters, 0.5, 0), None, None, &mut |_| {}).unwrap();
        s
    }

    fn bits(v: &[Vec<f32>]) -> Vec<u32> {
        v.iter().flat_map(|x| std::iter::once(x.len() as u32).chain(x.iter().map(|y| y.to_bits()))).collect()
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-4 + 1e-4 * a.abs().max(b.abs())
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("tessera-allcards-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn crc32_of_the_check_string() {
        let mut c = Crc::default();
        c.update(b"123456789");
        assert_eq!(c.finish(), 0xCBF4_3926);
        // split anywhere, same value
        let data: Vec<u8> = (0..1000u32).map(|i| (i * 7 + 3) as u8).collect();
        let mut a = Crc::default();
        a.update(&data);
        for cut in [0, 1, 7, 8, 9, 500, 999] {
            let mut b = Crc::default();
            b.update(&data[..cut]);
            b.update(&data[cut..]);
            assert_eq!(a.finish(), b.finish());
        }
    }

    /// (d) the average made on demand from `ssum` is bit for bit the stored one, for every value a caller reads
    #[test]
    fn averages_on_demand_equal_the_stored_ones() {
        let (mut stored, mut made) = (0, 0);
        for (tree, iters) in [(small_flop(), 30), (turn_tree(), 30)] {
            let ranges = mixed_ranges(5);
            let mut full = solve(&tree, &ranges, SolverOptions::default(), iters);
            full.finalize_avg();
            for opts in [on_demand(1), on_demand(3), SolverOptions { avg_on_demand_from: 1, ..Default::default() }] {
                let mut s = solve(&tree, &ranges, opts, iters);
                s.finalize_avg();
                assert_eq!(bits(&s.regret), bits(&full.regret));
                assert_eq!(bits(&s.ssum), bits(&full.ssum));
                for (i, n) in tree.nodes.iter().enumerate() {
                    if let PKind::Decision { .. } = n.kind {
                        if n.street >= opts.avg_on_demand_from {
                            assert!(s.avg[i].is_empty(), "no stored average from street {}", opts.avg_on_demand_from);
                            made += 1;
                        } else {
                            assert_eq!(s.avg[i], full.avg[i]);
                            stored += 1;
                        }
                    }
                }
                assert_eq!(s.exploitability().to_bits(), full.exploitability().to_bits());
                assert_eq!(s.root_values().map(f32::to_bits), full.root_values().map(f32::to_bits));
                let (ea, eb) = (s.evaluate(), full.evaluate());
                for (a, b) in ea.iter().zip(&eb) {
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            assert_eq!((a.player, a.reach.to_bits()), (b.player, b.reach.to_bits()));
                            for (x, y) in [(&a.weight, &b.weight), (&a.freq, &b.freq), (&a.ev, &b.ev), (&a.eq, &b.eq)] {
                                assert_eq!(x.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), y.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
                            }
                        }
                        (None, None) => {}
                        _ => panic!("evaluated on one side only"),
                    }
                }
                assert_eq!(export(&tree, &ea, 0.0), export(&tree, &eb, 0.0));
            }
            // the river's current strategy is another value (the comparison would not see a mix-up otherwise)
            let mut cur = solve(&tree, &ranges, on_demand(1), iters);
            cur.finalize_avg();
            cur.set_current_strategy_from(2);
            assert_ne!(cur.exploitability().to_bits(), full.exploitability().to_bits());
        }
        assert!(stored > 100 && made > 100, "{} stored, {} made on demand", stored, made);
    }

    /// (a) the all-card value of an all-card tree is `Solver::exploitability` (every average stored, 1 thread), bit for
    /// bit; 3-0's independent full-card best response (`FullBr`) agrees to rounding (it adds in another order)
    #[test]
    fn all_card_values_match_solver_exploitability() {
        for (tree, iters) in [(turn_tree(), 40), (all_card_flop(), 12)] {
            let ranges = mixed_ranges(7);
            let mut reference = solve(&tree, &ranges, SolverOptions::default(), iters);
            reference.finalize_avg();
            let want = reference.exploitability();
            let mut s = solve(&tree, &ranges, on_demand(3), iters);
            let v = all_cards_values(&mut s);
            assert_eq!(v.full.to_bits(), want.to_bits(), "{} vs {}", v.full, want);
            let br = FullBr::new(&tree, &reference.avg, &reference.prior, Assign::Nearest).exploitability();
            assert!(close(br.chips, v.full), "FullBr {} vs {}", br.chips, v.full);
            assert!(v.full > 0.01, "an unconverged strategy: {}", v.full);
            // the river's current strategy: the value of a solve without river averages (no_average_from: 2)
            let mut b = solve(&tree, &ranges, SolverOptions { no_average_from: 2, threads: 2, ..Default::default() }, iters);
            let vb = all_cards_values(&mut b);
            assert_eq!(v.full_river_current.unwrap().to_bits(), vb.full.to_bits());
            assert!(vb.full_river_current.is_none());
            assert_ne!(vb.full.to_bits(), v.full.to_bits());
            // only the river best-responding gains less than everything best-responding
            assert!(v.river_only > 0.0 && v.river_only <= v.full + 1e-6, "{} vs {}", v.river_only, v.full);
            assert!(s.locked_strategy(0).is_none(), "locks removed");
        }
    }

    type State = (Vec<u32>, Vec<u32>, Vec<u32>, u32, u32, u32);

    fn state(s: &mut Solver) -> State {
        s.finalize_avg();
        let e = s.exploitability().to_bits();
        (bits(&s.regret), bits(&s.ssum), bits(&s.avg), e, s.iters, s.avg_start())
    }

    /// (b) stopping (as a kill would, after the last checkpoint) and resuming ends bit for bit where an uninterrupted
    /// run ends: regrets, strategy sums, averages, exploitability, counters; also with another thread count, across
    /// the restart of the average, from an older generation when the newest is damaged, and never from another run
    #[test]
    fn resuming_from_a_checkpoint_gives_the_same_bits() {
        let tree = small_flop();
        let ranges = mixed_ranges(3);
        let plan = Plan::new(30, 0.5, 7);
        let mut cont = Solver::new(&tree, &ranges);
        run_iterations(&mut cont, &plan, None, None, &mut |_| {}).unwrap();
        let want = state(&mut cont);
        assert_eq!(want.5, 15);

        for (stop, threads) in [(17, 1), (10, 2), (29, 1)] {
            let dir = tmp_dir(&format!("resume-{}", stop));
            let ck = Checkpoints::new(&dir, plan.tag()).unwrap();
            let mut a = Solver::new(&tree, &ranges);
            let info = run_iterations(&mut a, &plan, Some(&ck), Some(stop), &mut |_| {}).unwrap();
            assert!(!info.finished);
            let saved = stop / 7 * 7;
            assert_eq!(ck.generations().last().unwrap().0, saved);
            assert!(ck.generations().len() <= 2, "two generations at most");
            drop(a);
            let mut b = Solver::with_options(&tree, &ranges, SolverOptions { threads, ..Default::default() });
            let mut log = Vec::new();
            let info = run_iterations(&mut b, &plan, Some(&ck), None, &mut |m| log.push(m.to_string())).unwrap();
            assert_eq!(info.resumed_from, saved, "{:?}", log);
            assert!(info.finished);
            assert!(state(&mut b) == want, "stopped after {}, resumed from {}: different bits", stop, saved);
            // the final state is saved too; the next call loads it and runs nothing
            assert_eq!(ck.generations().iter().map(|g| g.0).collect::<Vec<_>>(), vec![28, 30]);
            let mut c = Solver::new(&tree, &ranges);
            let info = run_iterations(&mut c, &plan, Some(&ck), None, &mut |_| {}).unwrap();
            assert_eq!(info.resumed_from, 30);
            assert!(state(&mut c) == want);
            std::fs::remove_dir_all(&dir).unwrap();
        }

        // a damaged newest checkpoint: the older one is used, with a warning
        let dir = tmp_dir("damaged");
        let ck = Checkpoints::new(&dir, plan.tag()).unwrap();
        let mut a = Solver::new(&tree, &ranges);
        run_iterations(&mut a, &plan, Some(&ck), Some(22), &mut |_| {}).unwrap();
        let gens = ck.generations();
        assert_eq!(gens.iter().map(|g| g.0).collect::<Vec<_>>(), vec![14, 21]);
        let mut bytes = std::fs::read(&gens[1].1).unwrap();
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0x40;
        std::fs::write(&gens[1].1, &bytes).unwrap();
        let mut b = Solver::new(&tree, &ranges);
        let mut log = Vec::new();
        let info = run_iterations(&mut b, &plan, Some(&ck), None, &mut |m| log.push(m.to_string())).unwrap();
        assert_eq!(info.resumed_from, 14);
        assert!(log.iter().any(|m| m.contains("not used") && m.contains("CRC")), "{:?}", log);
        assert!(state(&mut b) == want);
        // a truncated one is refused by its length
        let gens = ck.generations();
        let bytes = std::fs::read(&gens[1].1).unwrap();
        std::fs::write(&gens[1].1, &bytes[..bytes.len() - 100]).unwrap();
        let mut c = Solver::new(&tree, &ranges);
        let mut log = Vec::new();
        assert_eq!(ck.load_latest(&mut c, &mut |m| log.push(m.to_string())), Some(28));
        assert!(log.iter().any(|m| m.contains("complete checkpoint has")), "{:?}", log);
        std::fs::remove_dir_all(&dir).unwrap();

        // another run's checkpoints (other ranges, another plan) are not loaded: a fresh start
        let dir = tmp_dir("other-run");
        let ck = Checkpoints::new(&dir, plan.tag()).unwrap();
        let mut a = Solver::new(&tree, &mixed_ranges(4));
        run_iterations(&mut a, &plan, Some(&ck), Some(8), &mut |_| {}).unwrap();
        let mut b = Solver::new(&tree, &ranges);
        let mut log = Vec::new();
        let info = run_iterations(&mut b, &plan, Some(&ck), None, &mut |m| log.push(m.to_string())).unwrap();
        assert_eq!(info.resumed_from, 0);
        assert!(log.iter().any(|m| m.contains("fingerprint")), "{:?}", log);
        assert!(state(&mut b) == want);
        let other = Checkpoints::new(&dir, Plan::new(40, 0.5, 7).tag()).unwrap();
        let mut c = Solver::new(&tree, &ranges);
        let mut log = Vec::new();
        assert_eq!(other.load_latest(&mut c, &mut |m| log.push(m.to_string())), None);
        assert!(log.iter().any(|m| m.contains("another run")), "{:?}", log);
        assert!(c.regret.iter().all(|v| v.iter().all(|&x| x == 0.0)), "a refused checkpoint leaves no trace");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// (b) a crash while a checkpoint is written leaves the complete checkpoints as they were (the partial file is the
    /// temporary one, removed at the next start), and the run resumes from the last complete one
    #[test]
    fn a_crash_while_saving_keeps_the_last_checkpoint() {
        let tree = small_flop();
        let ranges = mixed_ranges(3);
        let plan = Plan::new(30, 0.5, 5);
        let dir = tmp_dir("crash");
        let ck = Checkpoints::new(&dir, plan.tag()).unwrap();
        let mut a = Solver::new(&tree, &ranges);
        run_iterations(&mut a, &plan, Some(&ck), Some(12), &mut |_| {}).unwrap();
        let before = ck.generations();
        assert_eq!(before.iter().map(|g| g.0).collect::<Vec<_>>(), vec![5, 10]);
        let size = std::fs::metadata(&before[1].1).unwrap().len();
        assert!(ck.save_impl(&a, Some(size / 2)).is_err());
        let after = ck.generations();
        assert_eq!(after.iter().map(|g| g.0).collect::<Vec<_>>(), vec![10], "only complete checkpoints carry a checkpoint's name");
        for (_, p) in &after {
            let mut probe = Solver::new(&tree, &ranges);
            assert_eq!(ck.load(p, &mut probe), Ok(10));
        }
        let mut b = Solver::new(&tree, &ranges);
        let mut log = Vec::new();
        let info = run_iterations(&mut b, &plan, Some(&ck), None, &mut |m| log.push(m.to_string())).unwrap();
        assert_eq!(info.resumed_from, 10);
        assert!(log.iter().any(|m| m.contains("unfinished save")), "{:?}", log);
        assert!(!log.iter().any(|m| m.contains("not used")), "{:?}", log);
        let mut cont = Solver::new(&tree, &ranges);
        run_iterations(&mut cont, &plan, None, None, &mut |_| {}).unwrap();
        assert!(state(&mut b) == state(&mut cont));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// (c) the river re-solve: the flop / turn strategies stay those of the file, the river is solved from zero, the
    /// river-only value keeps the locks and the full value removes them (an independent best response agrees)
    #[test]
    fn resolving_the_river_keeps_the_flop_and_turn() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 4, river_cards: 3, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(2), 80);
        let va = all_cards_values(&mut a);
        // the upstream file round trip
        let dir = tmp_dir("resolve");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("upstream.tsup");
        let nodes = upstream_of(&a);
        assert!(!nodes.is_empty() && nodes.iter().all(|(i, _)| tree.nodes[*i as usize].street < 2));
        Upstream::write(&path, tree_fingerprint(&a), "test", &nodes).unwrap();
        let up = Upstream::read(&path).unwrap();
        assert_eq!(up.tag, "test");
        let strategies = |v: &[(u32, Vec<f32>)]| bits(&v.iter().map(|x| x.1.clone()).collect::<Vec<_>>());
        assert_eq!(strategies(&up.nodes), strategies(&nodes));
        // another scenario's file is refused
        let mut other = Solver::with_options(&tree, &mixed_ranges(10), on_demand(1));
        assert!(lock_upstream(&mut other, &up).is_err());

        let plan = Plan::new(60, 0.5, 0);
        let mut r = Solver::with_options(&tree, &ranges, on_demand(2));
        let (v, _) = resolve_river(&mut r, &up, &plan, None, None, &mut |_| {}).unwrap();
        let v = v.unwrap();
        let (mut n_up, mut n_river, mut n_new) = (0, 0, 0);
        for (i, n) in tree.nodes.iter().enumerate() {
            let PKind::Decision { .. } = n.kind else { continue };
            assert!(r.locked_strategy(i).is_none(), "every lock removed");
            if n.street < 2 {
                n_up += 1;
                assert!(r.regret[i].iter().all(|&x| x == 0.0) && r.ssum[i].iter().all(|&x| x == 0.0), "a locked node is never trained");
                let (_, st) = up.nodes.iter().find(|x| x.0 as usize == i).unwrap();
                assert!(r.avg[i].iter().zip(st).all(|(x, y)| (x - y).abs() < 1e-5), "node {}: the file's strategy", i);
            } else {
                n_river += 1;
                if r.regret[i].iter().any(|&x| x != 0.0) && r.regret[i] != a.regret[i] {
                    n_new += 1;
                }
            }
        }
        assert_eq!(n_up, up.nodes.len());
        assert!(n_new * 10 > n_river * 9, "the river is solved again from zero: {} / {}", n_new, n_river);
        // the full value: an independent solver with every average stored and no lock, and 3-0's FullBr
        let mut m = Solver::new(&tree, &ranges);
        m.regret = r.regret.clone();
        m.ssum = r.ssum.clone();
        m.finalize_avg();
        for (i, _) in &up.nodes {
            m.avg[*i as usize] = r.avg[*i as usize].clone();
        }
        assert_eq!(m.exploitability().to_bits(), v.full.to_bits());
        let br = FullBr::new(&tree, &m.avg, &m.prior, Assign::Nearest).with_full([false; 3]).exploitability();
        assert!(close(br.chips, v.full), "FullBr {} vs {}", br.chips, v.full);
        // the river-only value: the same strategies with the flop / turn locked (to the file's, as the re-solve did)
        for (i, st) in &up.nodes {
            m.lock_node(*i as usize, st.clone()).unwrap();
        }
        assert_eq!(m.exploitability().to_bits(), v.river_only.to_bits());
        assert!(v.river_only < v.full, "{} vs {}", v.river_only, v.full);
        // the re-solved river is about as good as the all-card solve's
        assert!(v.full < 2.0 * va.full + 0.05 * cfg.pot, "re-solve {} vs all-card {}", v.full, va.full);

        // a bad upstream (always check / call): unlocking lets the best response punish the flop / turn
        let bad: Vec<(u32, Vec<f32>)> = up
            .nodes
            .iter()
            .map(|(i, st)| {
                let PKind::Decision { acts, .. } = &tree.nodes[*i as usize].kind else { unreachable!() };
                let k = acts.iter().position(|x| x.kind == 1).unwrap();
                let mut s = vec![0f32; st.len()];
                s[k * NC..(k + 1) * NC].iter_mut().for_each(|x| *x = 1.0);
                (*i, s)
            })
            .collect();
        Upstream::write(&path, tree_fingerprint(&a), "passive", &bad).unwrap();
        let bad = Upstream::read(&path).unwrap();
        let mut r2 = Solver::with_options(&tree, &ranges, on_demand(1));
        let (v2, _) = resolve_river(&mut r2, &bad, &plan, None, None, &mut |_| {}).unwrap();
        let v2 = v2.unwrap();
        assert!(v2.full > v2.river_only + 0.1 * cfg.pot, "full {} vs river only {}", v2.full, v2.river_only);

        // the re-solve resumes from its checkpoints like the solve
        let ck_plan = Plan::new(60, 0.5, 9);
        let ck = Checkpoints::new(dir.join("ck"), resolve_tag(&ck_plan, &up, 0.0)).unwrap();
        let mut r3 = Solver::with_options(&tree, &ranges, on_demand(1));
        let (none, _) = resolve_river(&mut r3, &up, &ck_plan, Some(&ck), Some(31), &mut |_| {}).unwrap();
        assert!(none.is_none());
        let mut r4 = Solver::with_options(&tree, &ranges, on_demand(2));
        let (v4, info) = resolve_river(&mut r4, &up, &ck_plan, Some(&ck), None, &mut |_| {}).unwrap();
        assert_eq!(info.resumed_from, 27);
        let v4 = v4.unwrap();
        assert_eq!((v4.full.to_bits(), v4.river_only.to_bits()), (v.full.to_bits(), v.river_only.to_bits()));
        assert_eq!(bits(&r4.regret), bits(&r.regret));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// `breakdown`: the gains nest (river alone <= + turn <= everywhere), `river` and `full` are the values of the
    /// re-solve, the subtree of the first flop node of a player holds all of that player's flop and turn nodes, and the
    /// locks are gone afterwards
    #[test]
    fn the_breakdown_nests_and_ends_at_the_full_value() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(1), 60);
        a.finalize_avg();
        let up = Upstream { tree: tree_fingerprint(&a), tag: String::new(), nodes: upstream_of(&a), crc: 7 };
        let plan = Plan::new(40, 0.5, 0);
        let mut r = Solver::with_options(&tree, &ranges, on_demand(2));
        // a solver that has not been re-solved has no flop / turn strategies to hold: an error, not a wrong number
        assert!(breakdown(&mut Solver::with_options(&tree, &ranges, on_demand(2)), &mut |_| {}).is_err());
        let (v, _) = resolve_river(&mut r, &up, &plan, None, None, &mut |_| {}).unwrap();
        let v = v.unwrap();
        let before = r.exploitability_by_player();
        let b = breakdown(&mut r, &mut |_| {}).unwrap();
        let close = |x: f32, y: f32| (x - y).abs() <= 1e-4 * (1.0 + x.abs().max(y.abs()));
        for p in 0..2 {
            assert!(b.river[p] >= 0.0);
            assert!(b.river[p] <= b.turn[p] + 1e-5 && b.turn[p] <= b.full[p] + 1e-5, "player {}: {:?} {:?} {:?}", p, b.river, b.turn, b.full);
            assert!(close(b.full[p], v.full_by_player[p]), "player {}: {} vs {}", p, b.full[p], v.full_by_player[p]);
        }
        assert!(close(b.river[0] + b.river[1], v.river_only), "{:?} vs {}", b.river, v.river_only);
        // the flop decision nodes: the root (OOP, empty path), each with a gain between the river alone and everywhere
        let flop_decisions = tree.nodes.iter().filter(|n| n.street == 0 && matches!(n.kind, PKind::Decision { .. })).count();
        assert_eq!(b.flop_nodes.len(), flop_decisions);
        assert!(b.flop_nodes.len() >= 4);
        let root = b.flop_nodes.iter().find(|g| g.path.is_empty()).expect("the root");
        assert_eq!(root.player, 0);
        assert!(close(root.gain, b.full[0]), "the root's subtree holds all of OOP's nodes: {} vs {}", root.gain, b.full[0]);
        for g in &b.flop_nodes {
            let p = g.player as usize;
            assert!(g.gain >= b.river[p] - 1e-4 && g.gain <= b.full[p] + 1e-4, "{:?} {:?} {:?}", g, b.river, b.full);
        }
        // the paths tell the actions: a node below a check has a path starting with `c`, below the bet `b..`
        assert!(b.flop_nodes.iter().any(|g| g.path == "c") && b.flop_nodes.iter().any(|g| g.path.starts_with('b')));
        // no lock is left behind, so the exploitability is what it was
        for (i, _) in upstream_nodes(&tree) {
            assert!(r.locked_strategy(i).is_none());
        }
        assert_eq!(r.exploitability_by_player().map(f32::to_bits), before.map(f32::to_bits));
    }

    /// `dealt_breakdown`: with every line dealt (`min_reach` 0) it is `breakdown`, bit for bit; the more lines are left
    /// out (a larger `min_reach`) the smaller the gains; `set_br_forbidden` with every action forbidden forbids none; no
    /// lock or forbidden action is left behind
    #[test]
    fn the_dealt_gain_shrinks_with_the_lines_left_out() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(1), 60);
        a.finalize_avg();
        let up = Upstream { tree: tree_fingerprint(&a), tag: String::new(), nodes: upstream_of(&a), crc: 7 };
        let plan = Plan::new(40, 0.5, 0);
        let mut r = Solver::with_options(&tree, &ranges, on_demand(2));
        assert!(dealt_breakdown(&mut Solver::with_options(&tree, &ranges, on_demand(2)), 0.0, &mut |_| {}).is_err());
        resolve_river(&mut r, &up, &plan, None, None, &mut |_| {}).unwrap().0.unwrap();
        let before = r.exploitability_by_player();
        let b = breakdown(&mut r, &mut |_| {}).unwrap();
        // every line dealt: the breakdown's values (the same walks, nothing forbidden)
        let all = dealt_breakdown(&mut r, 0.0, &mut |_| {}).unwrap();
        assert_eq!(all.dealt_decisions, all.upstream_decisions);
        assert_eq!(all.undealt_reach, 0.0);
        let bits2 = |x: [f32; 2]| x.map(f32::to_bits);
        assert_eq!(bits2(all.river), bits2(b.river));
        assert_eq!(bits2(all.turn), bits2(b.turn));
        assert_eq!(bits2(all.full), bits2(b.full));
        // lines left out: fewer nodes, a smaller gain each time (a line below a line that is left out is left out too)
        let mut last = all.clone();
        let mut some_left_out = false;
        for min in [0.01f32, 0.03, 0.1, 0.3] {
            let g = dealt_breakdown(&mut r, min, &mut |_| {}).unwrap();
            assert!(g.dealt_decisions <= last.dealt_decisions && g.dealt_decisions >= 1, "{} -> {}", last.dealt_decisions, g.dealt_decisions);
            some_left_out |= g.dealt_decisions < g.upstream_decisions;
            for p in 0..2 {
                assert!(g.river[p] <= g.turn[p] + 1e-5 && g.turn[p] <= g.full[p] + 1e-5, "min {} player {}: {:?} {:?} {:?}", min, p, g.river, g.turn, g.full);
                assert!(g.full[p] <= last.full[p] + 1e-4 * (1.0 + last.full[p]), "min {} player {}: {} after {}", min, p, g.full[p], last.full[p]);
                assert!(g.full[p] >= 0.0 && g.full_raw[p] <= g.full[p] + 1e-6 && g.full_raw[p] >= -1e-4, "min {} player {}: {:?}", min, p, g);
            }
            last = g;
        }
        assert!(some_left_out, "no threshold left a line out: the test checks nothing");
        // no lock and no forbidden action is left behind
        for (i, _) in upstream_nodes(&tree) {
            assert!(r.locked_strategy(i).is_none());
        }
        assert_eq!(r.exploitability_by_player().map(f32::to_bits), before.map(f32::to_bits));
        // a node whose every action is forbidden forbids none
        r.set_br_forbidden(vec![u64::MAX; tree.nodes.len()]);
        assert_eq!(r.exploitability_by_player().map(f32::to_bits), before.map(f32::to_bits));
        r.set_br_forbidden(Vec::new());
    }

    /// the upstream files of before the rake fields (REFACTOR_PLAN 3-2) of a tree without rake are still read; a tree
    /// with rake never had one
    #[test]
    fn an_upstream_from_before_the_rake_fields_is_still_read() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(1), 20);
        a.finalize_avg();
        // what `Config` printed then: the same without the two rake fields
        assert!(format!("{:?}", tree.cfg).ends_with(", rake_pct: 0.0, rake_cap: inf }"), "{:?}", tree.cfg);
        let old = legacy_fingerprint(&tree, &a.prior, &a.supports, &a.support_of).expect("a tree without rake");
        assert_ne!(old, tree_fingerprint(&a));
        let up = Upstream { tree: old, tag: String::new(), nodes: upstream_of(&a), crc: 0 };
        let mut r = Solver::with_options(&tree, &ranges, on_demand(2));
        lock_upstream(&mut r, &up).unwrap();
        assert!(upstream_strategies(&tree, &ranges, &up).is_ok());
        // the file of another scenario is still refused
        let other = Upstream { tree: old ^ 1, ..up };
        assert!(upstream_strategies(&tree, &ranges, &other).is_err());
        // with rake there is no old fingerprint
        let raked = build_tree(&Config { rake_pct: 5.0, rake_cap: 3.0, ..cfg.clone() }, &board("Ks 7d 2c"));
        assert!(legacy_fingerprint(&raked, &a.prior, &a.supports, &a.support_of).is_none());
    }

    /// `resolve_river_eps`: eps 0 is `resolve_river` bit for bit; with eps > 0 the rivers are solved against the trembling
    /// flop / turn strategies while the values are measured with the file's own strategies; the checkpoint tag
    /// carries eps, so a re-solve never continues the checkpoints of another eps
    #[test]
    fn the_resolve_with_a_tremble_solves_against_it_and_measures_the_upstream() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(1), 60);
        a.finalize_avg();
        let up = Upstream { tree: tree_fingerprint(&a), tag: String::new(), nodes: upstream_of(&a), crc: 7 };
        let plan = Plan::new(40, 0.5, 0);
        let run = |eps: Option<f32>| {
            let mut r = Solver::with_options(&tree, &ranges, on_demand(2));
            let (v, _) = match eps {
                None => resolve_river(&mut r, &up, &plan, None, None, &mut |_| {}).unwrap(),
                Some(e) => resolve_river_eps(&mut r, &up, e, &plan, None, None, &mut |_| {}).unwrap(),
            };
            (r, v.unwrap())
        };
        // eps 0: the same bits as `resolve_river`, and the same tag as before the tremble existed
        let (r0, v0) = run(None);
        let (rz, vz) = run(Some(0.0));
        assert_eq!(bits(&rz.regret), bits(&r0.regret));
        assert_eq!(bits(&rz.ssum), bits(&r0.ssum));
        assert_eq!((vz.full.to_bits(), vz.river_only.to_bits()), (v0.full.to_bits(), v0.river_only.to_bits()));
        assert_eq!(vz.full_by_player.map(f32::to_bits), v0.full_by_player.map(f32::to_bits));
        assert_eq!((v0.full_by_player[0] + v0.full_by_player[1]).to_bits(), v0.full.to_bits());
        assert!(v0.full_by_player.iter().all(|&g| g >= 0.0));
        assert_eq!(resolve_tag(&plan, &up, 0.0), format!("resolve-river {} upstream={:08x}", plan.tag(), up.crc));

        // the trembling strategies: rows still sum to 1, fold and all-in shrink by 1 - eps, the rest shares eps
        let eps = 0.5f32;
        let tr = tremble_upstream(&tree, &up, eps).unwrap();
        assert_eq!((tr.tree, tr.crc, tr.nodes.len()), (up.tree, up.crc, up.nodes.len()));
        let (mut stopping, mut going) = (0, 0);
        for ((i, st), (j, orig)) in tr.nodes.iter().zip(&up.nodes) {
            assert_eq!(i, j);
            let PKind::Decision { acts, .. } = &tree.nodes[*i as usize].kind else { panic!() };
            let na = acts.len();
            let k = acts.iter().filter(|x| x.kind == 1 || x.kind == 2).count();
            assert!(k >= 1);
            for h in (0..NC).step_by(37) {
                let sum: f32 = (0..na).map(|x| st[x * NC + h]).sum();
                assert!((sum - 1.0).abs() < 1e-5);
                for (x, act) in acts.iter().enumerate() {
                    let (was, is) = (orig[x * NC + h], st[x * NC + h]);
                    if act.kind == 1 || act.kind == 2 {
                        going += 1;
                        assert!((is - ((1.0 - eps) * was + eps / k as f32)).abs() < 1e-6 && is >= eps / k as f32 - 1e-6);
                    } else {
                        stopping += 1;
                        assert!((is - (1.0 - eps) * was).abs() < 1e-6);
                    }
                }
            }
        }
        assert!(stopping > 100 && going > 100);
        assert!(tremble_upstream(&tree, &up, -0.1).is_err() && tremble_upstream(&tree, &up, 1.5).is_err());

        // eps > 0: another river (solved against the trembling reach) ...
        let (re, ve) = run(Some(eps));
        assert_ne!(bits(&re.regret), bits(&r0.regret));
        assert_ne!(ve.river_only.to_bits(), v0.river_only.to_bits());
        // ... which is the river of a re-solve whose upstream file holds the trembling strategies ...
        let mut rt = Solver::with_options(&tree, &ranges, on_demand(2));
        let (vt, _) = resolve_river(&mut rt, &tr, &plan, None, None, &mut |_| {}).unwrap();
        let vt = vt.unwrap();
        assert_eq!(bits(&re.regret), bits(&rt.regret));
        assert_eq!(bits(&re.ssum), bits(&rt.ssum));
        // ... but measured with the file's own flop / turn strategies, not the trembling ones
        assert_ne!(ve.full.to_bits(), vt.full.to_bits());
        assert_ne!(ve.river_only.to_bits(), vt.river_only.to_bits());
        let mut m = Solver::new(&tree, &ranges);
        m.regret = re.regret.clone();
        m.ssum = re.ssum.clone();
        m.finalize_avg();
        for (i, st) in &up.nodes {
            let i = *i as usize;
            assert!(re.locked_strategy(i).is_none(), "every lock removed");
            assert!(re.avg[i].iter().zip(st).all(|(x, y)| (x - y).abs() < 1e-5), "node {}: the file's strategy, not the trembling one", i);
            m.avg[i] = re.avg[i].clone();
        }
        assert_eq!(m.exploitability().to_bits(), ve.full.to_bits());
        assert_eq!(m.exploitability_by_player().map(f32::to_bits), ve.full_by_player.map(f32::to_bits));
        for (i, st) in &up.nodes {
            m.lock_node(*i as usize, st.clone()).unwrap();
        }
        assert_eq!(m.exploitability().to_bits(), ve.river_only.to_bits());

        // the tag carries eps: the checkpoints of one eps are not continued by another
        assert_ne!(resolve_tag(&plan, &up, eps), resolve_tag(&plan, &up, 0.0));
        assert_ne!(resolve_tag(&plan, &up, eps), resolve_tag(&plan, &up, 0.25));
        let dir = tmp_dir("resolve-eps");
        let ck_plan = Plan::new(40, 0.5, 9);
        let ck0 = Checkpoints::new(&dir, resolve_tag(&ck_plan, &up, 0.0)).unwrap();
        let mut s = Solver::with_options(&tree, &ranges, on_demand(1));
        assert!(resolve_river_eps(&mut s, &up, 0.0, &ck_plan, Some(&ck0), Some(20), &mut |_| {}).unwrap().0.is_none());
        let cke = Checkpoints::new(&dir, resolve_tag(&ck_plan, &up, eps)).unwrap();
        let mut s = Solver::with_options(&tree, &ranges, on_demand(1));
        let mut warned = false;
        let (v, info) = resolve_river_eps(&mut s, &up, eps, &ck_plan, Some(&cke), None, &mut |m| warned |= m.contains("not used")).unwrap();
        assert!(warned && info.resumed_from == 0, "the eps 0 checkpoint is refused");
        assert_eq!(v.unwrap().full.to_bits(), ve.full.to_bits());
        let mut s = Solver::with_options(&tree, &ranges, on_demand(1));
        let (_, info) = resolve_river_eps(&mut s, &up, 0.0, &ck_plan, Some(&ck0), Some(21), &mut |_| {}).unwrap();
        assert_eq!(info.resumed_from, 0, "and the eps checkpoints by an eps 0 run");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// `SolverOptions::tremble`: 0 is the solver as it was, bit for bit; with a tremble the flop / turn train on other
    /// values, the averages are those of the chosen strategies (the tremble taken off), the measures play them
    /// without a tremble, and with the tremble put back every river start is reached by a slice of both whole ranges
    #[test]
    fn training_with_a_tremble_keeps_every_line_reached() {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 5, river_cards: 2, flop_runouts: 24, ..Config::default() };
        let tree = build_tree(&cfg, &board("Ks 7d 2c"));
        let ranges = mixed_ranges(9);
        let iters = 120;
        // a large tremble, so that the lines the plain solve abandons are clearly below its floor
        let eps = 0.3f32;
        let with = |tremble: f32, threads: usize| SolverOptions { tremble, ..on_demand(threads) };
        // tremble 0: the same bits as a solver that knows no tremble
        let mut plain = solve(&tree, &ranges, on_demand(1), iters);
        let mut zero = solve(&tree, &ranges, with(0.0, 1), iters);
        assert_eq!(bits(&zero.regret), bits(&plain.regret));
        assert_eq!(bits(&zero.ssum), bits(&plain.ssum));
        let (vp, vz) = (all_cards_values(&mut plain), all_cards_values(&mut zero));
        assert_eq!((vz.full.to_bits(), vz.river_only.to_bits()), (vp.full.to_bits(), vp.river_only.to_bits()));
        let plan = Plan::new(iters, 0.5, 0);
        assert_eq!(solve_tag(&plan, 0.0), format!("all-cards {}", plan.tag()));
        assert_ne!(solve_tag(&plan, eps), solve_tag(&plan, 0.0));
        assert_ne!(solve_tag(&plan, eps), solve_tag(&plan, 0.01));

        // with a tremble: other regrets (also on the river: it is trained against other ranges), the same for any
        // number of threads
        let mut t = solve(&tree, &ranges, with(eps, 1), iters);
        let t3 = solve(&tree, &ranges, with(eps, 3), iters);
        assert_eq!(bits(&t.regret), bits(&t3.regret));
        assert_eq!(bits(&t.ssum), bits(&t3.ssum));
        let (mut up_differs, mut river_differs) = (0, 0);
        for (i, n) in tree.nodes.iter().enumerate() {
            if matches!(n.kind, PKind::Decision { .. }) && t.regret[i] != plain.regret[i] {
                if n.street < 2 {
                    up_differs += 1;
                } else {
                    river_differs += 1;
                }
            }
        }
        assert!(up_differs > 10 && river_differs > 100, "{} flop / turn and {} river nodes trained differently", up_differs, river_differs);

        // the measures play the averages as they are: an independent solver without a tremble gives the same bits
        let vt = all_cards_values(&mut t);
        let mut m = Solver::with_options(&tree, &ranges, on_demand(1));
        m.regret = t.regret.clone();
        m.ssum = t.ssum.clone();
        let vm = all_cards_values(&mut m);
        assert_eq!((vt.full.to_bits(), vt.river_only.to_bits()), (vm.full.to_bits(), vm.river_only.to_bits()));
        assert_eq!(bits(&t.avg), bits(&m.avg));

        // the regrets compare each action with the chosen strategy's own value, not the trembling one's.  After one
        // iteration (chosen = uniform, played = its trembling copy) an action of a flop node has a positive regret
        // exactly when its value is above the mean of all actions; the values come from a solver without a tremble
        // whose flop / turn are locked to that trembling copy (its river plays uniform, as iteration 1 does)
        let one = solve(&tree, &ranges, with(eps, 1), 1);
        let mut f = Solver::new(&tree, &ranges);
        for (i, n) in tree.nodes.iter().enumerate() {
            if let PKind::Decision { acts, .. } = &n.kind {
                if n.street < 2 {
                    let mut st = vec![1.0 / acts.len() as f32; acts.len() * NC];
                    tremble_strategy(&mut st, acts, eps);
                    f.lock_node(i, st).unwrap();
                }
            }
        }
        let ev = f.evaluate();
        let (mut checked, mut telling) = (0, 0);
        for (i, n) in tree.nodes.iter().enumerate() {
            let PKind::Decision { acts, .. } = &n.kind else { continue };
            if n.street != 0 {
                continue;
            }
            let e = ev[i].as_ref().expect("evaluated");
            let (na, k) = (acts.len(), one.support(i).len());
            let going: Vec<usize> = (0..na).filter(|&a| acts[a].kind == 1 || acts[a].kind == 2).collect();
            for (j, &h) in one.support(i).iter().enumerate() {
                let v: Vec<f32> = (0..na).map(|a| e.ev[a * NC + h as usize]).collect();
                let mean = v.iter().sum::<f32>() / na as f32;
                let trembling = (1.0 - eps) * mean + eps * going.iter().map(|&a| v[a]).sum::<f32>() / going.len() as f32;
                for a in 0..na {
                    if (v[a] - mean).abs() < 1e-3 || (v[a] - trembling).abs() < 1e-3 {
                        continue;
                    }
                    checked += 1;
                    assert_eq!(one.regret[i][a * k + j] > 0.0, v[a] > mean, "node {} hand {} action {}: values {:?}, regret {}", i, h, a, v, one.regret[i][a * k + j]);
                    if (v[a] > mean) != (v[a] > trembling) {
                        telling += 1;
                    }
                }
            }
        }
        assert!(checked > 1000 && telling > 20, "{} checked, {} between the two means", checked, telling);

        // the averages are those of the chosen strategies: a going action can be (nearly) unused, which the trembling
        // strategy never is
        let up = Upstream { tree: tree_fingerprint(&t), tag: String::new(), nodes: upstream_of(&t), crc: 0 };
        let mut unused = 0;
        for (i, st) in &up.nodes {
            let PKind::Decision { acts, .. } = &tree.nodes[*i as usize].kind else { panic!() };
            let k = acts.iter().filter(|x| x.kind == 1 || x.kind == 2).count();
            for (a, act) in acts.iter().enumerate() {
                if act.kind == 1 || act.kind == 2 {
                    unused += t.support(*i as usize).iter().filter(|&&h| st[a * NC + h as usize] < 0.5 * eps / k as f32).count();
                }
            }
        }
        assert!(unused > 1000, "{} (hand, going action) pairs below the tremble's floor", unused);

        // the reach of every river start: with the tremble put back (what training played, and what
        // `resolve_river_eps` solves against) each player arrives with at least the tremble's share of its whole
        // range; the solve without a tremble leaves lines below that
        let depth = |want: usize| -> Vec<(f32, f32)> {
            // per player: the product of eps / (going actions) over its decisions on the way to node `want`
            fn go(tree: &Tree, i: usize, want: usize, eps: f32, f: (f32, f32)) -> Option<(f32, f32)> {
                if i == want {
                    return Some(f);
                }
                match &tree.nodes[i].kind {
                    PKind::Decision { player, acts, children } => {
                        let k = acts.iter().filter(|x| x.kind == 1 || x.kind == 2).count() as f32;
                        children.iter().zip(acts).find_map(|(&c, act)| {
                            let x = if act.kind == 1 || act.kind == 2 { eps / k } else { 0.0 };
                            go(tree, c as usize, want, eps, if *player == 0 { (f.0 * x, f.1) } else { (f.0, f.1 * x) })
                        })
                    }
                    PKind::Chance { children, .. } if tree.nodes[i].street < 2 => children.iter().find_map(|&c| go(tree, c as usize, want, eps, f)),
                    _ => None,
                }
            }
            vec![go(&tree, 0, want, eps, (1.0, 1.0)).expect("a river start")]
        };
        let fraction = |rs: &RiverStart, p: usize| -> f64 {
            let bm = mask_of(&tree.nodes[rs.node as usize].board);
            let whole: f64 = (0..NC).filter(|&h| !blocked(bm, h)).map(|h| t.prior[p][h] as f64).sum();
            rs.ranges[p].iter().map(|&x| x as f64).sum::<f64>() / whole
        };
        let trembling = upstream_river_starts(&tree, &ranges, &tremble_upstream(&tree, &up, eps).unwrap()).unwrap();
        assert!(trembling.len() > 20);
        // the weight of the averaging iterations (`Solver::iterate`: 1, 2, ... after the restart)
        let n_avg = (iters - iters / 2) as f64;
        let t_sum = n_avg * (n_avg + 1.0) / 2.0;
        let (mut rows, mut below) = (0, 0);
        for rs in &trembling {
            let floor = depth(rs.node as usize)[0];
            for (p, fl) in [floor.0, floor.1].into_iter().enumerate() {
                assert!(fl > 0.0);
                assert!(fraction(rs, p) >= 0.999 * fl as f64, "river start {} player {}: {} of the range, the tremble gives {}", rs.node, p, fraction(rs, p), fl);
            }
            // what training itself played: at the first river node (OOP's) of every river card, the strategy sums
            // of a hand add up to (iteration weights) x (its reach in those iterations), at least the tremble's
            // share of its starting weight; the solve without a tremble leaves hands below that
            let PKind::Chance { children, .. } = &tree.nodes[rs.node as usize].kind else { panic!() };
            for &c in children {
                let c = c as usize;
                let PKind::Decision { player: 0, children: acts, .. } = &tree.nodes[c].kind else { panic!("OOP acts first on the river") };
                let sup = t.support(c);
                let k = sup.len();
                for (j, &h) in sup.iter().enumerate() {
                    let need = t_sum * t.prior[0][h as usize] as f64 * floor.0 as f64;
                    let row = |s: &Solver| (0..acts.len()).map(|a| s.ssum[c][a * k + j] as f64).sum::<f64>();
                    rows += 1;
                    assert!(row(&t) >= 0.99 * need, "node {} hand {}: strategy sums {} < {}", c, h, row(&t), need);
                    if row(&plain) < 0.5 * need {
                        below += 1;
                    }
                }
            }
        }
        assert!(rows > 10_000 && below > 100, "{} of {} hands below the tremble's floor without a tremble: the test must show some", below, rows);

        // the re-solve against the trembling strategies, measured with the averages themselves
        let mut r = Solver::with_options(&tree, &ranges, on_demand(1));
        let (v, _) = resolve_river_eps(&mut r, &up, eps, &Plan::new(40, 0.5, 0), None, None, &mut |_| {}).unwrap();
        assert!(v.unwrap().full.is_finite());

        // a checkpoint of another tremble is not continued
        let dir = tmp_dir("tremble");
        let ck_plan = Plan::new(30, 0.5, 9);
        let ck0 = Checkpoints::new(&dir, solve_tag(&ck_plan, 0.0)).unwrap();
        let mut s = Solver::with_options(&tree, &ranges, with(0.0, 1));
        assert!(!run_iterations(&mut s, &ck_plan, Some(&ck0), Some(20), &mut |_| {}).unwrap().finished);
        let cke = Checkpoints::new(&dir, solve_tag(&ck_plan, eps)).unwrap();
        let mut s = Solver::with_options(&tree, &ranges, with(eps, 1));
        let mut warned = false;
        let info = run_iterations(&mut s, &ck_plan, Some(&cke), None, &mut |m| warned |= m.contains("not used")).unwrap();
        assert!(warned && info.resumed_from == 0 && info.finished);
        // ... and a solve with a tremble resumes its own checkpoints to the same bits
        let dir2 = tmp_dir("tremble2");
        let ck = Checkpoints::new(&dir2, solve_tag(&ck_plan, eps)).unwrap();
        let mut a = Solver::with_options(&tree, &ranges, with(eps, 1));
        assert!(!run_iterations(&mut a, &ck_plan, Some(&ck), Some(20), &mut |_| {}).unwrap().finished);
        let mut b = Solver::with_options(&tree, &ranges, with(eps, 2));
        let info = run_iterations(&mut b, &ck_plan, Some(&ck), None, &mut |_| {}).unwrap();
        assert_eq!(info.resumed_from, 18);
        assert_eq!(bits(&b.regret), bits(&s.regret));
        assert_eq!(bits(&b.ssum), bits(&s.ssum));
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(&dir2).unwrap();
    }

    /// (c) with the turn locked, one river subgame of the re-solve is that river solved on its own from the reach
    /// ranges (what the device does): the same average strategy up to rounding (other weights, same arithmetic)
    #[test]
    fn a_river_of_the_resolve_is_the_river_solved_alone() {
        let tree = turn_tree();
        let ranges = mixed_ranges(11);
        let mut a = solve(&tree, &ranges, on_demand(1), 40);
        a.finalize_avg();
        let up = Upstream { tree: tree_fingerprint(&a), tag: String::new(), nodes: upstream_of(&a), crc: 0 };
        let plan = Plan::new(50, 0.5, 0);
        let mut r = Solver::with_options(&tree, &ranges, on_demand(2));
        resolve_river(&mut r, &up, &plan, None, None, &mut |_| {}).unwrap();
        let ev = r.evaluate();
        // the line check / check on the turn, then a river card
        let PKind::Decision { children, .. } = &tree.nodes[0].kind else { panic!() };
        let ip = children[0] as usize;
        let PKind::Decision { children: c2, .. } = &tree.nodes[ip].kind else { panic!() };
        let PKind::Chance { cards, children: rivers, .. } = &tree.nodes[c2[0] as usize].kind else { panic!("check / check ends the turn") };
        let mut checked = 0;
        for (&c, &rn) in cards.iter().zip(rivers).step_by(12) {
            let (l0, l1) = (&r.avg[0], &r.avg[ip]);
            let mut r0: Vec<f32> = (0..NC).map(|h| r.prior[0][h] * l0[h]).collect();
            let mut r1: Vec<f32> = (0..NC).map(|h| r.prior[1][h] * l1[h]).collect();
            for &h in &ct().by_card[c as usize] {
                r0[h as usize] = 0.0;
                r1[h as usize] = 0.0;
            }
            let mut b5 = tree.board.clone();
            b5.push(c);
            let alone_tree = build_tree(&tree.cfg, &b5);
            let mut alone = Solver::new(&alone_tree, &[r0.clone(), r1]);
            run_iterations(&mut alone, &plan, None, None, &mut |_| {}).unwrap();
            alone.finalize_avg();
            let e = ev[rn as usize].as_ref().expect("the river root is evaluated");
            let na = alone.avg[0].len() / NC;
            assert_eq!(e.freq.len(), na * NC);
            let mut worst = 0f32;
            for h in (0..NC).filter(|&h| r0[h] > 0.0) {
                for a in 0..na {
                    worst = worst.max((e.freq[a * NC + h] - alone.avg[0][a * NC + h]).abs());
                }
            }
            assert!(worst < 1e-3, "river card {}: largest difference {}", c, worst);
            checked += 1;
        }
        assert!(checked >= 4);
    }

    /// a flop tree with 4 turn x `river_cards` river cards (as `resolving_the_river_keeps_the_flop_and_turn`)
    fn resolve_tree(river_cards: usize) -> Tree {
        let cfg = Config { pot: 6.0, stack: 30.0, bets: [vec![0.5], vec![0.75], vec![0.75]], allow_allin: true, turn_cards: 4, river_cards, flop_runouts: 24, ..Config::default() };
        build_tree(&cfg, &board("Ks 7d 2c"))
    }

    /// bit patterns of a range with the combos holding `c` at 0
    fn dealt(r: &[f32], c: u8) -> Vec<u32> {
        zero_card(r, c).iter().map(|x| x.to_bits()).collect()
    }

    /// (3-3-5) the reach ranges at the river starts, computed forward from `upstream.tsup` without a solver, are bit for
    /// bit the ranges with which `resolve_river` solves each river (the weights its evaluation reports at each river
    /// root: OOP's at the root, IP's after OOP's check), for every river card; and `Solver::river_starts` of the
    /// all-card solve gives the ranges of that solve's evaluation
    #[test]
    fn upstream_ranges_are_the_ranges_of_the_resolve() {
        let tree = resolve_tree(3);
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(2), 60);
        a.finalize_avg();
        assert_eq!(tree_fingerprint_of(&tree, &ranges), tree_fingerprint(&a));
        let up = Upstream { tree: tree_fingerprint(&a), tag: String::new(), nodes: upstream_of(&a), crc: 0 };
        let mut r = Solver::with_options(&tree, &ranges, on_demand(1));
        resolve_river(&mut r, &up, &Plan::new(30, 0.5, 0), None, None, &mut |_| {}).unwrap();
        let n_starts = tree.nodes.iter().filter(|n| is_river_start(n)).count();
        let from_a = Solver::river_starts(&a).unwrap();
        for (solver, starts) in [(&mut r, upstream_river_starts(&tree, &ranges, &up).unwrap()), (&mut a, from_a)] {
            assert_eq!(starts.len(), n_starts);
            let ev = solver.evaluate();
            let (mut checked, mut wide) = (0, 0);
            for rs in &starts {
                let node = &tree.nodes[rs.node as usize];
                let PKind::Chance { cards, children, .. } = &node.kind else { panic!("a river start is a chance node") };
                assert!(close(rs.cond_reach * node.chance_p, rs.reach), "{} x {} vs {}", rs.cond_reach, node.chance_p, rs.reach);
                for (&c, &ch) in cards.iter().zip(children) {
                    let PKind::Decision { player: 0, children: acts, .. } = &tree.nodes[ch as usize].kind else { panic!("OOP acts first on the river") };
                    let oop = ev[ch as usize].as_ref().expect("river root evaluated");
                    let ip = ev[acts[0] as usize].as_ref().expect("IP after the check evaluated");
                    assert_eq!(ip.player, 1);
                    assert_eq!(oop.weight.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), dealt(&rs.ranges[0], c), "river start {} card {}: OOP", rs.node, c);
                    assert_eq!(ip.weight.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), dealt(&rs.ranges[1], c), "river start {} card {}: IP", rs.node, c);
                    checked += 1;
                    wide += (rs.ranges[0].iter().filter(|&&x| x > 0.0).count() > 50) as usize;
                }
            }
            assert!(checked >= 3 * n_starts && wide * 2 > checked, "{} river roots, {} with wide ranges", checked, wide);
        }
        // another scenario's file is refused
        assert!(upstream_river_starts(&tree, &mixed_ranges(10), &up).is_err());
    }

    /// (3-3-5) the strategies of a 4 x 3 solve played on the 4 x 2 tree: the same flop / turn nodes renumbered, the same
    /// river start ranges; a tree with other turn cards is refused
    #[test]
    fn upstream_onto_a_tree_with_fewer_river_cards() {
        let (big, small) = (resolve_tree(3), resolve_tree(2));
        let ranges = mixed_ranges(9);
        let mut a = solve(&big, &ranges, on_demand(1), 20);
        a.finalize_avg();
        let up = Upstream { tree: tree_fingerprint(&a), tag: "t".into(), nodes: upstream_of(&a), crc: 7 };
        let onto = upstream_onto(&up, &big, &ranges, &small).unwrap();
        assert_ne!(onto.nodes.iter().map(|x| x.0).collect::<Vec<_>>(), up.nodes.iter().map(|x| x.0).collect::<Vec<_>>(), "renumbered");
        let (sb, ss) = (upstream_river_starts(&big, &ranges, &up).unwrap(), upstream_river_starts(&small, &ranges, &onto).unwrap());
        assert_eq!(sb.len(), ss.len());
        for (x, y) in sb.iter().zip(&ss) {
            assert_eq!(bits(&x.ranges), bits(&y.ranges));
            assert_eq!(x.reach.to_bits(), y.reach.to_bits());
        }
        let cfg = Config { turn_cards: 3, ..small.cfg.clone() };
        assert!(upstream_onto(&up, &big, &ranges, &build_tree(&cfg, &board("Ks 7d 2c"))).is_err());
        assert!(upstream_onto(&up, &small, &ranges, &big).is_err(), "the file is not of the small tree");
    }

    /// (3-3-5) the rivers solved one by one on their own trees (as the device does) from the exact ranges measure as the
    /// re-solve in the whole tree; from the ranges of a `TSP1` v3 file (u16) they measure about the same
    #[test]
    fn rivers_solved_alone_measure_as_the_resolve() {
        let tree = resolve_tree(2);
        let ranges = mixed_ranges(9);
        let mut a = solve(&tree, &ranges, on_demand(1), 60);
        a.finalize_avg();
        let up = Upstream { tree: tree_fingerprint(&a), tag: String::new(), nodes: upstream_of(&a), crc: 0 };
        let plan = Plan::new(40, 0.5, 0);
        let mut r = Solver::with_options(&tree, &ranges, on_demand(1));
        let (v, _) = resolve_river(&mut r, &up, &plan, None, None, &mut |_| {}).unwrap();
        let v = v.unwrap();
        let exact = resolve_rivers_alone(&tree, &ranges, &up, &plan, &|rs| rs.ranges.clone(), &mut |_| {}).unwrap();
        assert_eq!(exact.subgames, tree.nodes.iter().filter(|n| is_river_start(n)).count() * 2);
        let tol = 1e-3 * tree.cfg.pot;
        assert!((exact.full - v.full).abs() < tol && (exact.river_only - v.river_only).abs() < tol, "alone {:?} vs in the tree {:?}", exact, v);
        let quantized = resolve_rivers_alone(&tree, &ranges, &up, &plan, &|rs| [QRange::new(&rs.ranges[0]).dense(), QRange::new(&rs.ranges[1]).dense()], &mut |_| {}).unwrap();
        assert!((quantized.full - exact.full).abs() < tol, "u16 {:?} vs exact {:?}", quantized, exact);
        // the ranges matter: an IP range from another river start measures otherwise
        let starts = upstream_river_starts(&tree, &ranges, &up).unwrap();
        let wrong = resolve_rivers_alone(&tree, &ranges, &up, &plan, &|rs| [rs.ranges[0].clone(), starts[(rs.node as usize * 7) % starts.len()].ranges[1].clone()], &mut |_| {}).unwrap();
        assert!((wrong.full - exact.full).abs() > 10.0 * tol, "{:?} vs {:?}", wrong, exact);
    }

    /// `run_until` (REFACTOR_PLAN 3-3-7): the looks do not change the iterations; it stops at the first value within the target
    /// or at the cap; a run cut at one look and continued from the checkpoint ends where an uninterrupted one does
    #[test]
    fn run_until_looks_every_so_often_and_stops_at_the_target_or_the_cap() {
        let tree = small_flop();
        let ranges = mixed_ranges(3);
        let mut value = |s: &mut Solver| -> f32 {
            s.finalize_avg();
            s.exploitability()
        };
        let strategy = |s: &mut Solver| -> Vec<u32> {
            s.finalize_avg();
            bits(&upstream_of(s).into_iter().map(|x| x.1).collect::<Vec<_>>())
        };
        // the reference: 60 iterations, the average restarted before iteration 21
        let mut reference = Solver::with_options(&tree, &ranges, on_demand(1));
        run_iterations(&mut reference, &Plan { iters: 60, reset_at: Some(20), every: 0 }, None, None, &mut |_| {}).unwrap();
        let want = strategy(&mut reference);
        // a target that is never met: to the cap, looking at 40 and 60 (not at 20: the average has just restarted)
        let mut s = Solver::with_options(&tree, &ranges, on_demand(1));
        let info = run_until(&mut s, &Looks { reset_at: 20, check_every: 20, max_iters: 60, target: 0.0 }, None, 0, &mut value, &mut |_| {}).unwrap();
        assert!(!info.reached);
        assert_eq!(s.iters, 60);
        assert_eq!(info.history.iter().map(|h| h.0).collect::<Vec<_>>(), vec![40, 60]);
        assert_eq!(strategy(&mut s), want, "the looks leave the iterations as they were");
        // a target met at the first look
        let mut u = Solver::with_options(&tree, &ranges, on_demand(1));
        let info = run_until(&mut u, &Looks { reset_at: 20, check_every: 20, max_iters: 60, target: 1e9 }, None, 0, &mut value, &mut |_| {}).unwrap();
        assert!(info.reached);
        assert_eq!((u.iters, info.history.len()), (40, 1));
        // cut at 40 (checkpoint saved before the look), continued to 60 from the checkpoint
        let dir = tmp_dir("run-until");
        let tag = "run-until reset_at=20";
        let mut a = Solver::with_options(&tree, &ranges, on_demand(1));
        let ck = Checkpoints::new(&dir, tag).unwrap();
        let first = run_until(&mut a, &Looks { reset_at: 20, check_every: 20, max_iters: 40, target: 0.0 }, Some(&ck), 10, &mut value, &mut |_| {}).unwrap();
        assert_eq!((first.resumed_from, a.iters), (0, 40));
        let mut b = Solver::with_options(&tree, &ranges, on_demand(1));
        let second = run_until(&mut b, &Looks { reset_at: 20, check_every: 20, max_iters: 60, target: 0.0 }, Some(&ck), 10, &mut value, &mut |_| {}).unwrap();
        assert_eq!(second.resumed_from, 40);
        assert_eq!(b.iters, 60);
        assert_eq!(strategy(&mut b), want, "a run continued from a checkpoint ends where an uninterrupted one does");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// a DCFR solve (alternating updates, discounts that depend on the iteration count; REFACTOR_PLAN 4-1) cut at a
    /// checkpoint and continued ends bit for bit where an uninterrupted one does
    #[test]
    fn an_alternating_dcfr_solve_continues_from_a_checkpoint_bit_for_bit() {
        let tree = small_flop();
        let ranges = mixed_ranges(5);
        let opts = SolverOptions { update: crate::postflop::Update::AltDcfr, ..on_demand(1) };
        let strategy = |s: &mut Solver| -> Vec<u32> {
            s.finalize_avg();
            bits(&upstream_of(s).into_iter().map(|x| x.1).collect::<Vec<_>>())
        };
        let mut value = |s: &mut Solver| -> f32 {
            s.finalize_avg();
            s.exploitability()
        };
        let looks = |max_iters: u32| Looks { reset_at: 0, check_every: 15, max_iters, target: 0.0 };
        let mut reference = Solver::with_options(&tree, &ranges, opts);
        run_until(&mut reference, &looks(45), None, 0, &mut value, &mut |_| {}).unwrap();
        let want = strategy(&mut reference);
        let dir = tmp_dir("run-until-dcfr");
        let ck = Checkpoints::new(&dir, "run-until reset_at=0 update=alt-dcfr").unwrap();
        let mut a = Solver::with_options(&tree, &ranges, opts);
        run_until(&mut a, &looks(30), Some(&ck), 10, &mut value, &mut |_| {}).unwrap();
        assert_eq!(a.iters, 30);
        let mut b = Solver::with_options(&tree, &ranges, opts);
        let second = run_until(&mut b, &looks(45), Some(&ck), 10, &mut value, &mut |_| {}).unwrap();
        assert_eq!((second.resumed_from, b.iters), (30, 45));
        assert_eq!(strategy(&mut b), want, "continued from iteration 30, the discounts of 31..45 are those of an uninterrupted run");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
