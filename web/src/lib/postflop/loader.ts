import { gunzip } from "../solution/decode";
import { decodeFlop, PfFlop } from "./decode";
import { parseBoard } from "./combos";

export interface PfScenario {
  id: string;
  title: string;
  pot: number;
  stack: number;
  oop: string;
  ip: string;
  oopPct: number;
  ipPct: number;
  iterations: number;
  turnCards: number;
  riverCards: number;
}

export interface FlopStats {
  eqOop: number;
  eqIp: number;
  exploit: number;
  /** [kind, amount] of OOP's root actions and the mix */
  oopActs?: [number, number][];
  oop?: number[];
  ipActs?: [number, number][];
  ipVsCheck?: number[];
}

export interface PfIndex {
  flops: string[];
  scenarios: PfScenario[];
  stats: Record<string, FlopStats>;
}

const base = "/postflop";
let indexP: Promise<PfIndex> | null = null;
const flopCache = new Map<string, Promise<PfFlop>>();

export function loadIndex(): Promise<PfIndex> {
  if (!indexP) {
    indexP = fetch(`${base}/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`index ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        indexP = null;
        throw e;
      });
  }
  return indexP;
}

// decoding a flop file (about 0.5 MB, thousands of tree nodes) runs in a Web Worker when one is available
let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve: (f: PfFlop) => void; reject: (e: Error) => void }>();
function flopWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("../../workers/flop.worker.ts", import.meta.url));
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; flop?: PfFlop; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.flop) w.resolve(e.data.flop);
      else w.reject(new Error(e.data.error ?? "worker error"));
    };
    worker.onerror = () => {
      for (const w of waiting.values()) w.reject(new Error("worker error"));
      waiting.clear();
    };
  }
  return worker;
}

const fetchAndDecode = (url: string) =>
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`flop ${r.status}`);
      return r.arrayBuffer();
    })
    .then(gunzip)
    .then(decodeFlop);

export function loadFlop(scenario: string, flop: number): Promise<PfFlop> {
  const key = `${scenario}/${flop}`;
  let p = flopCache.get(key);
  if (!p) {
    const url = `${base}/${scenario}/${flop}.bin.gz`;
    const w = flopWorker();
    p = w
      ? new Promise<PfFlop>((resolve, reject) => {
          const id = nextId++;
          waiting.set(id, { resolve, reject });
          w.postMessage({ id, url: new URL(url, location.href).href });
        }).catch(() => fetchAndDecode(url)) // a worker that cannot start or fetch: decode here
      : fetchAndDecode(url);
    p.catch(() => flopCache.delete(key));
    flopCache.set(key, p);
  }
  return p;
}

export const flopCards = (text: string) => parseBoard(text);
