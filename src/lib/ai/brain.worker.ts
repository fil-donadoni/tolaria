// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issues #109–#112).
//
// The thinking runs off the UI thread so the app stays interactive while the
// bot decides. This shell holds NO judgement of its own: it receives the bot's
// projected view and runs the real GRE search (`search` — ISMCTS over a
// determinized tree, issue #112), returning the chosen move. Selection is pure
// and tested without a Worker; only the per-decision seed is drawn here, so the
// bot varies between equally-good lines while each search is reproducible.

/// <reference lib="webworker" />
import type { PublicGameState } from "@convex/gameProjections";
import type { Move, SearchBudget, DecisionTrace } from "@convex/gre";
import { searchWithTrace, DEFAULT_BUDGET } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";
import type { OwnDeckList } from "./state-adapter";

export type BrainRequest = {
    id: number;
    state: PublicGameState;
    botId: string;
    /** Difficulty-scaled search budget (issue #114). Plain numbers only, so it
     *  survives the structured-clone `postMessage` hop. Omitted → default. */
    budget?: SearchBudget;
    /** The bot's own decklist (issue #1509) — plain arrays/strings, so it
     *  survives the structured-clone `postMessage` hop. Wires real card
     *  identities into the bot's simulated library. Omitted → placeholders. */
    ownDeck?: OwnDeckList;
};
export type BrainResponse = {
    id: number;
    move: Move | null;
    /** What the Brain weighed for this move — surfaced in the Debug panel and
     *  also logged below. Null when there was no real decision. Plain data, so
     *  it survives the structured-clone `postMessage` hop. */
    trace: DecisionTrace | null;
};

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const { id, state, botId, budget, ownDeck } = e.data;
    const seed = (Math.random() * 0x100000000) | 0;
    const { move, trace } = searchWithTrace(
        projectedToGameState(state, ownDeck),
        botId,
        budget ?? DEFAULT_BUDGET,
        seed
    );
    // Free console.log: readable from DevTools (select the worker context, or
    // it surfaces in the main console). The structured trace also goes to the
    // Debug panel via the response below.
    if (trace) console.log("[AI] decision", trace);
    const response: BrainResponse = { id, move, trace };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
};
