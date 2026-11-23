// What was played between two of the Bot's consults (issue #10470, ADR 0185).
//
// The Brain Worker keeps the tree its last search grew (`brain.worker.ts`).
// For the next consult to continue from the subtree the game moved into, the
// consult must say which decisions were made since — the Bot's own move
// first, then every decision of either seat until the Bot decides again — in
// the search's own vocabulary: TREE KEYS (`treeKeyOf`), each read on the
// deciding seat's own view, so a card cast from the human's hand is keyed by
// the card they held, as the search keys an opponent's move.
//
// The Bot's moves are known: the driver names each one it submits. The
// human's are not — their clicks reach the server as granular mutations — so
// the bridge the Verdict Proposal capture already uses names them
// (`human-move-match.ts`): every legal move of the human's decision is
// realised into a recorder, and the one whose calls ARE what they submitted is
// their move. A window opens at each human view the engine waits on and
// collects the human's calls until the next decision; a continuation (a
// cast's targets, its payment) stays in the decision that started it.
//
// ANY DOUBT BREAKS THE PATH, and a broken path drops the kept tree — today's
// behaviour exactly. Never a guess: a tree walked along a path that is not
// what happened would answer for a position the Bot is not in. So the path
// breaks on: a Bot action that is no move (a direct realisation, an
// escalation rung), a submission the server rejected, a human window whose
// calls name no move (an auto-pass shortcut, a protocol step), a human view
// that moved on with no call of theirs (the server acted for them), a call
// with no window open, and anything that throws.
//
// PONDERING reads the same path (issue #10472): when a human window opens,
// the listeners `onHumanWindow` registered are told its `seq`, and
// `peekConsultPath` hands them the steps before it — the path from the last
// consult to the human's decision the Worker is asked to ponder — without
// taking them: the next consult still takes the whole path.
//
// Client-side and never authoritative (ADR 0074): the path only steers which
// statistics the Bot's own search starts from. One game at a time.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import { treeKeyOf } from "@convex/gre/search";
import type { ConsultPathStep } from "@convex/gre/ai/treeReuse";
import type { GameState } from "@convex/gre/state";
import { projectedToGameState } from "./state-adapter";
import { classifyHumanWindow } from "./human-decision-start";
import { identifyHumanMove } from "./human-move-match";
import type { TappedMutation } from "./mutation-tap";

/** A human decision under way: the view it was made on, and its calls. */
type HumanWindow = {
    state: PublicGameState;
    seat: string;
    calls: TappedMutation[];
};

type Path = {
    gameId: string;
    botId: string;
    /** The steps since the last consult, in order; a pending entry is a human
     *  decision still being identified. `null` resolves a broken step. */
    steps: Promise<ConsultPathStep | null>[];
    broken: boolean;
    open: HumanWindow | null;
};

let path: Path | null = null;

/** Told the game and `seq` of each human window that opens (issue #10472). */
type HumanWindowListener = (gameId: string, seq: number) => void;
const windowListeners = new Set<HumanWindowListener>();

/** Be told of each human window that opens; the unsubscribe. */
export function onHumanWindow(listener: HumanWindowListener): () => void {
    windowListeners.add(listener);
    return () => {
        windowListeners.delete(listener);
    };
}

/** Begin the path of `gameId`'s Bot seat `botId`. Called on the driver's
 *  mount: the first consult has nothing kept, so the path starts empty. */
export function startConsultPath(gameId: string, botId: string): void {
    path = { gameId, botId, steps: [], broken: false, open: null };
}

/** Drop the path — the driver unmounted, or the game was swapped. */
export function stopConsultPath(gameId: string): void {
    if (path?.gameId === gameId) path = null;
}

function current(gameId: string): Path | null {
    return path && path.gameId === gameId ? path : null;
}

/** The card `move` brings out of `seat`'s hand, if any: a card the seat
 *  shows by its own decision (`ConsultPathStep.shows`). */
function shownFromHand(
    position: GameState,
    seat: string,
    move: Move
): string | undefined {
    if (
        move.kind !== "cast-spell" &&
        move.kind !== "play-land" &&
        move.kind !== "activate-ability"
    ) {
        return undefined;
    }
    const player = position.players.find((p) => p.id === seat);
    return player?.hand.some((c) => c.id === move.cardInstanceId)
        ? move.cardInstanceId
        : undefined;
}

/** The step `move` is, made by `seat` on `view` (that seat's own
 *  projection), or `null` when the search would not key it. */
