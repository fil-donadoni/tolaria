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
const listeners = new Set<() => void>();
let version = 0;

/** How many residency changes this graph has seen: changes exactly when a
 *  residency answer can change. */
export function residencyVersion(): number {
    return version;
}

/** Called after every residency change. Returns the unsubscribe. */
export function subscribeResidency(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Something became resident: bump the version, tell every subscriber. */
export function noteResident(): void {
    version++;
    for (const listener of listeners) listener();
}
