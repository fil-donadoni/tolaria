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
import type { Move } from "@convex/gre";
import { search, DEFAULT_BUDGET } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";

export type BrainRequest = {
    id: number;
    state: PublicGameState;
    botId: string;
};
export type BrainResponse = { id: number; move: Move | null };

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const { id, state, botId } = e.data;
    const seed = (Math.random() * 0x100000000) | 0;
    const move = search(
        projectedToGameState(state),
        botId,
        DEFAULT_BUDGET,
        seed
    );
    const response: BrainResponse = { id, move };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
};
