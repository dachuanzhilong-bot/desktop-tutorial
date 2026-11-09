/** let the browser paint and handle input before continuing a long loop */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => setTimeout(r, 0));
}

/** returns a function to call inside a loop: it yields once the current slice has run for `budgetMs` */
export function timeSlicer(budgetMs = 12) {
  let start = performance.now();
  return async () => {
    if (performance.now() - start < budgetMs) return;
    await yieldToMain();
    start = performance.now();
  };
}
