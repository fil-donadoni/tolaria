// Client-side handle to the Brain Web Worker (ADR 0001, issues #109/#110).
//
// Lazily spawns a single module Worker and exposes `consultBrain(state, botId)`,
// which resolves with the bot's chosen Move (or null when it owes nothing). A
// request-id map matches each reply to its caller so concurrent consults never
// cross. The Worker is a thin shell; enumeration + selection live in the GRE and
// `brain.ts`.
//
// In a non-Worker environment (SSR, tests), `consultBrain` falls back to running
// the same enumeration + random selection inline — so the driver never
// hard-depends on the Worker being available.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import { enumerateMoves } from "@convex/gre";
import { selectMove } from "./brain";
import { projectedToGameState } from "./state-adapter";
import type { BrainRequest, BrainResponse } from "./brain.worker";

type Pending = (move: Move | null) => void;

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
            resolve(e.data.move);
        }
    };
    worker.onerror = () => {
        // On a worker error, fail all in-flight consults to a safe null so the
        // driver never hangs; the next state change re-consults.
        for (const [id, resolve] of pending) {
            pending.delete(id);
            resolve(null);
        }
    };
    return worker;
}

/** Ask the Brain to choose a move for `botId` from its projected `state`. */
export function consultBrain(
    state: PublicGameState,
    botId: string
): Promise<Move | null> {
    const w = getWorker();
    if (!w) {
        const moves = enumerateMoves(projectedToGameState(state), botId);
        return Promise.resolve(selectMove(moves, Math.random()));
    }

    const id = nextId++;
    const request: BrainRequest = { id, state, botId };
    return new Promise<Move | null>((resolve) => {
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
