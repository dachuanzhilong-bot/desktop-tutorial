//! Reads the preflop solution written by `preflop::export` (raw `manifest.json` + `chunk-N.bin`)
//! so that postflop ranges can be cut out of it.  A tiny JSON reader keeps the crate dependency free.
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub enum J {
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

pub fn parse_json(s: &str) -> J {
    let b = s.as_bytes();
    let mut i = 0;
    fn ws(b: &[u8], i: &mut usize) {
        while *i < b.len() && (b[*i] as char).is_whitespace() {
            *i += 1;
        }
    }
    fn val(b: &[u8], i: &mut usize) -> J {
        ws(b, i);
        match b[*i] {
            b'[' => {
                *i += 1;
                let mut v = Vec::new();
                loop {
                    ws(b, i);
                    if b[*i] == b']' {
                        *i += 1;
                        break;
                    }
                    v.push(val(b, i));
                    ws(b, i);
                    if b[*i] == b',' {
                        *i += 1;
                    }
                }
                J::Arr(v)
            }
            b'{' => {
                *i += 1;
                let mut v = Vec::new();
                loop {
                    ws(b, i);
                    if b[*i] == b'}' {
                        *i += 1;
                        break;
                    }
                    let k = match val(b, i) {
                        J::Str(s) => s,
                        _ => panic!("object key"),
                    };
                    ws(b, i);
                    *i += 1; // ':'
                    v.push((k, val(b, i)));
                    ws(b, i);
                    if b[*i] == b',' {
                        *i += 1;
                    }
                }
                J::Obj(v)
            }
            b'"' => {
                *i += 1;
                let st = *i;
                while b[*i] != b'"' {
                    *i += 1;
                }
                let s = String::from_utf8_lossy(&b[st..*i]).to_string();
                *i += 1;
                J::Str(s)
            }
            _ => {
                let st = *i;
                while *i < b.len() && !matches!(b[*i], b',' | b']' | b'}' | b' ' | b'\n') {
                    *i += 1;
                }
                J::Num(String::from_utf8_lossy(&b[st..*i]).parse().unwrap_or(0.0))
            }
        }
    }
    val(b, &mut i)
}

pub struct PfAction {
    pub kind: u8,
    pub to: f32,
    pub child: i32,
}

pub struct PfNode {
    pub actor: u8,
    pub reach: f32,
    pub chunk: usize,
    pub actions: Vec<PfAction>,
}

pub struct PfData {
    pub na: usize,
    pub weight: Vec<f32>,
    pub freq: Vec<f32>,
}

pub struct PfSolution {
    pub nodes: Vec<PfNode>,
    pub data: Vec<HashMap<u32, PfData>>,
}

const K: usize = 169;

pub fn load(dir: &str) -> std::io::Result<PfSolution> {
    let m = parse_json(&std::fs::read_to_string(format!("{}/manifest.json", dir))?);
    let obj = match m {
        J::Obj(o) => o,
        _ => panic!("manifest"),
    };
    let get = |k: &str| obj.iter().find(|(n, _)| n == k).map(|(_, v)| v).unwrap();
    let num = |j: &J| match j {
        J::Num(x) => *x,
        _ => 0.0,
    };
    let nodes: Vec<PfNode> = match get("nodes") {
        J::Arr(v) => v
            .iter()
            .map(|n| match n {
                J::Arr(f) => PfNode {
                    actor: num(&f[0]) as u8,
                    reach: num(&f[1]) as f32,
                    chunk: num(&f[2]) as usize,
                    actions: match &f[3] {
                        J::Arr(a) => a
                            .iter()
                            .map(|x| match x {
                                J::Arr(t) => PfAction { kind: num(&t[0]) as u8, to: num(&t[1]) as f32, child: num(&t[2]) as i32 },
                                _ => panic!(),
                            })
                            .collect(),
                        _ => panic!(),
                    },
                },
                _ => panic!(),
            })
            .collect(),
        _ => panic!(),
    };
    let n_chunks = match get("chunks") {
        J::Arr(v) => v.len(),
        _ => 0,
    };
    let mut data = Vec::new();
    for c in 0..n_chunks {
        let b = std::fs::read(format!("{}/chunk-{}.bin", dir, c))?;
        assert_eq!(&b[0..4], b"TSR1");
        let count = u32::from_le_bytes([b[4], b[5], b[6], b[7]]) as usize;
        let mut o = 8;
        let mut map = HashMap::new();
        for _ in 0..count {
            let id = u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
            let na = b[o + 4] as usize;
            let flags = b[o + 5];
            o += 6;
            let weight: Vec<f32> = (0..K).map(|h| b[o + h] as f32 / 255.0).collect();
            o += K; // weight
            o += K; // equity
            let mut freq = vec![0f32; na * K];
            for h in 0..K {
                let s: f32 = (0..na).map(|a| b[o + a * K + h] as f32).sum();
                for a in 0..na {
                    freq[a * K + h] = if s > 0.0 { b[o + a * K + h] as f32 / s } else { 1.0 / na as f32 };
                }
            }
            o += na * K;
            o += na * K * 2; // ev
            if flags & 1 == 1 {
                o += K;
            }
            map.insert(id, PfData { na, weight, freq });
        }
        data.push(map);
    }
    Ok(PfSolution { nodes, data })
}

impl PfSolution {
    /// follow "F"/"C"/"R" from the root
    pub fn find(&self, path: &str) -> Option<u32> {
        let mut cur = 0usize;
        for ch in path.chars() {
            let want: &[u8] = match ch {
                'F' => &[0],
                'C' => &[1],
                'R' => &[2, 3],
                _ => return None,
            };
            let a = self.nodes[cur].actions.iter().find(|a| want.contains(&a.kind))?;
            if a.child < 0 {
                return None;
            }
            cur = a.child as usize;
        }
        Some(cur as u32)
    }

    /// range (weight x frequency) of the hands that take the first action of `kinds` at `node`
    pub fn range(&self, node: u32, kinds: &[u8]) -> Option<Vec<f32>> {
        let n = &self.nodes[node as usize];
        let d = self.data[n.chunk].get(&node)?;
        let ai = n.actions.iter().position(|a| kinds.contains(&a.kind))?;
        Some((0..K).map(|h| d.weight[h] * d.freq[ai * K + h]).collect())
    }
}
