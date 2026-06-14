// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issues #109/#110).
//
// The thinking runs off the UI thread so the app stays interactive while the
// bot decides. This shell holds NO judgement of its own: it receives the bot's
// projected view, enumerates the legal moves with the real GRE, and returns one
// chosen uniformly at random. The enumeration (`enumerateMoves`) and the
// selection (`selectMove`) are both pure and tested without a Worker; only the
// random draw happens here.

/// <reference lib="webworker" />
import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import { enumerateMoves } from "@convex/gre";
import { selectMove } from "./brain";
import { projectedToGameState } from "./state-adapter";

export type BrainRequest = {
    id: number;
    state: PublicGameState;
    botId: string;
};
export type BrainResponse = { id: number; move: Move | null };

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const { id, state, botId } = e.data;
    const moves = enumerateMoves(projectedToGameState(state), botId);
    const move = selectMove(moves, Math.random());
    const response: BrainResponse = { id, move };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
};
