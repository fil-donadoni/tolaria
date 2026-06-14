// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issues #109/#110).
//
// The thinking runs off the UI thread so the app stays interactive while the
// bot decides. This shell holds NO judgement of its own: it receives the bot's
// projected view and runs the real GRE greedy selection (`greedySelectMove` —
// enumerate → apply each move one ply → evaluate → argmax), returning the best
// move. The selection is pure and tested without a Worker; only the tie-break
// random draw happens here.

/// <reference lib="webworker" />
import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import { greedySelectMove } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";

export type BrainRequest = {
    id: number;
    state: PublicGameState;
    botId: string;
};
export type BrainResponse = { id: number; move: Move | null };

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const { id, state, botId } = e.data;
    const move = greedySelectMove(
        projectedToGameState(state),
        botId,
        Math.random()
    );
    const response: BrainResponse = { id, move };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
};
