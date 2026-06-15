// Latest AI DecisionTrace store (client-only, off the authoritative path).
//
// The vs-AI driver (`useVsAiDriver`) and the Debug panel live in different
// component subtrees, so the trace is handed between them through this tiny
// external store instead of prop-drilling GameState-adjacent data. The driver
// pushes the most recent trace; the Debug panel reads it via `useLatestAiTrace`
// (a `useSyncExternalStore` hook). Only the latest decision is kept — by design
// (see the grill: "ultima decisione, sempre visibile"). Never persisted.

import type { DecisionTrace } from "@convex/gre";

let latest: DecisionTrace | null = null;
const listeners = new Set<() => void>();

export function setLatestAiTrace(trace: DecisionTrace | null): void {
    latest = trace;
    for (const l of listeners) l();
}

export function getLatestAiTrace(): DecisionTrace | null {
    return latest;
}

export function subscribeAiTrace(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
