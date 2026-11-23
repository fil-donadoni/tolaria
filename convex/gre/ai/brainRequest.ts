// The Brain's request/response protocol and the PURE handler behind it
// (ADR 0000, issues #109–#112, #2470).
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

// Shared by both sides of the client/server line: the client's Brain Worker
// (`src/lib/ai/brain.worker.ts`, through the `src/lib/ai/brain-request.ts`
// re-export) and the server's game-end Verdict Proposal judge
// (`convex/verdictJudge.ts`) run this ONE handler, so a position searched at
// the same iteration budget and seed gets the same answer on either side.
// It therefore imports only engine modules, never anything under `src/`.

import type { PublicGameState } from "../../gameProjections";
import type { Move } from "../moves";
import {
    controlledSeatPick,
    searchWithTrace,
    DEFAULT_BUDGET,
    type SearchBudget,
    type DecisionTrace,
    type PonderStats,
} from "../search";
import { actedSeatFor } from "../expectedInput";
import { recordRepetition, type RepetitionHistory } from "./repetition";
import { projectedToGameState } from "./stateAdapter";
import type { DeckKnowledgeBySeat } from "../deckKnowledge";
import {
    continueKeptTree,
    ponderedVisits,
    type ConsultReuse,
    type KeptTree,
} from "./treeReuse";

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
    /** The bot seat's decision history this turn (issue #3590) — what it chose
     *  at the positions it has already occupied, so an optional loop is not
     *  repeated. Plain data, so it survives `postMessage`. Omitted, nothing is
     *  remembered and the search is exactly what it was before. */
    repetition?: RepetitionHistory;
    /** Tree reuse (issue #10470, ADR 0185): the game this consult belongs to
     *  and the decisions played since the last one, as tree keys. Omitted —
     *  the server judge, every test, a caller that cannot say — and the
     *  search grows a fresh tree and keeps nothing, exactly as before. */
    reuse?: ConsultReuse;
};

/** Where the tree of the last search lives between two consults (issue
 *  #10470): the Brain Worker's own module state. `catalogue` names what the
 *  Worker has resident now — a tree grown against other definitions is
 *  dropped. The handler takes the kept tree out on EVERY request, so a
 *  tree is never offered twice and a failed consult keeps nothing. */
export type TreeKeeper = {
    kept: KeptTree | null;
    catalogue: () => string;
};

/** A search failure, lowered to plain data for the `postMessage` hop. */
export type BrainError = { name: string; message: string };

export type BrainResponse = {
    id: number;
    move: Move | null;
    /** What the Brain weighed for this move — surfaced in the Debug panel.
     *  Null when there was no real decision, and always null on `error`. */
    trace: DecisionTrace | null;
    /** The request's `repetition` with THIS decision recorded (issue #3590),
     *  fingerprinted on the very state the search ran on — the caller keeps it
     *  and hands it back on the next consult. Absent when no move was chosen. */
    repetition?: RepetitionHistory;
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
    search: typeof searchWithTrace = searchWithTrace,
    keeper?: TreeKeeper
): BrainResponse {
    const { id, state, botId, budget, deckKnowledge, repetition } = req;
    const seed = req.seed ?? (Math.random() * 0x100000000) | 0;
    // Taken out before anything can throw: whatever happens below, the tree
    // the last consult kept is offered to this one only.
    const previous = keeper?.kept ?? null;
    if (keeper) keeper.kept = null;
    try {
        // `botId` is the seat this projection was made for, so the wire's
        // `library.known[]` can be restored as `knownTo` and survive
        // determinization (issue #1524).
        const root = projectedToGameState(state, deckKnowledge, botId);
        // CR 723.5 (ADR 0181) — the decision is for a seat the Bot CONTROLS
        // this turn: no tree, the controlled seat's moves read one ply ahead
        // in the Bot's interest (`controlledSeatPick`). No repetition record:
        // the history is the Bot's own seat's.
        const seatId = actedSeatFor(root, botId);
        if (seatId !== null && seatId !== botId) {
            return {
                id,
                move: controlledSeatPick(root, seatId, botId, seed),
                trace: null,
            };
        }
        // Issue #10470 — continue from the subtree the game moved into, or
        // from a fresh root when the kept tree is dropped.
        const reuse = keeper && req.reuse ? req.reuse : undefined;
        const catalogue = reuse && keeper ? keeper.catalogue() : "";
        const continued =
            reuse && previous
                ? continueKeptTree(
                      previous,
                      { gameId: reuse.gameId, botId, catalogue },
                      reuse.steps,
                      state
                  )
                : null;
        // Issue #10472 — what pondering grew at the node this consult
        // continues from, read before the search adopts (and prunes) it.
        const ledger = reuse ? previous?.ponder : undefined;
        const pondered =
            ledger && continued && "node" in continued
                ? ponderedVisits(ledger, continued.node)
                : 0;
        const {
            move,
            trace: searched,
            root: grown,
        } = search(
            root,
            botId,
            budget ?? DEFAULT_BUDGET,
            seed,
            // The SAME knowledge, to both consumers (issue #2789): the adapter
            // rebuilds a known library's identities, and `determinize` samples
            // an informed OPPONENT's hidden zones from their decklist. Handing
            // it to one and not the other is how the two would drift into
            // disagreeing about which seat the search is allowed to know.
            deckKnowledge,
            repetition,
            reuse
                ? {
                      ...(continued && "node" in continued
                          ? { kept: continued.node }
                          : {}),
                  }
                : undefined
        );
        const trace =
            searched && ledger
                ? {
                      ...searched,
                      ponder: ponderStats(ledger, pondered, searched),
                  }
                : searched;
        if (keeper && reuse && grown && move) {
            keeper.kept = {
                gameId: reuse.gameId,
                botId,
                catalogue,
                root: grown,
                projection: state,
            };
        }
        return {
            id,
            move,
            trace,
            // Recorded against `root`, never against a second projection: the
            // progress it notes must be measured on the state the search ran
            // on (issue #3590).
            ...(move
                ? {
                      repetition: recordRepetition(
                          repetition,
                          root,
                          botId,
                          move
                      ),
                  }
                : {}),
        };
    } catch (e) {
        return { id, move: null, trace: null, error: toBrainError(e) };
    }
}

/** The trace's account of pondering (issue #10472): the visits pondering
 *  grew at the node the consult continued from, capped by what the search
 *  actually kept (a refused adoption keeps nothing). */
function ponderStats(
    ledger: NonNullable<KeptTree["ponder"]>,
    pondered: number,
    trace: DecisionTrace
): PonderStats {
    return {
        iterations: ledger.iterations,
        kept: Math.min(pondered, trace.iterationsKept ?? 0),
        ms: Math.round(ledger.ms),
    };
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
