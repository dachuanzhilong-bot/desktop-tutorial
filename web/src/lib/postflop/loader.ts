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

export function loadFlop(scenario: string, flop: number): Promise<PfFlop> {
  const key = `${scenario}/${flop}`;
  let p = flopCache.get(key);
  if (!p) {
    p = fetch(`${base}/${scenario}/${flop}.bin.gz`)
      .then((r) => {
        if (!r.ok) throw new Error(`flop ${r.status}`);
        return r.arrayBuffer();
      })
      .then(gunzip)
      .then(decodeFlop);
    p.catch(() => flopCache.delete(key));
    flopCache.set(key, p);
  }
  return p;
}

export const flopCards = (text: string) => parseBoard(text);
