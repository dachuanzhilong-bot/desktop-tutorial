/**
 * Tells when a newer version of the app has taken over from the one this page was loaded with.
 *
 * The service worker skips waiting and claims its clients, so the page keeps running the old scripts while the
 * worker already serves the new files: the next screen it loads could mix the two. A `controllerchange` is that
 * moment, except on a first visit, when the page had no controller and the worker's first claim is not an update.
 */
export interface UpdateSource {
  controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

/** calls `onUpdate` once when a new worker takes over a page that was already under a worker; returns the cleanup */
export function watchForUpdate(source: UpdateSource, onUpdate: () => void): () => void {
  const hadController = !!source.controller;
  let fired = false;
  const listener = () => {
    if (!hadController || fired) return;
    fired = true;
    onUpdate();
  };
  source.addEventListener("controllerchange", listener);
  return () => source.removeEventListener("controllerchange", listener);
}
