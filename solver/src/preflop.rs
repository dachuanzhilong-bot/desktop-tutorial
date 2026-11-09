//! 6-max preflop game: tree construction, equity-realisation payoff model and
//! export of the solved strategy in the app's binary format.
//!
//! IMPORTANT – this is an *approximation* (see docs/07-preflop-model.md):
//!   * 169 hand classes (suit isomorphism) with exact card-removal counts
//!   * a flop is only ever seen heads-up (one caller per raise level)
//!   * post-flop value of a non-all-in pot is modelled by an equity-realisation
//!     (EQR) function of position, hand shape and stack-to-pot ratio.
use crate::cards::*;
use crate::engine::*;
use crate::equity::EquityTables;
use std::collections::HashMap;
use std::fmt::Write as _;

pub const POS: [&str; 6] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
pub const SB: usize = 4;
pub const BB: usize = 5;

/// post-flop acting order: SB first ... BTN last
pub fn post_rank(p: usize) -> usize {
    match p {
        SB => 0,
        BB => 1,
        x => x + 2,
    }
}

#[derive(Clone, Debug)]
pub struct Realization {
    pub ip_mean: f32,
    pub ip_slope: f32,
    pub oop_mean: f32,
    pub oop_slope: f32,
    /// k(spr) = 1 - exp(-spr / spr_scale)
    pub spr_scale: f32,
}

impl Default for Realization {
    fn default() -> Self {
        Realization { ip_mean: 0.10, ip_slope: 0.25, oop_mean: -0.22, oop_slope: 0.32, spr_scale: 3.5 }
    }
}

/// "playability" of a hand class in [0,1]: suitedness, connectedness, high cards.
pub fn play_score(cls: usize) -> f32 {
    let (hi, lo, suited, pair) = class_info(cls);
    let hn = hi as f32 / 12.0;
    let ln = lo as f32 / 12.0;
    if pair {
        return 0.55 + 0.40 * hn;
    }
    let gap = (hi - lo - 1) as f32;
    let conn = (1.0 - gap / 4.0).max(0.0);
    let mut s = 0.10 + 0.40 * hn + 0.20 * ln;
    if suited {
        s += 0.17;
    }
    s += 0.13 * conn;
    if hi == 12 && !suited && lo < 8 {
        s -= 0.08; // dominated ace-x offsuit
    }
    s.clamp(0.0, 1.0)
}

