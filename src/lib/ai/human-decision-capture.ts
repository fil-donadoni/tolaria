// The human seat's decisions in a vs-Bot game, kept for the game-end Verdict
// Proposal sample (issue #3984, GLOSSARY.md § Verdict Proposal).
//
// RECORD NOW, JUDGE AT GAME END. During play this store only REMEMBERS: the
// seat's own view at each decision (the `AiTraceSource` shape the verdict quiz
// already lowers from) and the mutations the player submitted until their next
// decision. Nothing here consults the Brain, runs a search or enumerates a move
// — the cost a player pays mid-game is one array push.
//
// Client-side by design, and never authoritative (ADR 0074): a proposal is a
// QUESTION, not game state. Nothing here is persisted; a reload losing the
// buffer loses only questions nobody had been asked yet.
//
// HIDDEN INFORMATION. A captured source is the deciding seat's view and
// nothing else: its own projection (the server already hid the opponent's hand
// in it) and its OWN decklist as deck knowledge, never the opponent's — even
// though the vs-Bot driver holds both seats' lists. `captureHumanDecision`
// refuses a projection that was made for another viewer, which is the one way
// a wiring slip could hand the Brain the Bot's hand.
//
// BOUNDED. A game keeps at most `captureLimit` decisions, chosen by reservoir
// sampling over the whole game — a long game is sampled evenly rather than cut
// off after its opening, where the decisions are land drops and nothing else.

import { makeRng } from "@convex/gre/rng";
import type { PublicGameState } from "@convex/gameProjections";
import type { AiTraceSource } from "./trace-store";
import type { TappedMutation } from "./mutation-tap";

/** One human decision: what the seat saw, and what it submitted on it. */
export type CapturedDecision = {
    /** The deciding seat's view — `botId` names the HUMAN seat here; the field
     *  keeps the quiz's name because the quiz lowers from this same shape. */
    source: AiTraceSource;
    /** Every mutation the seat submitted from this decision until its next
     *  one (or the game's end), in order. */
    calls: TappedMutation[];
};

type GameCapture = {
    gameId: string;
    seatId: string;
    limit: number;
    rng: () => number;
    /** Decisions closed so far, by reservoir position. */
    kept: CapturedDecision[];
    /** How many decisions have closed, kept or not — the reservoir's `n`. */
    closed: number;
    /** The decision the seat is on now; its calls are still arriving. */
    current: CapturedDecision | null;
    lastSeq: number | null;
};

let capture: GameCapture | null = null;

/** Begin capturing `seatId`'s decisions in `gameId`, dropping any previous
 *  game's buffer. */
export function startHumanCapture(
    gameId: string,
    seatId: string,
    options: { limit: number; seed: number }
): void {
    capture = {
        gameId,
        seatId,
        limit: options.limit,
        rng: makeRng(options.seed),
        kept: [],
        closed: 0,
        current: null,
        lastSeq: null,
    };
}

/** Whether `state` is `seatId`'s OWN view: every slot of its own hand carries
 *  an identity. A projection made for anyone else hides that hand. */
export function isSeatOwnView(state: PublicGameState, seatId: string): boolean {
    const seat = state.players.find((p) => p.id === seatId);
    return !!seat && seat.hand.every((card) => card !== null);
}

/** The seat's own decklist as the only deck knowledge, or none. */
export function ownDeckKnowledge(
    seatId: string,
    cardIds: readonly string[] | undefined
): AiTraceSource["knowledge"] {
    return cardIds ? [{ playerId: seatId, cardIds: [...cardIds] }] : undefined;
}

function close(c: GameCapture): void {
    const done = c.current;
    c.current = null;
    if (!done || done.calls.length === 0) return;
    c.closed++;
    if (c.kept.length < c.limit) {
        c.kept.push(done);
        return;
    }
    const slot = Math.floor(c.rng() * c.closed);
    if (slot < c.limit) c.kept[slot] = done;
}

/**
 * The seat owes a fresh decision on `state`: close the previous one and open
 * this. A repeat of the same `seq` is ignored. Returns false — capturing
 * nothing — for another game, another seat, or a projection that is not the
 * seat's own view.
 */
export function captureHumanDecision(
    gameId: string,
    source: AiTraceSource
): boolean {
    const c = capture;
    if (!c || c.gameId !== gameId || c.seatId !== source.botId) return false;
    if (!isSeatOwnView(source.state, source.botId)) return false;
    if (source.knowledge?.some((k) => k.playerId !== source.botId)) {
        return false;
    }
    if (c.lastSeq === source.state.seq) return false;
    c.lastSeq = source.state.seq;
    close(c);
    c.current = { source, calls: [] };
    return true;
}

/** One mutation the seat submitted — appended to its current decision. A
 *  call with no open decision (before the first one is seen) is dropped. */
export function recordHumanCall(gameId: string, call: TappedMutation): void {
    const c = capture;
    if (!c || c.gameId !== gameId || !c.current) return;
    if (call.args.playerId !== c.seatId || call.args.gameId !== gameId) return;
    c.current.calls.push(call);
}

/** The game is over: close the open decision and hand over everything kept,
 *  in the order the decisions were made. Empties the buffer. */
export function takeHumanDecisions(gameId: string): CapturedDecision[] {
    const c = capture;
    if (!c || c.gameId !== gameId) return [];
    close(c);
    const out = [...c.kept].sort(
        (a, b) => a.source.state.seq - b.source.state.seq
    );
    c.kept = [];
    c.closed = 0;
    return out;
}

/** The game being captured, or `null` — what a late game-end result checks
 *  before it lands, so a swap that happened meanwhile drops it. */
export function capturingGame(): string | null {
    return capture?.gameId ?? null;
}

/** Drop everything — a game swap, an unmount. */
export function clearHumanCapture(): void {
    capture = null;
}
