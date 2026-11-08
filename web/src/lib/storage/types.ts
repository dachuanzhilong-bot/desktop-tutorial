import type { Grade } from "../practice/grading";
import type { SrsItem } from "../practice/srs";
import type { SpotType } from "../solution/types";

export interface Attempt {
  id?: number;
  ts: number;
  sessionId: string;
  mode: "spot" | "hand";
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
}

export interface ExportBlob {
  app: "tessera";
  version: 1;
  exportedAt: number;
  attempts: Attempt[];
  srs: SrsItem[];
  meta: Record<string, unknown>;
}
