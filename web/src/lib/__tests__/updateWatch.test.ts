import { describe, expect, it } from "vitest";
import { watchForUpdate } from "../pwa/updateWatch";
import type { UpdateSource } from "../pwa/updateWatch";

function fake(controller: unknown) {
  const listeners = new Set<() => void>();
  const source: UpdateSource = {
    controller,
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
  };
  return { source, fire: () => [...listeners].forEach((l) => l()), count: () => listeners.size };
}

describe("update watch", () => {
  it("reports a worker taking over a page that was already controlled, once", () => {
    const f = fake({});
    let n = 0;
    watchForUpdate(f.source, () => n++);
    f.fire();
    f.fire();
    expect(n).toBe(1);
  });

  it("ignores the first claim on a first visit (no controller yet)", () => {
    const f = fake(null);
    let n = 0;
    watchForUpdate(f.source, () => n++);
    f.fire();
    expect(n).toBe(0);
  });

  it("stops listening after cleanup", () => {
    const f = fake({});
    let n = 0;
    const stop = watchForUpdate(f.source, () => n++);
    expect(f.count()).toBe(1);
    stop();
    expect(f.count()).toBe(0);
    f.fire();
    expect(n).toBe(0);
  });
});