function stepOf(
    view: PublicGameState,
    seat: string,
    botId: string,
    move: Move
): ConsultPathStep | null {
    const position = projectedToGameState(view, undefined, seat);
    const key = treeKeyOf(position, seat, botId, move);
    if (key === null) return null;
    const shows =
        seat === botId ? undefined : shownFromHand(position, seat, move);
    return { seat, key, ...(shows ? { shows } : {}) };
}

async function identify(
    window: HumanWindow,
    botId: string
): Promise<ConsultPathStep | null> {
    try {
        const position = projectedToGameState(
            window.state,
            undefined,
            window.seat
        );
        const move = await identifyHumanMove(
            position,
            window.seat,
            window.calls
        );
        return move ? stepOf(window.state, window.seat, botId, move) : null;
    } catch {
        return null;
    }
}

/** Close the open human window into a step. A window with no call of the
 *  human's closed by a state that moved on means somebody else acted for
 *  them: the path breaks. */
function closeWindow(p: Path): void {
    const window = p.open;
    p.open = null;
    if (!window) return;
    if (window.calls.length === 0) {
        p.broken = true;
        return;
    }
    p.steps.push(identify(window, p.botId));
}

/** The human seat `seat` owes input on `view`, its own projection. */
export function noteHumanView(
    gameId: string,
    view: PublicGameState,
    seat: string
): void {
    const p = current(gameId);
    if (!p || seat === p.botId) return;
    try {
        if (p.open && p.open.state.seq === view.seq) return;
        if (p.open && classifyHumanWindow(view, seat).kind === "continue") {
            return;
        }
        closeWindow(p);
        p.open = { state: view, seat, calls: [] };
    } catch {
        p.broken = true;
        return;
    }
    // Outside the try: a listener's throw is no break of the path.
    windowListeners.forEach((listener) => {
        try {
            listener(gameId, view.seq);
        } catch {
            // A lost ponder, never a lost path.
        }
    });
}

/** A mutation submitted from this client — kept when it is the human's. */
export function noteHumanCall(gameId: string, call: TappedMutation): void {
    const p = current(gameId);
    if (!p) return;
    const seat = call.args.playerId;
    if (typeof seat !== "string" || seat === p.botId) return;
    if (call.args.gameId !== gameId) return;
    if (!p.open || p.open.seat !== seat) {
        p.broken = true;
        return;
    }
    p.open.calls.push(call);
}

/** The Bot submits `move` on `view`, its own projection. */
export function noteBotMove(
    gameId: string,
    view: PublicGameState,
    move: Move
): void {
    const p = current(gameId);
    if (!p) return;
    try {
        closeWindow(p);
        p.steps.push(Promise.resolve(stepOf(view, p.botId, p.botId, move)));
    } catch {
        p.broken = true;
    }
}

/** The Bot did something that is no move, or a submission failed: the path
 *  can no longer say where the game is. Without `gameId`, the path of
 *  whichever game is current (there is one at a time). */
export function breakConsultPath(gameId?: string): void {
    const p = gameId === undefined ? path : current(gameId);
    if (p) p.broken = true;
}

/**
 * The steps from the last consult to the human window open at `seq`
 * (issue #10472), without taking them: `null` when the path broke, when the
 * window open now is not that one (the game moved on), or when a step could
 * not be named. Never rejects.
 */
export async function peekConsultPath(
    gameId: string,
    seq: number
): Promise<ConsultPathStep[] | null> {
    const p = current(gameId);
    if (!p || p.broken || p.open?.state.seq !== seq) return null;
    const steps = p.steps.slice();
    try {
        const resolved = await Promise.all(steps);
        // Re-read after the wait: the path may have broken or moved on.
        if (current(gameId) !== p || p.broken || p.open?.state.seq !== seq) {
            return null;
        }
        return resolved.every((s): s is ConsultPathStep => s !== null)
            ? resolved
            : null;
    } catch {
        return null;
    }
}

/**
 * The Bot is about to consult: the steps since the last consult, or `null`
 * when the path broke, and a fresh path for the decisions after this one.
 * Waits for the human decisions still being identified (the bridge is async,
 * but never reaches the network). Never rejects.
 */
export async function takeConsultPath(
    gameId: string
): Promise<ConsultPathStep[] | null> {
    const p = current(gameId);
    if (!p) return null;
    try {
        closeWindow(p);
    } catch {
        p.broken = true;
    }
    const { steps, broken } = p;
    p.steps = [];
    p.broken = false;
    if (broken) return null;
    const resolved = await Promise.all(steps);
    return resolved.every((s): s is ConsultPathStep => s !== null)
        ? resolved
        : null;
}
