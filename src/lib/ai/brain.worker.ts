// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issues #109–#112).
//
// The thinking runs off the UI thread so the app stays interactive while the
// bot decides. This shell holds NO judgement of its own and NO logic worth
// testing: it hands the message to `handleBrainRequest` (`brain-request.ts`)
// and posts the answer back. Everything else — the search, the seed, the
// failure path — lives in that pure module, which is why this file can stay
// short and untested.
//
// The ONE thing it owns is HYDRATION ORDER (ADR 0113 §3, issue #3053). A
// Worker gets its own module graph, so it has its own registry and its own
// copy of the catalogue fetch; the card definitions are no longer bundled.
// `handleBrainRequest` reads `getDefinition`/`tryGetDefinition`
// SYNCHRONOUSLY, so answering before the artifact has landed would be a bot
// deciding against a half-empty registry — which `.claude/rules/bot-development.md`
// treats as unshipped, not as a slow start. Requests are therefore chained
// behind the hydration promise, which also keeps them in FIFO order (an
// `async` handler would let a later short request overtake an earlier one).
//
// A hydration FAILURE must not silently swallow the queue either: the chain is
// re-armed and every request in flight gets a real `error` response, the same
// shape #2470 added for a search that throws. A bot that answers "no move"
// forever is indistinguishable from a bot that chose to pass (issue #2450).

/// <reference lib="webworker" />
import { handleBrainRequest } from "./brain-request";
import type { BrainRequest, BrainResponse } from "./brain-request";
import { hydrateCatalogue } from "../catalogueArtifact";

export type { BrainRequest, BrainResponse } from "./brain-request";

const post = (response: BrainResponse) =>
    (self as DedicatedWorkerGlobalScope).postMessage(response);

/** The hydration in flight. Re-armed on failure, so a later request retries
 *  the fetch instead of inheriting a permanently rejected promise. */
let hydrated: Promise<void> = arm();

/** Requests, one at a time, in arrival order. Each awaits whatever hydration
 *  is current WHEN ITS TURN COMES — which is what makes the re-arm above
 *  reach the requests queued behind a failure, rather than only the ones
 *  posted after it. */
let chain: Promise<void> = Promise.resolve();

function arm(): Promise<void> {
    const promise = hydrateCatalogue().then(() => undefined);
    // Attach a handler so a rejection nobody is waiting on yet is not an
    // unhandled rejection; every real consumer attaches its own below.
    promise.catch(() => undefined);
    return promise;
}

function serve(request: BrainRequest): void {
    const response = handleBrainRequest(request);
    // Free console.log: readable from DevTools (select the worker context, or
    // it surfaces in the main console). The structured trace also goes to the
    // Debug panel via the response below.
    if (response.trace) console.log("[AI] decision", response.trace);
    if (response.error) console.error("[AI] search failed", response.error);
    post(response);
}

function toBrainError(cause: unknown): { name: string; message: string } {
    return cause instanceof Error
        ? { name: cause.name, message: cause.message }
        : { name: "Error", message: String(cause) };
}

/** How long a failed hydration is left failed before another request pays for
 *  a fresh attempt. The driver re-consults on every state change, so an
 *  un-cooled re-arm turns a deploy window into one ~1.4 MB request per
 *  consult; the caller still gets a named error immediately either way. */
const REARM_COOLDOWN_MS = 5_000;
let lastFailureAt = 0;

function failHydration(id: number, cause: unknown): void {
    const now = Date.now();
    if (now - lastFailureAt >= REARM_COOLDOWN_MS) {
        lastFailureAt = now;
        hydrated = arm();
    }
    const error = toBrainError(cause);
    console.error("[AI] catalogue hydration failed", error);
    post({ id, move: null, trace: null, error });
}

self.onmessage = (e: MessageEvent<BrainRequest>) => {
    const request = e.data;
    chain = chain
        .then(() =>
            hydrated.then(
                () => serve(request),
                (cause: unknown) => failHydration(request.id, cause)
            )
        )
        // TERMINAL, and load-bearing. Without it a throw out of `serve` — in
        // practice `postMessage` raising `DataCloneError` on a value the
        // structured clone refuses — leaves `chain` permanently rejected, and
        // every later `chain.then(...)` never runs: the Worker goes silent for
        // the rest of the session. It also restores what the old synchronous
        // `onmessage` gave for free: a throw there fired the Worker's `error`
        // event, which `brain-client.ts`'s `worker.onerror` turns into
        // `outcome: "worker-error"` for every in-flight consult. An unhandled
        // promise rejection reaches none of that.
        .catch((cause: unknown) => {
            console.error("[AI] worker request failed", cause);
            try {
                post({
                    id: request.id,
                    move: null,
                    trace: null,
                    error: toBrainError(cause),
                });
            } catch {
                // The channel itself is broken — nothing left to say on it.
                // `brain-client.ts`'s consult timeout owns this case.
            }
        });
};
