import type { Grade } from "../practice/grading";
import type { SrsItem } from "../practice/srs";
import type { SpotType } from "../solution/types";
import type { HandAnalysis } from "../analyze/match";
import type { NormHand } from "../analyze/normalize";

export interface Attempt {
  id?: number;
  ts: number;
  sessionId: string;
  mode: "spot" | "hand" | "post" | "postSpot";
  solution: string;
  nodeId: number;
  hand: number;
  seat: number;
  spot: SpotType;
  chosen: number;
  best: number;
  grade: Grade;
  evLoss: number;
  score: number;
  ms: number;
  rng: boolean;
  timeout: boolean;
  hint: boolean;
  /** came from the server (cloud sync): never uploaded again */
  remote?: boolean;
}

/** a finished (or cancelled) custom solve, kept on this device */
export interface SavedSolve {
  id: string;
  ts: number;
  title: string;
  board: number[];
  /** SolveConfig as it was solved */
  cfg: unknown;
  oopName: string;
  ipName: string;
  oopText: string;
  ipText: string;
  exploit: number;
  iterations: number;
  /** TSP1 file */
  bytes: Uint8Array;
  /** exported node id -> solver tree node (for node-locking after a reload the tree is rebuilt, so only informative) */
  nodes: number;
}

/** a named range made in the Range Builder (weights as PIO-style text) */
export interface SavedRange {
  id: string;
  ts: number;
  name: string;
  text: string;
}

/** an imported hand history with its analysis (re-analysable when the solution changes) */
export interface StoredHand {
  id: string;
  site: string;
  ts: number;
  importedAt: number;
  hand: NormHand;
  analysis: HandAnalysis;
}

export interface Repo {
  addAttempt(a: Attempt): Promise<void>;
  allAttempts(): Promise<Attempt[]>;
  allSrs(): Promise<SrsItem[]>;
  putSrs(item: SrsItem): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta<T>(key: string, value: T): Promise<void>;
  exportAll(): Promise<ExportBlob>;
  importAll(blob: ExportBlob): Promise<void>;
  clear(): Promise<void>;
  putSolve(s: SavedSolve): Promise<void>;
  listSolves(): Promise<SavedSolve[]>;
  getSolve(id: string): Promise<SavedSolve | undefined>;
  deleteSolve(id: string): Promise<void>;
  putRange(r: SavedRange): Promise<void>;
  listRanges(): Promise<SavedRange[]>;
  deleteRange(id: string): Promise<void>;
  putHands(list: StoredHand[]): Promise<void>;
  listHands(): Promise<StoredHand[]>;
  deleteHand(id: string): Promise<void>;
  clearHands(): Promise<void>;
}

export interface ExportBlob {
  app: "tessera";
  version: 1;
  exportedAt: number;
  attempts: Attempt[];
  srs: SrsItem[];
  meta: Record<string, unknown>;
  /** named ranges travel with the export; solves are big and can be recomputed, so they stay on the device */
  ranges?: SavedRange[];
  /** imported hand histories (with analysis) */
  hands?: StoredHand[];
}
