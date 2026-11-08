/** Action kinds as exported by the solver. */
export enum ActionKind {
  Fold = 0,
  Call = 1,
  Raise = 2,
  AllIn = 3,
}

/** terminal after an action: -1 = none (child is a decision node) */
export enum Terminal {
  None = -1,
  /** everybody folded, pot awarded */
  Fold = 0,
  /** heads-up flop */
  Flop = 1,
  /** all-in, runs out */
  AllIn = 2,
  /** three players see the flop */
  FlopMulti = 3,
}

export interface ActionMeta {
  kind: ActionKind;
  /** raise-to amount in bb (call: the amount called to), 0 for fold */
  to: number;
  /** child node id, or -1 terminal, or -2 never played (pruned) */
  child: number;
  term: Terminal;
}

export interface NodeMeta {
  id: number;
  actor: number;
  /** probability that the line leading here is played (all players' ranges) */
  reach: number;
  chunk: number;
  actions: ActionMeta[];
  parent: number;
  /** index of the action in the parent that leads here */
  parentAction: number;
}

export interface Manifest {
  format: number;
  id: string;
  players: string[];
  stack: number;
  blinds: [number, number];
  info: Record<string, unknown>;
  chunks: string[];
  nodes: NodeMeta[];
}

/** per-node data of the acting player's 169 hand classes */
export interface NodeSolution {
  id: number;
  na: number;
  /** probability that the class reaches this node (own range), 0..1 */
  weight: Float32Array;
  /** raw all-in equity against the aggressor's range (random hand if none) */
  equity: Float32Array;
  /** na * 169, row-major by action */
  freq: Float32Array;
  /** na * 169, expected final result in bb (net of everything invested) */
  ev: Float32Array;
  /** realised-equity factor assumed when the call ends the betting (only if hasEqr) */
  eqr: Float32Array | null;
}

export interface PublicState {
  inv: number[];
  folded: boolean[];
  pot: number;
  /** current bet to match */
  cur: number;
  /** number of raises so far (0 none, 1 open, 2 3-bet ...) */
  level: number;
  lastRaiser: number | null;
  /** players that called at the current raise level */
  callers: number[];
  /** limp happened (level 0 call) */
  limped: boolean;
}

export type SpotType = "rfi" | "limp" | "vsOpen" | "squeeze" | "vs3bet" | "vsSqueeze" | "vs4bet" | "vs5bet";
export const SPOT_TYPES: SpotType[] = ["rfi", "limp", "vsOpen", "squeeze", "vs3bet", "vsSqueeze", "vs4bet", "vs5bet"];
