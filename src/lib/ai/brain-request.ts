// The Brain's request/response protocol and the PURE handler behind it
// (ADR 0001, issues #109–#112, #2470).
//
// Lives apart from `brain.worker.ts` because that file is a Worker ENTRY POINT:
// importing it assigns `self.onmessage` as a side effect, so its handler could
// never be exercised without spawning a real Worker. The handler is the part
// with behaviour worth asserting — above all its FAILURE path — so it sits here
// as an ordinary pure function, and the worker shell does nothing but hand its
// message over and post the answer back.
//
// Everything crossing the `postMessage` boundary is plain data (structured
// clone): no functions, no class instances, no `Error` objects — an `Error` is
// lowered to `{ name, message }` before it travels.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move, SearchBudget, DecisionTrace } from "@convex/gre";
import { searchWithTrace, DEFAULT_BUDGET } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";
import type { DeckKnowledgeBySeat } from "./state-adapter";

export type BrainRequest = {
    id: number;
    state: PublicGameState;
    botId: string;
    /** Difficulty-scaled search budget (issue #114). Plain numbers only, so it
     *  survives the structured-clone `postMessage` hop. Omitted → default. */
    budget?: SearchBudget;
    /** Deck knowledge, per seat (issue #1509, generalised per-seat by #2788) —
     *  plain arrays/strings, so it survives the structured-clone `postMessage`
     *  hop. Wires real card identities into a named seat's simulated library.
     *  A seat absent here stays blind (placeholders); omitted entirely, every
     *  seat is blind. */
    deckKnowledge?: DeckKnowledgeBySeat;
    /** Per-decision seed. Drawn by the CALLER so the handler stays pure and a
     *  test can pin the search; omitted, the handler draws one itself (the
     *  bot must still vary between equally-good lines across decisions). */
    seed?: number;
};

/** A search failure, lowered to plain data for the `postMessage` hop. */
export type BrainError = { name: string; message: string };

export type BrainResponse = {
    id: number;
    move: Move | null;
    /** What the Brain weighed for this move — surfaced in the Debug panel.
     *  Null when there was no real decision, and always null on `error`. */
    trace: DecisionTrace | null;
    /** Present when the search THREW (issue #2470). Before this the throw
     *  escaped to the Worker's `onerror`, which resolved every in-flight
     *  consult to a bare "no move" and dropped the error on the floor — the
     *  bot then passed every window for the rest of the game, indistinguishable
     *  from a bot that had simply chosen to pass (issue #2450). */
    error?: BrainError;
};

/** How a consult ENDED. The discriminant a breadcrumb records, so "the bot did
 *  nothing" can be told apart from "the bot chose to do nothing" after the
 *  fact, from a bug report alone. Ordered by how far the consult got. */
export type BrainOutcome =
    /** The search returned a move. */
    | "move"
    /** The search ran and legitimately returned no move (nothing was owed). */
    | "no-move"
    /** The search THREW; `message` carries what it said. */
    | "search-error"
    /** The Worker itself failed (`onerror`) — the search may never have run. */
    | "worker-error"
    /** The Worker never replied within the consult timeout. */
    | "timeout";

/** Run one Brain request. Pure given `req.seed`: same request, same answer.
 *
 *  NEVER throws — a search failure comes back as a normal response carrying
 *  `error`, because the caller of this handler is a Worker message pump whose
 *  only alternative is to die and take every pending consult with it. */
export function handleBrainRequest(
    req: BrainRequest,
    search: typeof searchWithTrace = searchWithTrace
): BrainResponse {
    const { id, state, botId, budget, deckKnowledge } = req;
    const seed = req.seed ?? (Math.random() * 0x100000000) | 0;
    try {
        const { move, trace } = search(
            projectedToGameState(state, deckKnowledge),
            botId,
            budget ?? DEFAULT_BUDGET,
            seed,
            // The SAME knowledge, to both consumers (issue #2789): the adapter
            // rebuilds a known library's identities, and `determinize` samples
            // an informed OPPONENT's hidden zones from their decklist. Handing
            // it to one and not the other is how the two would drift into
            // disagreeing about which seat the search is allowed to know.
            deckKnowledge
        );
        return { id, move, trace };
    } catch (e) {
        return { id, move: null, trace: null, error: toBrainError(e) };
    }
}

/** Lower an unknown thrown value to the plain `{ name, message }` shape that
 *  survives structured clone. Total: a thrown string or object is still
 *  reported rather than becoming an empty message. */
export function toBrainError(e: unknown): BrainError {
    if (e instanceof Error) {
        return { name: e.name, message: e.message };
    }
    return { name: "UnknownError", message: String(e) };
}
