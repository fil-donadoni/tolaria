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
import { searchWithTrace, DEFAULT_BUDGET } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";
import type { OwnDeckList } from "./state-adapter";
import type { BrainRequest, BrainResponse } from "./brain.worker";

/** The Brain's reply: the chosen move plus the read-only DecisionTrace of what
 *  it weighed (null when there was no real decision to explain). */
export type BrainResult = { move: Move | null; trace: DecisionTrace | null };

type Pending = (result: BrainResult) => void;

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
            resolve({ move: e.data.move, trace: e.data.trace });
        }
    };
    worker.onerror = () => {
        // On a worker error, fail all in-flight consults to a safe null so the
        // driver never hangs; the next state change re-consults.
        for (const [id, resolve] of pending) {
            pending.delete(id);
            resolve({ move: null, trace: null });
        }
    };
    return worker;
}

/** Ask the Brain to choose a move for `botId` from its projected `state`. The
 *  optional `budget` scales the search by the chosen difficulty (issue #114);
 *  omitted, it falls back to the default preset. */
export function consultBrain(
    state: PublicGameState,
    botId: string,
    budget: SearchBudget = DEFAULT_BUDGET,
    ownDeck?: OwnDeckList
): Promise<BrainResult> {
    const w = getWorker();
    if (!w) {
        const seed = (Math.random() * 0x100000000) | 0;
        const { move, trace } = searchWithTrace(
            projectedToGameState(state, ownDeck),
            botId,
            budget,
            seed
        );
        return Promise.resolve({ move, trace });
    }

    const id = nextId++;
    const request: BrainRequest = { id, state, botId, budget, ownDeck };
    return new Promise<BrainResult>((resolve) => {
        pending.set(id, resolve);
        w.postMessage(request);
    });
}

/** Tear down the Worker (e.g. on leaving a game). Tests may call this too. */
export function disposeBrain(): void {
    if (worker) {
        worker.terminate();
        worker = null;
    }
    pending.clear();
}