impl Realization {
    pub fn k(&self, spr: f32) -> f32 {
        1.0 - (-spr / self.spr_scale).exp()
    }
    pub fn factor(&self, cls: usize, ip: bool, k: f32) -> f32 {
        let pl = play_score(cls) - 0.5;
        let (m, s) = if ip { (self.ip_mean, self.ip_slope) } else { (self.oop_mean, self.oop_slope) };
        1.0 + k * (m + s * pl)
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub stack: f32,
    pub open: f32,
    pub sb_open: f32,
    pub bb_iso: f32,
    pub three_bet_ip_mult: f32,
    pub three_bet_oop_add: f32,
    pub four_bet_mult: f32,
    /// a 4-bet at least this fraction of the stack becomes a jam
    pub jam_threshold: f32,
    /// at stacks up to this many bb a player may also jam instead of the normal open
    pub open_jam_max: f32,
    /// at stacks up to this many bb a player may also jam (re-shove) over an open instead of the normal 3-bet
    pub shove_3bet_max: f32,
    pub real: Realization,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            stack: 100.0,
            open: 2.5,
            sb_open: 3.0,
            bb_iso: 4.0,
            three_bet_ip_mult: 3.0,
            three_bet_oop_add: 3.5,
            four_bet_mult: 2.3,
            jam_threshold: 0.4,
            open_jam_max: 25.0,
            shove_3bet_max: 45.0,
            real: Realization::default(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActKind {
    Fold = 0,
    Call = 1,
    Raise = 2,
    AllIn = 3,
}

#[derive(Clone, Debug, Default)]
pub struct NodeMeta {
    pub actions: Vec<(u8, f32)>,
    /// for a `call` that ends the betting: (spr bucket, caller is IP)
    pub call_real: Option<(i32, bool)>,
}

#[derive(Clone, Copy, Debug)]
enum ClassDef {
    AllIn,
    Flop { kq: i32 },
}

#[derive(Clone)]
struct St {
    inv: [f32; 6],
    folded: [bool; 6],
    level: u8,
    cur: f32,
    callers: u8,
    pending: Vec<usize>,
    last_raiser: Option<usize>,
}

pub struct Preflop {
    pub game: Game,
    pub meta: Vec<NodeMeta>,
    pub cfg: Config,
    #[allow(dead_code)]
    classes: Vec<ClassDef>,
    /// per node: terminal type for `terms` (0 fold, 1 flop, 2 all-in); decision nodes: 255
    pub term_type: Vec<u8>,
}

struct Builder<'a> {
    cfg: &'a Config,
    nodes: Vec<Node>,
    meta: Vec<NodeMeta>,
    term_type: Vec<u8>,
    class_ids: HashMap<i32, usize>,
    #[allow(dead_code)]
    classes: Vec<ClassDef>,
}

fn round_half(x: f32) -> f32 {
    (x * 2.0).round() / 2.0
}

impl<'a> Builder<'a> {
    fn raise_to(&self, st: &St, p: usize) -> Option<f32> {
        let c = self.cfg;
        if st.level >= 4 || st.cur >= c.stack - 1e-3 {
            return None;
        }
        let mut size = match st.level {
            0 => match p {
                SB => c.sb_open,
                BB => c.bb_iso,
                _ => c.open,
            },
            1 => {
                let ip = post_rank(p) > post_rank(st.last_raiser.unwrap());
                let base = if ip { c.three_bet_ip_mult * st.cur } else { c.three_bet_ip_mult * st.cur + c.three_bet_oop_add };
                base + st.callers as f32 * st.cur
            }
            2 => c.four_bet_mult * st.cur,
            _ => c.stack,
        };
        size = round_half(size);
        if size >= c.stack * c.jam_threshold && st.level >= 2 || size >= c.stack - 1e-3 {
            size = c.stack;
        }
        if size <= st.cur + 1e-3 {
            return None;
        }
        Some(size)
    }

    fn terminal(&mut self, kind: Kind, st: &St, tt: u8) -> usize {
        self.nodes.push(Node { kind, inv: pad_inv(&st.inv), aggressor: None });
        self.meta.push(NodeMeta::default());
        self.term_type.push(tt);
        self.nodes.len() - 1
    }

    /// returns (players ordered OOP -> IP, class id, terminal type 1 flop / 2 all-in / 3 three-way flop)
    fn class_for(&mut self, st: &St) -> (Vec<usize>, usize, u8) {
        let mut live: Vec<usize> = (0..6).filter(|&p| !st.folded[p]).collect();
        assert!(live.len() == 2 || live.len() == 3, "showdown must be 2 or 3 handed");
        live.sort_by_key(|&p| post_rank(p));
        let allin = st.cur >= self.cfg.stack - 1e-3;
        if allin {
            assert_eq!(live.len(), 2);
            let id = *self.class_ids.entry(-1).or_insert_with(|| {
                self.classes.push(ClassDef::AllIn);
                self.classes.len() - 1
            });
            return (live, id, 2);
        }
        let pot: f32 = st.inv.iter().sum();
        let spr = (self.cfg.stack - st.cur) / pot;
        let kq = (self.cfg.real.k(spr) * 32.0).round() as i32;
        let id = *self.class_ids.entry(kq).or_insert_with(|| {
            self.classes.push(ClassDef::Flop { kq });
            self.classes.len() - 1
        });
        let tt = if live.len() == 3 { 3 } else { 1 };
        (live, id, tt)
    }

    fn build(&mut self, st: &St) -> usize {
        let live: Vec<usize> = (0..6).filter(|&p| !st.folded[p]).collect();
        if live.len() == 1 {
            return self.terminal(Kind::Fold { winner: live[0] }, st, 0);
        }
        if st.pending.is_empty() {
            let (order, class, tt) = self.class_for(st);
            let kind = if order.len() == 3 {
                Kind::Showdown3 { p: [order[0], order[1], order[2]], class }
            } else if tt == 2 {
                Kind::Showdown { x: order[0], y: order[1], class }
            } else {
                // heads-up flop: x = in position, y = out of position
                Kind::Showdown { x: order[1], y: order[0], class }
            };
            return self.terminal(kind, st, tt);
        }
        let p = st.pending[0];
        let to_call = st.cur - st.inv[p];
        // (kind, to, next state)
        let mut acts: Vec<(ActKind, f32, St)> = Vec::new();
        if to_call > 1e-6 {
            let mut n = st.clone();
            n.folded[p] = true;
            n.pending.remove(0);
            acts.push((ActKind::Fold, 0.0, n));
        }
        // players already matched to the current bet (the raiser included)
        let matched = (0..6).filter(|&q| !st.folded[q] && (st.inv[q] - st.cur).abs() < 1e-4).count();
        let can_call = if st.level == 0 {
            p == SB || p == BB
        } else if st.level == 1 && st.cur >= self.cfg.stack - 1e-3 {
            to_call > 1e-6 && matched <= 1 // an open-jam can be called by one player only (no three-way all-ins)
        } else if st.level == 1 {
            to_call > 1e-6 && matched <= 2 // up to three players see the flop of a single-raised pot
        } else {
            to_call > 1e-6 && matched <= 1 // 3-bet pots and deeper stay heads-up
        };
        let mut call_real = None;
        if can_call {
            let mut n = st.clone();
            n.inv[p] = st.cur;
            if st.level > 0 {
                n.callers += 1;
            }
            n.pending.remove(0);
            if n.pending.is_empty() {
                // the call closes the action -> remember which realisation applies
                let live2: Vec<usize> = (0..6).filter(|&q| !n.folded[q]).collect();
                if n.cur < self.cfg.stack - 1e-3 {
                    let pot: f32 = n.inv.iter().sum();
                    let spr = (self.cfg.stack - n.cur) / pot;
                    let kq = (self.cfg.real.k(spr) * 32.0).round() as i32;
                    let is_ip = live2.iter().all(|&q| q == p || post_rank(p) > post_rank(q));
                    call_real = Some((kq, is_ip));
                }
            }
            acts.push((ActKind::Call, st.cur, n));
        }
        let normal = self.raise_to(st, p);
        // short stacks: a jam is a real option next to the normal raise (open-shove, re-shove over an open)
        let jam_too = st.cur < self.cfg.stack - 1e-3
            && ((st.level == 0 && self.cfg.stack <= self.cfg.open_jam_max) || (st.level == 1 && st.callers == 0 && self.cfg.stack <= self.cfg.shove_3bet_max))
            && normal.map(|x| x < self.cfg.stack - 1e-3).unwrap_or(false);
        let mut sizes: Vec<f32> = normal.into_iter().collect();
        if jam_too {
            sizes.push(self.cfg.stack);
        }
        for size in sizes {
            let mut n = st.clone();
            n.inv[p] = size;
            n.level += 1;
            n.cur = size;
            n.callers = 0;
            n.last_raiser = Some(p);
            n.pending = (1..6).map(|i| (p + i) % 6).filter(|&q| !n.folded[q]).collect();
            let kind = if size >= self.cfg.stack - 1e-3 { ActKind::AllIn } else { ActKind::Raise };
            acts.push((kind, size, n));
        }
        let idx = self.nodes.len();
        self.nodes.push(Node { kind: Kind::Fold { winner: 0 }, inv: pad_inv(&st.inv), aggressor: st.last_raiser });
        self.meta.push(NodeMeta {
            actions: acts.iter().map(|(k, t, _)| (*k as u8, *t)).collect(),
            call_real,
        });
        self.term_type.push(255);
        let mut children = Vec::new();
        for (_, _, n) in &acts {
            children.push(self.build(n));
        }
        self.nodes[idx].kind = Kind::Decision { player: p, children };
        idx
    }
}

pub fn build_preflop(cfg: &Config, t: &EquityTables) -> Preflop {
    let mut b = Builder {
        cfg,
        nodes: Vec::new(),
        meta: Vec::new(),
        term_type: Vec::new(),
        class_ids: HashMap::new(),
        classes: Vec::new(),
    };
    let mut inv = [0f32; 6];
    inv[SB] = 0.5;
    inv[BB] = 1.0;
    let st = St {
        inv,
        folded: [false; 6],
        level: 0,
        cur: 1.0,
        callers: 0,
        pending: vec![0, 1, 2, 3, 4, 5],
        last_raiser: None,
    };
    b.build(&st);

    let k = NUM_CLASSES;
    let mut compat = vec![0f32; k * k];
    for a in 0..k {
        for c in 0..k {
            compat[a * k + c] = t.n[a * k + c] / (class_count(a) * class_count(c)) as f32;
        }
    }
    let prior: Vec<f32> = (0..k).map(|c| class_count(c) as f32 / 1326.0).collect();
    let pm = build_pm(k, &compat, &prior);

    let mut classes = Vec::new();
    for def in &b.classes {
        match *def {
            ClassDef::AllIn => {
                let mut m = vec![0f32; k * k];
                for i in 0..k * k {
                    m[i] = pm[i] * t.eq[i];
                }
                classes.push(Class { a: m.clone(), b: m });
            }
            ClassDef::Flop { kq } => {
                let kk = kq as f32 / 32.0;
                let r_ip: Vec<f32> = (0..k).map(|h| cfg.real.factor(h, true, kk)).collect();
                let r_oop: Vec<f32> = (0..k).map(|h| cfg.real.factor(h, false, kk)).collect();
                let mut ma = vec![0f32; k * k];
                let mut mb = vec![0f32; k * k];
                for a in 0..k {
                    for c in 0..k {
                        let e = t.eq[a * k + c];
                        let ip_w = e * r_ip[a];
                        let oop_w = (1.0 - e) * r_oop[c];
                        let den = ip_w + oop_w;
                        let s = if den > 1e-9 { ip_w / den } else { 0.5 };
                        ma[a * k + c] = pm[a * k + c] * s; // rows = IP, cols = OOP
                        mb[c * k + a] = pm[c * k + a] * (1.0 - s); // rows = OOP, cols = IP
                    }
                }
                classes.push(Class { a: ma, b: mb });
            }
        }
    }
    let game = Game {
        n_players: 6,
        k,
        pm: vec![pm; 6],
        prior: vec![prior; 6],
        classes,
        nodes: b.nodes,
        raw_eq: Some(t.eq.clone()),
    };
    Preflop { game, meta: b.meta, cfg: cfg.clone(), classes: b.classes, term_type: b.term_type }
}

// ------------------------------------------------------------------ reporting

/// Find a decision node from a path string such as "FFFRF" (F fold, C call, R raise/all-in).
pub fn find_node(pf: &Preflop, path: &str) -> Option<usize> {
    let mut cur = 0usize;
    for ch in path.chars() {
        let kinds = &pf.meta[cur].actions;
        let want: &[u8] = match ch {
            'F' => &[0],
            'C' => &[1],
            'R' => &[2, 3],
            _ => return None,
        };
        let ai = kinds.iter().position(|(k, _)| want.contains(k))?;
        match &pf.game.nodes[cur].kind {
            Kind::Decision { children, .. } => cur = children[ai],
            _ => return None,
        }
    }
    matches!(pf.game.nodes[cur].kind, Kind::Decision { .. }).then_some(cur)
}

/// Combo-weighted action frequencies of the acting range at a node.
pub fn node_summary(pf: &Preflop, ev: &[Option<NodeEval>], node: usize) -> Option<(f32, Vec<f32>)> {
    let e = ev[node].as_ref()?;
    let k = pf.game.k;
    let na = pf.meta[node].actions.len();
    let mut tot = 0f64;
    let mut fr = vec![0f64; na];
    for h in 0..k {
        let w = class_count(h) as f64 * e.weight[h] as f64;
        tot += w;
        for a in 0..na {
            fr[a] += w * e.freq[a * k + h] as f64;
        }
    }
    if tot <= 0.0 {
        return None;
    }
    // fraction of all 1326 combos that reach the node (range width) and the action mix
    Some(((tot / 1326.0) as f32, fr.iter().map(|x| (*x / tot) as f32).collect()))
}

pub fn act_name(k: u8) -> &'static str {
    match k {
        0 => "F",
        1 => "C",
        2 => "R",
        _ => "A",
    }
}

pub fn report(pf: &Preflop, ev: &[Option<NodeEval>]) -> String {
    let lines: [(&str, &str); 13] = [
        ("UTG RFI", ""),
        ("HJ RFI", "F"),
        ("CO RFI", "FF"),
        ("BTN RFI", "FFF"),
        ("SB RFI", "FFFF"),
        ("BB vs SB limp", "FFFFC"),
        ("BB vs SB open", "FFFFR"),
        ("BB vs BTN open", "FFFRF"),
        ("BB vs CO open", "FFRFF"),
        ("BB vs UTG open", "RFFFF"),
        ("BTN vs UTG open", "RFF"),
        ("BTN open vs SB 3bet", "FFFRRF"),
        ("BTN open vs BB 3bet", "FFFRFR"),
    ];
    let mut s = String::new();
    for (name, path) in lines {
        if let Some(n) = find_node(pf, path) {
            if let Some((width, mix)) = node_summary(pf, ev, n) {
                let acts: Vec<String> = pf.meta[n]
                    .actions
                    .iter()
                    .zip(mix.iter())
                    .map(|((k, to), f)| format!("{}{}:{:5.1}%", act_name(*k), if *to > 0.0 { format!("{:.1}", to) } else { String::new() }, f * 100.0))
                    .collect();
                let _ = writeln!(s, "{:<22} reach {:5.1}%  {}", name, width * 100.0, acts.join("  "));
            }
        }
    }
    s
}

// ------------------------------------------------------------------ export

pub fn quantize_freq(f: &[f32]) -> Vec<u8> {
    // largest remainder so that the u8 values sum to exactly 255
    let total: f32 = f.iter().sum();
    let na = f.len();
    let scaled: Vec<f32> = f.iter().map(|x| if total > 0.0 { x / total * 255.0 } else { 255.0 / na as f32 }).collect();
    let mut q: Vec<u8> = scaled.iter().map(|x| x.floor() as u8).collect();
    let mut rem = 255i32 - q.iter().map(|&x| x as i32).sum::<i32>();
    let mut order: Vec<usize> = (0..na).collect();
    order.sort_by(|&a, &b| (scaled[b] - scaled[b].floor()).partial_cmp(&(scaled[a] - scaled[a].floor())).unwrap());
    let mut i = 0;
    while rem > 0 {
        q[order[i % na]] += 1;
        rem -= 1;
        i += 1;
    }
    q
}

pub struct ExportStats {
    pub nodes: usize,
    pub bytes: usize,
}

/// Write `manifest.json` and one raw `.bin` per chunk into `dir`.
/// (gzip is applied by `web/scripts/pack-solutions.mjs`; the crate has no deps.)
pub fn export(
    pf: &Preflop,
    ev: &[Option<NodeEval>],
    dir: &str,
    id: &str,
    info: &str,
    min_reach: f32,
) -> std::io::Result<ExportStats> {
    std::fs::create_dir_all(dir)?;
    let g = &pf.game;
    let k = g.k;

    // keep decision nodes that are actually played
    let keep: Vec<bool> = (0..g.nodes.len())
        .map(|i| matches!(g.nodes[i].kind, Kind::Decision { .. }) && ev[i].as_ref().map(|e| e.reach >= min_reach).unwrap_or(false))
        .collect();

    // DFS numbering + chunk assignment
    let mut new_id = vec![-1i32; g.nodes.len()];
    let mut order: Vec<usize> = Vec::new();
    let mut chunk_of: HashMap<usize, String> = HashMap::new();
    fn dfs(
        pf: &Preflop,
        keep: &[bool],
        i: usize,
        chunk: &str,
        order: &mut Vec<usize>,
        new_id: &mut Vec<i32>,
        chunk_of: &mut HashMap<usize, String>,
    ) {
        if !keep[i] {
            return;
        }
        new_id[i] = order.len() as i32;
        order.push(i);
        chunk_of.insert(i, chunk.to_string());
        if let Kind::Decision { player, children } = &pf.game.nodes[i].kind {
            for (ai, &c) in children.iter().enumerate() {
                let (kind, _) = pf.meta[i].actions[ai];
                let ch = if chunk == "root" && kind != 0 {
                    format!("{}-{}", POS[*player].to_lowercase(), if kind == 1 { "limp" } else { "open" })
                } else {
                    chunk.to_string()
                };
                dfs(pf, keep, c, &ch, order, new_id, chunk_of);
            }
        }
    }
    dfs(pf, &keep, 0, "root", &mut order, &mut new_id, &mut chunk_of);

    let mut chunk_names: Vec<String> = Vec::new();
    for &i in &order {
        let c = &chunk_of[&i];
        if !chunk_names.contains(c) {
            chunk_names.push(c.clone());
        }
    }

    // manifest
    let mut js = String::new();
    let _ = write!(
        js,
        "{{\"format\":1,\"id\":\"{}\",\"players\":[{}],\"stack\":{},\"blinds\":[0.5,1],\"info\":{},\"chunks\":[{}],\"nodes\":[",
        id,
        POS.iter().map(|p| format!("\"{}\"", p)).collect::<Vec<_>>().join(","),
        pf.cfg.stack,
        info,
        chunk_names.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(",")
    );
    for (n, &i) in order.iter().enumerate() {
        let (player, children) = match &g.nodes[i].kind {
            Kind::Decision { player, children } => (*player, children),
            _ => unreachable!(),
        };
        let e = ev[i].as_ref().unwrap();
        if n > 0 {
            js.push(',');
        }
        let acts: Vec<String> = children
            .iter()
            .enumerate()
            .map(|(ai, &c)| {
                let (kind, to) = pf.meta[i].actions[ai];
                let (child, term) = if keep[c] {
                    (new_id[c], -1)
                } else {
                    match g.nodes[c].kind {
                        Kind::Decision { .. } => (-2, -1),
                        _ => (-1, pf.term_type[c] as i32),
                    }
                };
                format!("[{},{},{},{}]", kind, to, child, term)
            })
            .collect();
        let chunk_idx = chunk_names.iter().position(|c| c == &chunk_of[&i]).unwrap();
        let _ = write!(js, "[{},{:.6},{},[{}]]", player, e.reach, chunk_idx, acts.join(","));
    }
    js.push_str("]}");
    std::fs::write(format!("{}/manifest.json", dir), js)?;

    // chunk files
    let mut total_bytes = 0;
    for (ci, name) in chunk_names.iter().enumerate() {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(b"TSR1");
        let members: Vec<usize> = order.iter().cloned().filter(|i| &chunk_of[i] == name).collect();
        buf.extend_from_slice(&(members.len() as u32).to_le_bytes());
        for &i in &members {
            let e = ev[i].as_ref().unwrap();
            let na = pf.meta[i].actions.len();
            buf.extend_from_slice(&(new_id[i] as u32).to_le_bytes());
            buf.push(na as u8);
            let eqr_a = pf.meta[i].call_real;
            buf.push(if eqr_a.is_some() { 1 } else { 0 });
            for h in 0..k {
                buf.push((e.weight[h].clamp(0.0, 1.0) * 255.0).round() as u8);
            }
            for h in 0..k {
                buf.push((e.eq.get(h).copied().unwrap_or(0.5).clamp(0.0, 1.0) * 255.0).round() as u8);
            }
            // freq[a][h]
            let mut fq = vec![0u8; na * k];
            for h in 0..k {
                let f: Vec<f32> = (0..na).map(|a| e.freq[a * k + h]).collect();
                let q = quantize_freq(&f);
                for a in 0..na {
                    fq[a * k + h] = q[a];
                }
            }
            buf.extend_from_slice(&fq);
            for a in 0..na {
                for h in 0..k {
                    let v = (e.ev[a * k + h] * 256.0).round().clamp(-32000.0, 32000.0) as i16;
                    buf.extend_from_slice(&v.to_le_bytes());
                }
            }
            if let Some((kq, ip)) = eqr_a {
                for h in 0..k {
                    let r = pf.cfg.real.factor(h, ip, kq as f32 / 32.0);
                    buf.push((r * 100.0).round().clamp(0.0, 255.0) as u8);
                }
            }
        }
        total_bytes += buf.len();
        std::fs::write(format!("{}/chunk-{}.bin", dir, ci), buf)?;
    }
    Ok(ExportStats { nodes: order.len(), bytes: total_bytes })
}

/// the engine supports up to `MAXP` players; the preflop game has six
fn pad_inv(inv: &[f32; 6]) -> [f32; MAXP] {
    let mut v = [0f32; MAXP];
    v[..6].copy_from_slice(inv);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizing_table() {
        let cfg = Config::default();
        let t = EquityTables { eq: vec![0.5; 169 * 169], n: vec![1.0; 169 * 169], samples: 0 };
        let pf = build_preflop(&cfg, &t);
        // UTG open 2.5, then HJ 3-bet (IP) to 7.5, UTG 4-bet to 17.5, jam
        let n = find_node(&pf, "R").unwrap();
        assert_eq!(pf.meta[n].actions[2], (2, 7.5));
        let n = find_node(&pf, "RR").unwrap();
        assert_eq!(pf.meta[n].actions.last().unwrap(), &(2u8, 17.5));
        // BB 3-bet vs BTN open is OOP-sized
        let n = find_node(&pf, "FFFRF").unwrap();
        assert_eq!(pf.meta[n].actions.last().unwrap(), &(2u8, 11.0));
        // every showdown is heads-up, tree is finite and non-trivial
        assert!(pf.game.nodes.len() > 1000);
    }
}

