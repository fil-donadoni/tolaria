// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issues #109–#112).
//
// The thinking runs off the UI thread so the app stays interactive while the
// bot decides. This shell holds NO judgement of its own and NO logic worth
// testing: it hands the message to `handleBrainRequest` (`brain-request.ts`)
// and posts the answer back. Everything else — the search, the seed, the
// failure path — lives in that pure module, which is why this file can stay
// three lines long and untested.

/// <reference lib="webworker" />
import { handleBrainRequest } from "./brain-request";
import type { BrainRequest } from "./brain-request";

export type { BrainRequest, BrainResponse } from "./brain-request";

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const response = handleBrainRequest(e.data);
    // Free console.log: readable from DevTools (select the worker context, or
    // it surfaces in the main console). The structured trace also goes to the
    // Debug panel via the response below.
    if (response.trace) console.log("[AI] decision", response.trace);
    if (response.error) console.error("[AI] search failed", response.error);
    (self as DedicatedWorkerGlobalScope).postMessage(response);
};
