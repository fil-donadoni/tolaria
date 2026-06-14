// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issue #109).
//
// The heavy thinking (eventually ISMCTS) must run off the UI thread so the app
// stays interactive while the bot decides. This shell holds NO logic of its
// own: it receives a BotView, calls the pure `decideBotAction`, and posts the
// result back. All decision logic lives in `brain.ts` and is tested without a
// Worker.

/// <reference lib="webworker" />
import { decideBotAction, type BotView, type BotAction } from "./brain";

export type BrainRequest = { id: number; view: BotView };
export type BrainResponse = { id: number; action: BotAction };

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const { id, view } = e.data;
    const action = decideBotAction(view);
    const response: BrainResponse = { id, action };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
};
