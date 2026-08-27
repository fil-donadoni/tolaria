// Client-side handle to the Brain Web Worker (ADR 0001, issues #109/#110).
//
// Lazily spawns a single module Worker and exposes `consultBrain(state, botId)`,
// which resolves with the bot's chosen Move (or null when it owes nothing). A
// request-id map matches each reply to its caller so concurrent consults never
// cross. The Worker is a thin shell; enumeration + selection live in the GRE and
// `brain.ts`.
//
// In a non-Worker environment (SSR, tests), `consultBrain` falls back to running
// the same ISMCTS search inline — so the driver never hard-depends on the
// Worker being available.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move, SearchBudget, DecisionTrace } from "@convex/gre";
import { DEFAULT_BUDGET } from "@convex/gre";
import type { DeckKnowledgeBySeat } from "./state-adapter";
import { handleBrainRequest } from "./brain-request";
import type {
    BrainOutcome,
    BrainRequest,
    BrainResponse,
} from "./brain-request";

/** The Brain's reply: the chosen move, the read-only DecisionTrace of what it
 *  weighed (null when there was no real decision to explain), and HOW the
 *  consult ended.
 *
 *  `outcome` exists because the three failure paths below — the search threw,
 *  the Worker died, the Worker never answered — all used to resolve the same
 *  bare `move: null` the driver gets when the bot legitimately has nothing to
 *  do. Indistinguishable at the call site, and therefore invisible in a bug
 *  report: a bot failing every consult looks exactly like a bot passing every
 *  window (issue #2450). `via` says whether a Worker was involved at all. */
export type BrainResult = {
    move: Move | null;
    trace: DecisionTrace | null;
    outcome: BrainOutcome;
    via: "worker" | "inline";
    /** The failure text, for the error outcomes only. */
    message?: string;
};

type Pending = (result: BrainResult) => void;

/** How long a Worker consult may run before the client gives up on it and
 *  resolves the same "no move" answer `worker.onerror` already resolves
 *  (issue #2284).
 *
 *  Without it a Worker that never replies — a wedged search, a message lost
 *  across a tab suspend — left the driver's in-flight guard set forever, and an
 *  in-flight guard the driver cannot clear is a latch its watchdog cannot walk
 *  past (the watchdog will not interleave a rung into a live submission). The
 *  timeout turns "never replies" into the ordinary `move: null` outcome the
 *  escalation ladder already handles.
 *
 *  It must stay comfortably ABOVE the hardest search budget
 *  (`DIFFICULTY_BUDGETS.hard.timeMs = 3000`, raised from 600 by issue #2682)
 *  and BELOW `BOT_WATCHDOG_MS`, so a wedged consult settles in time for the
 *  watchdog's first deadline to escalate rather than to find a still-in-flight
 *  dispatch. `brain-client-timeout.bot.test.ts` asserts both relations against
 *  the real constants. */
export const BRAIN_CONSULT_TIMEOUT_MS = 5000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    if (worker) return worker;
    worker = new Worker(new URL("./brain.worker.ts", import.meta.url), {
        type: "module",
    });
    worker.onmessage = (e: MessageEvent<BrainResponse>) => {
        const resolve = pending.get(e.data.id);
        if (resolve) {
            pending.delete(e.data.id);
            resolve(fromResponse(e.data, "worker"));
        }
    };
    worker.onerror = (e) => {
        // On a worker error, fail all in-flight consults to a safe null so the
        // driver never hangs; the next state change re-consults. The reason is
        // no longer dropped: `worker-error` is the one outcome that says the
        // search may never have run at all (issue #2470).
        const message =
            typeof e === "object" && e !== null && "message" in e
                ? String((e as { message?: unknown }).message)
                : "worker error";
        for (const [id, resolve] of pending) {
            pending.delete(id);
            resolve({
                move: null,
                trace: null,
                outcome: "worker-error",
                via: "worker",
                message,
            });
        }
    };
    return worker;
}

/** Ask the Brain to choose a move for `botId` from its projected `state`. The
 *  optional `budget` scales the search by the chosen difficulty (issue #114);
 *  omitted, it falls back to the default preset. `deckKnowledge` names which
 *  seats (if any) the search may know the real deck contents of (issue #2788);
 *  omitted, every seat is blind. */
export function consultBrain(
    state: PublicGameState,
    botId: string,
    budget: SearchBudget = DEFAULT_BUDGET,
    deckKnowledge?: DeckKnowledgeBySeat
): Promise<BrainResult> {
    const w = getWorker();
    if (!w) {
        // No Worker (SSR, tests): the SAME handler, on this thread. It reports
        // a throw as `error` rather than propagating, so the inline path and
        // the Worker path fail identically.
        const id = nextId++;
        return Promise.resolve(
            fromResponse(
                handleBrainRequest({ id, state, botId, budget, deckKnowledge }),
                "inline"
            )
        );
    }

    const id = nextId++;
    const request: BrainRequest = { id, state, botId, budget, deckKnowledge };
    return new Promise<BrainResult>((resolve) => {
        // A consult ALWAYS settles (issue #2284) — see
        // `BRAIN_CONSULT_TIMEOUT_MS`. A reply that arrives afterwards finds no
        // pending entry and is dropped.
        const timer = setTimeout(() => {
            if (pending.delete(id))
                resolve({
                    move: null,
                    trace: null,
                    outcome: "timeout",
                    via: "worker",
                });
        }, BRAIN_CONSULT_TIMEOUT_MS);
        pending.set(id, (result) => {
            clearTimeout(timer);
            resolve(result);
        });
        w.postMessage(request);
    });
}

/** Classify a Brain response into the result the driver records. The search
 *  itself never distinguishes "chose nothing" from "failed" — the response's
 *  `error` field does, and it is the whole point of the breadcrumb. */
function fromResponse(
    res: BrainResponse,
    via: "worker" | "inline"
): BrainResult {
    if (res.error) {
        return {
            move: null,
            trace: null,
            outcome: "search-error",
            via,
            message: res.error.message,
        };
    }
    return {
        move: res.move,
        trace: res.trace,
        outcome: res.move ? "move" : "no-move",
        via,
    };
}

/** Tear down the Worker (e.g. on leaving a game). Tests may call this too. */
export function disposeBrain(): void {
    if (worker) {
        worker.terminate();
        worker = null;
    }
    pending.clear();
}
