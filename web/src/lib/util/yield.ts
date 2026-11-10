/**
 * Let the browser paint, handle input and run timers before continuing a long loop.
 * (Not scheduler.yield(): its continuation is queued ahead of other tasks, so timers would starve.)
 */
export function yieldToMain(): Promise<void> {
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
