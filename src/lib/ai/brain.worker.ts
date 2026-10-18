// Thin Web Worker shell for the AI Bot's Brain (ADR 0001, issues #109–#112).
//
// The thinking runs off the UI thread so the app stays interactive while the
// bot decides. This shell holds NO judgement of its own and NO logic worth
// testing: it hands the message to `handleBrainRequest` (`brain-request.ts`)
// and posts the answer back. Everything else — the search, the seed, the
// failure path — lives in that pure module, which is why this file can stay
// short and untested.
//
// The ONE thing it owns is RESIDENCY ORDER (ADR 0113 §3 and Amendment VII,
// issues #3053, #5617). A Worker gets its own module graph, so it has its own
// registry and its own catalogue — but not its own download: it is a chunk of
// the page's build (`scripts/lib/vite-brain-worker-chunk.ts`), so the shards
// it installs are the URLs the page already fetched. It installs only the
// definitions it may reason about (`./brain-residency`): the Manifest the
// driver primes it with (its own decklist, plus the human's at `expert`), and
// whatever a request's state names. `handleBrainRequest` reads
// `getDefinition`/`tryGetDefinition` SYNCHRONOUSLY, so answering before those
// are resident would be a bot deciding against a half-empty catalogue — which
// `.claude/rules/bot-development.md` treats as unshipped, not as a slow
// start. Requests are therefore chained one at a time, each behind its own
// residency, which also keeps them in FIFO order (an `async` handler would let
// a later short request overtake an earlier one).
//
// A residency FAILURE must not silently swallow the queue either: every
// request it blocks gets a real `error` response, the same shape #2470 added
// for a search that throws. A bot that answers "no move" forever is
// indistinguishable from a bot that chose to pass (issue #2450).

/// <reference lib="webworker" />
import { handleBrainRequest } from "./brain-request";
import type { BrainRequest, BrainResponse } from "./brain-request";
import {
    isBrainPrime,
    requestDefinitionIds,
    type BrainWorkerMessage,
} from "./brain-residency";
import { installShards } from "../catalogue/definitionShards";
import {
    hintedShardKeys,
    makeResident,
    type ShardHints,
} from "../catalogue/residentFor";
// Binds `convex/formats.ts`'s late-bound deck resolver in this graph too, as
// the whole-catalogue hydration this module used to import did.
import "../catalogueArtifact";

export type { BrainRequest, BrainResponse } from "./brain-request";

const post = (response: BrainResponse) =>
    (self as DedicatedWorkerGlobalScope).postMessage(response);

/** The Set codes of every Manifest entry this worker was primed with. */
const hints: ShardHints = new Map();

/** Requests, one at a time, in arrival order. */
let chain: Promise<void> = Promise.resolve();

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

/** How long a failed install is left failed before another request pays for
 *  a fresh attempt. The driver re-consults on every state change, so an
 *  un-cooled retry turns a deploy window into one fetch round per consult;
 *  the caller still gets a named error immediately either way. */
const REARM_COOLDOWN_MS = 5_000;
let lastFailure: { at: number; cause: unknown } | null = null;

/** Every shard `request` needs resident — or the failure of the last attempt,
 *  while it is cooling down. */
function resident(request: BrainRequest): Promise<void> {
    if (lastFailure && Date.now() - lastFailure.at < REARM_COOLDOWN_MS) {
        return Promise.reject(lastFailure.cause);
    }
    return makeResident(requestDefinitionIds(request), hints).then(
        () => {
            lastFailure = null;
        },
        (cause: unknown) => {
            lastFailure = { at: Date.now(), cause };
            throw cause;
        }
    );
}

function failResidency(id: number, cause: unknown): void {
    const error = toBrainError(cause);
    console.error("[AI] definition shards failed to install", error);
    post({ id, move: null, trace: null, error });
}

self.onmessage = (e: MessageEvent<BrainWorkerMessage>) => {
    const message = e.data;
    if (isBrainPrime(message)) {
        // Not chained: the install overlaps whatever is in flight, and a
        // request that needs these shards joins the same in-flight load
        // (the loader memoises it). A failure here is the request's to
        // report, when one needs the shard.
        installShards(hintedShardKeys(message.entries, hints)).catch(
            (cause: unknown) =>
                console.warn("[AI] manifest prime failed", toBrainError(cause))
        );
        return;
    }
    const request = message;
    chain = chain
        .then(() =>
            resident(request).then(
                () => serve(request),
                (cause: unknown) => failResidency(request.id, cause)
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
