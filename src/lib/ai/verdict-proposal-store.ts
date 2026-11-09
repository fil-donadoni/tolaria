// The finished game's Verdict Proposal list, handed from the vs-Bot driver to
// whatever renders it (issue #3984; the panel is issue #3986) — a tiny
// external store, like `trace-store.ts`, so no GameState-adjacent data is
// prop-drilled across subtrees.
//
// Client-side only, and that is the contract rather than a shortcut: a
// proposal is an unanswered QUESTION. Nothing here is written to the Verdict
// Store, and no judgement is recorded for one left unanswered.
//
// RELOAD-SAFE. The list is also written to client storage
// (`verdict-proposal-persistence.ts`, best-effort, ONE row: the most recent
// finished game's list), so reloading or reopening that game's game-over
// dialog offers the same review again without consulting the Brain:
// `loadVerdictProposals` brings it back into memory. `clearVerdictProposals`
// (a game swap, an unmount) empties memory only — the reload needs the row.

import type { VerdictProposalList } from "./verdict-proposals";
import {
    readProposalStore,
    writeProposalStore,
} from "./verdict-proposal-persistence";

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
    void writeProposalStore("proposals", { latest: { gameId, list } }, true);
}

function isStoredList(x: unknown): x is VerdictProposalList {
    return (
        typeof x === "object" &&
        x !== null &&
        Array.isArray((x as VerdictProposalList).proposals)
    );
}

/** `gameId`'s list — from memory, else from storage (then landed in memory
 *  for the subscribers) — or `null` when neither holds one. Never throws. */
export async function loadVerdictProposals(
    gameId: string
): Promise<VerdictProposalList | null> {
    const held = getVerdictProposals(gameId);
    if (held) return held;
    const rows = await readProposalStore("proposals");
    const latest = rows.latest as { gameId?: unknown; list?: unknown } | null;
    if (!latest || latest.gameId !== gameId || !isStoredList(latest.list)) {
        return null;
    }
    // A list that landed meanwhile (a build that finished first) wins.
    const now = getVerdictProposals(gameId);
    if (now) return now;
    entry = { gameId, list: latest.list };
    emit();
    return latest.list;
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
