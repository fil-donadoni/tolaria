// Client-side handle to the Brain Web Worker (ADR 0001, issue #109).
//
// Lazily spawns a single module Worker and exposes `consultBrain(view)`, which
// resolves with the bot's decision. A request-id map matches each reply to its
// caller so concurrent consults never cross. The Worker is a thin shell; the
// decision logic lives in `brain.ts`.
//
// In a non-Worker environment (SSR, tests), `consultBrain` falls back to running
// the pure decision function inline — so the spine never hard-depends on the
// Worker being available.

import { decideBotAction, type BotAction, type BotView } from "./brain";
import type { BrainRequest, BrainResponse } from "./brain.worker";

type Pending = (action: BotAction) => void;

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
            resolve(e.data.action);
        }
    };
    worker.onerror = () => {
        // On a worker error, fail all in-flight consults to a safe "none" so the
        // driver never hangs; the next state change re-consults.
        for (const [id, resolve] of pending) {
            pending.delete(id);
            resolve({ kind: "none" });
        }
    };
    return worker;
}

/** Ask the Brain to decide the bot's action for `view`. */
export function consultBrain(view: BotView): Promise<BotAction> {
    const w = getWorker();
    if (!w) return Promise.resolve(decideBotAction(view));

    const id = nextId++;
    const request: BrainRequest = { id, view };
    return new Promise<BotAction>((resolve) => {
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
