// The finished game's Verdict Proposal list, handed from the vs-Bot driver to
// whatever renders it (issue #3984; the panel is issue #3986) — a tiny
// external store, like `trace-store.ts`, so no GameState-adjacent data is
// prop-drilled across subtrees.
//
// Client memory only, and that is the contract rather than a shortcut: a
// proposal is an unanswered QUESTION. Nothing here is written to the Verdict
// Store; one left unanswered disappears with the game (`clearVerdictProposals`
// on a game swap or unmount) and no judgement is recorded for it.

import type { VerdictProposalList } from "./verdict-proposals";

type Entry = { gameId: string; list: VerdictProposalList };

let entry: Entry | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

export function setVerdictProposals(
    gameId: string,
    list: VerdictProposalList
): void {
    entry = { gameId, list };
    emit();
}

/** The proposals of `gameId`, or `null` when there are none for it. */
export function getVerdictProposals(
    gameId: string
): VerdictProposalList | null {
    return entry && entry.gameId === gameId ? entry.list : null;
}

export function clearVerdictProposals(): void {
    if (entry === null) return;
    entry = null;
    emit();
}

export function subscribeVerdictProposals(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
