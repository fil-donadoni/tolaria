// Residency of the client's Definition Shards as an EXTERNAL STORE (issue
// #5615, widened to the compiled shards by issue #5616): a hand-written Set
// chunk, a compiled shard, the compiled index — each becoming resident bumps
// one version.
//
// Residency is state OUTSIDE React, and a component that reads it (the
// board's hold) must re-read it when it changes: this is the store
// `useSyncExternalStore` subscribes to. The version is the one value a
// memoising caller can key on — the React Compiler memoises a call by its
// arguments and cannot see a Map a function reads behind them.
//
// The VERSION moves at once; the NOTIFICATION is coalesced to one per task
// (issue #9822). A mass install — the verdict quiz making every hand-written
// Set resident, ~180 chunks settling one microtask after another — used to
// fan out once per Set, and every fan-out forces a SYNC re-render of each
// `useSyncExternalStore` subscriber. With a subscriber whose effect schedules
// an ordinary update on the new version, each of those sync commits ends with
// that update still pending, and React counts it as one more nested update:
// the 51st throws "Maximum update depth exceeded" (#185) out of the install's
// `Promise.all`. One fan-out after the burst is one re-render, and nothing a
// reader sees is stale: `useSyncExternalStore` reads `residencyVersion` at
// every render, and every residency answer reads the loader's state directly.
const listeners = new Set<() => void>();
let version = 0;
let notifyScheduled = false;

/** How many residency changes this graph has seen: changes exactly when a
 *  residency answer can change. */
export function residencyVersion(): number {
    return version;
}

/** Called after residency changes — once per task however many changed in
 *  it. Returns the unsubscribe. */
export function subscribeResidency(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function notifyListeners(): void {
    notifyScheduled = false;
    for (const listener of listeners) listener();
}

/** Something became resident: bump the version now, tell every subscriber
 *  once the current task — and every install settling in it — is done. A
 *  MACROtask on purpose: a microtask would run between two installs settling
 *  in the same burst, which is the storm this coalesces. */
export function noteResident(): void {
    version++;
    if (notifyScheduled) return;
    notifyScheduled = true;
    setTimeout(notifyListeners, 0);
}
