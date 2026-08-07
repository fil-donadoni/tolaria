// Pure, client-importable derivation of a bug report's attached game
// snapshot into the "board context" facts (issue #2250). Extracted out of
// `convex/bugReports.ts` so there is exactly ONE place that reads
// `state.turn` / `state.phase` / `state.activePlayerId` /
// `state.priorityPlayerId` / owed-input off a snapshot — the header this
// module derives is rendered TWICE: as markdown, in the public GitHub issue
// body (`buildGameStateSection`, `convex/bugReports.ts`); and as UI, in the
// `/admin/bug-reports` detail view (`BugReportSnapshotHeader`,
// `src/components/admin/`). A component re-reading these fields by hand
// would be a second copy that drifts the moment the state shape changes
// (CLAUDE.md § Code Organization: extract, don't inline; no local copies).
//
// Import-safe from the client: pure TS, no `ctx`, no node/Convex-server
// imports — the frontend already imports pure engine/pure modules this way
// (ADR 0074), it never gains AUTHORITY by doing so.

export type GameSnapshot = {
    gameId: string;
    seq: number;
    state: Record<string, unknown>;
};

/**
 * Names the containers that are holding the game up, derived from the
 * state's own keys rather than from a hand-written list. Every "the game is
 * waiting on someone" container in `GameState` is named `pending*`
 * (`pendingCast`, `pendingActivation`, `pendingChoices`, `pendingTarget`,
 * `pendingCompanionPay`, …), so a census over the keys stays correct when a
 * new one is added — a hand-maintained list is precisely how #1209's park
 * family grew uncovered one member at a time.
 */
export function describeOwedInput(state: Record<string, unknown>): string[] {
    const owed: string[] = [];
    for (const key of Object.keys(state).sort()) {
        if (!key.startsWith("pending")) continue;
        const value = state[key];
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            if (value.length > 0) owed.push(`${key}[${value.length}]`);
            continue;
        }
        owed.push(key);
    }
    return owed;
}

/** Structured board-context summary of a game snapshot — turn/phase/priority
 *  facts plus owed input, WITHOUT the state itself. Each consumer formats its
 *  own view on top: `buildGameStateSection` turns it into a markdown line,
 *  `BugReportSnapshotHeader` turns it into a row of `<span>`s. */
export type GameSnapshotSummary = {
    gameId: string;
    seq: number;
    turn: string;
    phase: string;
    activePlayerId: string;
    priorityPlayerId: string;
    owedInput: string[];
};

export function summarizeGameSnapshot(
    snapshot: GameSnapshot
): GameSnapshotSummary {
    const { state } = snapshot;
    return {
        gameId: snapshot.gameId,
        seq: snapshot.seq,
        turn: String(state.turn ?? "?"),
        phase: String(state.phase ?? "?"),
        activePlayerId: String(state.activePlayerId ?? "?"),
        priorityPlayerId: String(state.priorityPlayerId ?? "?"),
        owedInput: describeOwedInput(state),
    };
}
