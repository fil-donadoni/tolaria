// The browser's stack journal (issue #3480, PRD #3397).
//
// `convex/gre/ai/verdicts/journal.ts` is the model — the board the last time
// the stack was empty, plus the engine-real steps taken since, which is what
// lets a decision taken WITH SOMETHING ON THE STACK become a Verdict at all.
// This is the client's half: the vs-AI driver hands over every Move it submits
// and this decides, when a tester actually opens the quiz, which of them make
// up the window.
//
// WHY IT RECORDS RAW AND COMPUTES LATE. The driver submits a Move per bot
// decision, and almost none of those decisions is ever judged. Building the
// journal eagerly would mean a `projectedToGameState` per move on the MAIN
// thread — the one place in this app that must not stutter — to produce a
// record nobody reads. So a ply is stored as what the driver already holds
// (the projection it decided on, the seat, the Move: three references, no
// copy) and the whole lowering happens once, inside `journalEntryFor`, when
// the panel asks.
//
// WHAT IT DOES NOT SEE, said out loud. The driver drives the BOT's seat. A
// move the human makes in the same window reaches this store not at all, so a
// window containing one produces a walk that rebuilds a different position.
// That is not papered over: `lowerDecision` compares the replayed STACK
// against the live one object for object and the rebuilt candidate list
// against the live one move for move, and refuses on either mismatch
// (`stack-not-journalled`). The journal is allowed to be incomplete; it is
// never allowed to be wrong.

import { projectedToGameState } from "./state-adapter";
import {
    journalStepForMove,
    type JournalStep,
    type StackJournalEntry,
} from "@convex/gre/ai/verdicts/journal";
import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import type { DeckKnowledgeBySeat } from "./state-adapter";

/** One submitted move, exactly as the driver held it. */
export type RecordedPly = {
    /** The projection the move was decided and submitted on. */
    state: PublicGameState;
    /** The seat that submitted it. */
    playerId: string;
    /** The per-seat deck knowledge the projection is reconstructed with —
     *  the same three inputs `AiTraceSource` keeps, for the same reason. */
    knowledge?: DeckKnowledgeBySeat;
    /** `null` marks a submission the journal cannot express — the driver's
     *  non-search realisations (a parked payment, a combat-damage
     *  confirmation, an escalation decline). The engine-side `StackJournal`
     *  carries a `broken` flag for the same fact; this store recomputes per
     *  call and so carries it IN the ring, where the window that contains it
     *  finds it (PR review, issue #3480). */
    move: Move | null;
};

/** Deliberately short, like the trace ring it sits beside: a window is at most
 *  a handful of plies (cast, pass, response, pass), and a journal is not a log.
 *  Long enough that a window is never truncated from below — a truncated one
 *  simply finds no quiet board and refuses. */
const PLY_RING_LIMIT = 24;

let plies: RecordedPly[] = [];

/** Record one submitted move. Cheap by construction: three references pushed
 *  onto a bounded array, no clone and no engine call. */
export function recordJournalPly(ply: RecordedPly): void {
    plies = [...plies, ply].slice(-PLY_RING_LIMIT);
}

/** Record a submission the journal cannot express, so the window containing it
 *  is refused rather than replayed with a hole. Same contract as the engine
 *  journal's `observeOpaque`, carried as a ply because this store keeps no
 *  state of its own. */
export function markJournalOpaque(
    state: PublicGameState,
    playerId: string
): void {
    recordJournalPly({ state, playerId, move: null });
}

export function clearStackJournal(): void {
    plies = [];
}

/** The recorded plies — for the store's own tests. */
export function getJournalPlies(): RecordedPly[] {
    return plies;
}

/**
 * The window that leads to the decision taken at `seq`, from the seat `botId`'s
 * point of view, or `null` when there is none.
 *
 * A window starts at the most recent recorded ply whose projection showed an
 * EMPTY stack, which is the definition of the quiet board, and runs to the last
 * ply submitted before the decision. `null` when no such ply was recorded, when
 * the window holds a submission marked opaque, or when any move in it has no
 * faithful `BladeSetupStep` — all three are the `stack-not-journalled` refusal,
 * and all three are honest: the journal says it does not know rather than
 * offering a walk it cannot stand behind.
 */
export function journalEntryFor(
    seq: number,
    botId: string,
    knowledge?: DeckKnowledgeBySeat
): StackJournalEntry | null {
    // Only what happened BEFORE the decision. A ply recorded at the decision's
    // own version or later belongs to a later window.
    const before = plies.filter((ply) => ply.state.seq < seq);
    const start = findLastIndex(before, (ply) => ply.state.stack.length === 0);
    if (start === -1) return null;

    const window = before.slice(start);
    const quiet = projectedToGameState(
        window[0].state,
        window[0].knowledge ?? knowledge,
        botId
    );
    const steps: JournalStep[] = [];
    for (const ply of window) {
        // A submission nobody could express, inside this window. The walk is
        // incomplete, so there is no walk.
        if (!ply.move) return null;
        // Each step is read against the board it was submitted on — a card
        // name cannot be resolved from an id on any other board.
        const at = projectedToGameState(
            ply.state,
            ply.knowledge ?? knowledge,
            botId
        );
        const step = journalStepForMove(at, ply.playerId, ply.move);
        if (!step) return null;
        steps.push(step);
    }
    return steps.length === 0 ? null : { quiet, steps };
}

/** `Array.prototype.findLastIndex` without the lib target it needs. */
function findLastIndex<T>(items: T[], match: (item: T) => boolean): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (match(items[i])) return i;
    }
    return -1;
}
