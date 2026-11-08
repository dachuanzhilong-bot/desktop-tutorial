/** the Solve screen's unsaved inputs survive navigation (e.g. a trip to the Range Builder) in localStorage */
export interface SolveDraft {
  board: number[];
  oopText: string;
  ipText: string;
  pot: number;
  stack: number;
  [k: string]: unknown;
}

const KEY = "tessera.solveDraft.v1";

export function loadDraft(): Partial<SolveDraft> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<SolveDraft>) : {};
  } catch {
    return {};
  }
}

export function saveDraft(patch: Partial<SolveDraft>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadDraft(), ...patch }));
  } catch {
    /* private mode: the draft just does not persist */
  }
}
