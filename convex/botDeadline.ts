// The server deadline of the Bot liveness guarantee (PRD issue #8998, issue
// #9004): the layer that holds when NO client acts — the driver crashed, its
// Worker wedged, the tab is closed. Pure and client-importable: the deadline
// constant and the planner that decides, from the `gameTicks` row alone, what
// the one scheduled check per game does. The Convex wiring — arming in
// `saveGameState`'s tick writer, the `checkDeadline` internal mutation — lives
// in `convex/gameStateStore.ts` and `convex/botLiveness.ts`.
//
// At most ONE check is pending per game: `botDeadlineAt` on the tick row is the
// marker. A save never schedules while it stands; only the check itself clears
// it or moves it forward, so a vs-AI game costs one scheduled function per
// Bot-owed stretch, not one per action.

/** How long the Bot may sit owed on one state version before the server moves
 *  it. ABOVE the whole client ladder: the driver's watchdog fires every
 *  `BOT_WATCHDOG_MS` (6 s, `src/hooks/useVsAiDriver.ts`) and its ladder has 5
 *  rungs, the last of which hands off to `reportStall` — ~36 s from the stall
 *  to the client's own hand-off. A live driver therefore always acts first; the
 *  deadline fires only when it never will. */
export const BOT_SERVER_DEADLINE_MS = 60_000;

/** The slice of a `gameTicks` row the planner reads. */
export type BotDeadlineTick = {
    seq: number;
    updatedAt: number;
    gameOver?: boolean;
    owedPlayerIds?: string[];
    botDeadlineAt?: number;
};

/** What woke the planner: a stable save (may arm), or the scheduled check
 *  armed for state version `seq` (may clear, re-arm or enforce). */
export type BotDeadlineTrigger =
    | { kind: "save" }
    | { kind: "check"; seq: number };

export type BotDeadlineAction =
    /** Nothing to schedule, nothing to clear. */
    | { kind: "none" }
    /** A check is already pending for this game: schedule nothing. */
    | { kind: "already-pending" }
    /** Schedule the check for `seq` at `at`, and record `at` on the tick. */
    | { kind: "arm"; at: number; seq: number }
    /** The Bot is no longer owed (or the game is over): drop the marker. */
    | { kind: "clear" }
    /** Same seq, deadline passed: force-advance the Bot's window. */
    | { kind: "enforce" };

/** True when no check stands behind the marker: none recorded, or one a full
 *  deadline overdue — its job failed (a throw rolls back its own clear), and
 *  only a fresh arm can bring the sentinel back. */
function orphaned(botDeadlineAt: number | undefined, now: number): boolean {
    return (
        botDeadlineAt === undefined ||
        botDeadlineAt + BOT_SERVER_DEADLINE_MS <= now
    );
}

/** True when the tick says the Bot seat owes input in a live game. */
function botOwed(tick: BotDeadlineTick, botId: string): boolean {
    return tick.gameOver !== true && (tick.owedPlayerIds ?? []).includes(botId);
}

/**
 * The deadline's one decision. `botId` is the Bot seat (`botSeatId`), `null`
 * outside a vs-AI game — which never arms.
 *
 * - **save**: Bot owed, no check pending → arm for `now + deadline`; a check
 *   pending → `already-pending` (a marker a full deadline overdue is an
 *   orphan, re-armed); else nothing (a pending check clears itself).
 * - **check**: Bot not owed or game over → clear. Owed at a NEWER seq than the
 *   one armed → arm again, for the newer version's own deadline
 *   (`updatedAt + deadline`). Same seq, deadline reached → enforce.
 */
export function planBotDeadline(input: {
    tick: BotDeadlineTick;
    botId: string | null;
    trigger: BotDeadlineTrigger;
    now: number;
}): BotDeadlineAction {
    const { tick, botId, trigger, now } = input;
    if (trigger.kind === "save") {
        if (botId === null || !botOwed(tick, botId)) return { kind: "none" };
        if (!orphaned(tick.botDeadlineAt, now))
            return { kind: "already-pending" };
        return { kind: "arm", at: now + BOT_SERVER_DEADLINE_MS, seq: tick.seq };
    }
    if (botId === null || !botOwed(tick, botId)) return { kind: "clear" };
    const due = tick.updatedAt + BOT_SERVER_DEADLINE_MS;
    if (tick.seq !== trigger.seq || now < due) {
        // Never in the past: a check that ran late must not record a marker
        // a save would already read as orphaned (a second chain).
        return { kind: "arm", at: Math.max(due, now), seq: tick.seq };
    }
    return { kind: "enforce" };
}
