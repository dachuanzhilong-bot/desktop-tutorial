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
    let t = s.tree;
    let mut h = Fnv::new();
    h.bytes(format!("{:?}", t.cfg).as_bytes());
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
                h.u64(s.support(i).len() as u64);
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
    for sup in s.supports.iter() {
        h.u64(sup.len() as u64);
        sup.iter().for_each(|&x| h.bytes(&x.to_le_bytes()));
    }
    for p in 0..2 {
        s.prior[p].iter().for_each(|&x| h.f32(x));
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
    if up.tree != tree_fingerprint(s) {
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

/// The value of a river re-solve (chips).
#[derive(Clone, Copy, Debug)]
pub struct ResolveValues {
    /// flop and turn locked: only the river best-responds (`docs/14` §3: what a locked measure can show)
    pub river_only: f32,
    /// locks removed: both players best-respond everywhere against "upstream strategy + re-solved river average"
    pub full: f32,
}

/// The re-solve's checkpoint tag
pub fn resolve_tag(plan: &Plan, up: &Upstream) -> String {
    format!("resolve-river {} upstream={:08x}", plan.tag(), up.crc)
}

/// Re-solve the river of `s` (a new solver whose river averages are kept, e.g. `avg_on_demand_from: 2`) for
/// `plan.iters` iterations from zero with the flop and turn locked to `up`, then measure.  Resumes from / saves to
/// `ck` like `run_iterations`.  `None` if stopped by `stop_after`.  The locks are removed at the end, and the flop and
/// turn nodes' `avg` holds the locked strategies.
pub fn resolve_river(s: &mut Solver, up: &Upstream, plan: &Plan, ck: Option<&Checkpoints>, stop_after: Option<u32>, log: &mut dyn FnMut(&str)) -> Result<(Option<ResolveValues>, RunInfo), String> {
    if !keeps_river_average(s) {
        return Err("the re-solve needs the river averages (avg_on_demand_from: 2, no_average_from: 3)".into());
    }
    lock_upstream(s, up)?;
    let info = run_iterations(s, plan, ck, stop_after, log).map_err(|e| e.to_string())?;
    if !info.finished {
        return Ok((None, info));
    }
    s.finalize_avg();
    let river_only = s.exploitability();
    for (i, _) in upstream_nodes(s.tree).collect::<Vec<_>>() {
        let st = s.locked_strategy(i).expect("locked").to_vec();
        s.avg[i] = st;
        s.unlock_node(i);
    }
    let full = s.exploitability();
    Ok((Some(ResolveValues { river_only, full }), info))
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
        let ck = Checkpoints::new(dir.join("ck"), resolve_tag(&ck_plan, &up)).unwrap();
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
}
