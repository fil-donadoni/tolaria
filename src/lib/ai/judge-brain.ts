// The Verdict Proposal judge's own Brain: Workers of its own, never the Bot's
// (`brain-client.ts`), so nothing the judge asks can stand between the Bot and
// its next decision.
//
// The Worker script is the Bot's (`brain.worker.ts`): the same handler, the
// same residency. What differs is the caller:
//
//   - A FIXED iteration budget and a fixed seed, never a wall clock: the same
//     position gets the same answer on every device. So no in-thread fallback
//     at a smaller budget either — a Worker that cannot answer is "no answer".
//   - A Worker serves one request at a time, so consults run concurrently on
//     several Workers, one search each ({@link judgeWorkerCount}); what does
//     not fit waits HERE, not in a Worker's queue, so its timeout starts when
//     its search can.
//   - A failure is the judge's alone: it settles as `worker-error` and is
//     counted by the caller. Nothing is written to the Bot's decision ring.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import type { DeckKnowledgeBySeat } from "@convex/gre/deckKnowledge";
import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import type {
    BrainOutcome,
    BrainRequest,
    BrainResponse,
} from "./brain-request";
import type { BrainPrime } from "./brain-residency";
import brainWorkerUrl from "virtual:brain-worker-url";

/** One position to judge. */
export type JudgeConsult = {
    state: PublicGameState;
    botId: string;
    iterations: number;
    seed: number;
    deckKnowledge?: DeckKnowledgeBySeat;
};

/** How one judge consult ended. */
export type JudgeAnswer = {
    move: Move | null;
    outcome: BrainOutcome;
    /** The search's own wall time in the Worker, ms — absent when the position
     *  asked for no search, or none answered. */
    searchMs?: number;
    /** Settled by `close` — the game was left — rather than by a Worker. */
    closed?: true;
};

/** The judge's Workers for one game. */
export type JudgeBrain = {
    /** Hand the Workers a seat's Definition Manifest, as the Bot's Worker is
     *  handed its own: running ones now, later ones at birth. Spawns none. */
    prime: (entries: readonly DefinitionManifestEntry[]) => void;
    /** Ask for one position. Always settles; never rejects. */
    consult: (consult: JudgeConsult) => Promise<JudgeAnswer>;
    /** Terminate every Worker and settle every consult. Idempotent, final. */
    close: () => void;
};

/** The most Workers one judge runs. Each is a whole engine and its game's
 *  card shards in memory, so it is a handful at most. */
export const JUDGE_WORKERS_MAX = 4;

/** The most on a phone or tablet, where memory is the first limit. */
export const JUDGE_WORKERS_MAX_MOBILE = 2;

/** How many consults run at once on this device: its cores but one, which is
 *  left to the page. */
export function judgeWorkerCount(
    cores: number | undefined,
    mobile: boolean
): number {
    const cap = mobile ? JUDGE_WORKERS_MAX_MOBILE : JUDGE_WORKERS_MAX;
    return Math.max(1, Math.min(cap, (cores ?? 2) - 1));
}

/** The longest an iteration may take, in ms, before a search counts as wedged
 *  rather than slow. Averaged over a search; Gecko's p90 field reading is
 *  1,658 ms (2026-11-21, `docs/research/bot-weak-line-weak-client.md`). */
export const JUDGE_MS_PER_ITERATION_CEILING = 2_000;

/** How long a consult may run before its Worker is given up: only there so a
 *  consult always settles, so it never ends a search that is merely slow. */
export function judgeConsultTimeoutMs(iterations: number): number {
    return iterations * JUDGE_MS_PER_ITERATION_CEILING;
}

/** A timer that fires this far past its delay did not time a search: the tab
 *  was suspended, and its Workers with it. */
const SUSPENDED_FACTOR = 1.5;

/** Consecutive Worker failures after which no more are spawned. One retry: a
 *  script that cannot load fails the same way every time. */
export const MAX_JUDGE_WORKER_FAILURES = 2;

type Job = {
    consult: JudgeConsult;
    settle: (answer: JudgeAnswer) => void;
};

type Slot = {
    worker: Worker;
    running: {
        id: number;
        job: Job;
        timer: ReturnType<typeof setTimeout>;
    } | null;
};

/** Open the judge's Brain, at most `size` searches at once. Spawns nothing
 *  until a consult asks. */
export function openJudgeBrain(size: number): JudgeBrain {
    const primed = new Map<string, DefinitionManifestEntry>();
    const queue: Job[] = [];
    let slots: Slot[] = [];
    let nextId = 1;
    /** Worker failures since the last reply. */
    let failures = 0;
    let closed = false;

    const canSpawn = () =>
        typeof Worker !== "undefined" && failures < MAX_JUDGE_WORKER_FAILURES;

    function postPrime(
        worker: Worker,
        entries: readonly DefinitionManifestEntry[]
    ): void {
        const message: BrainPrime = { kind: "prime", entries };
        worker.postMessage(message);
    }

    /** End `slot`'s search with `answer`; the slot is free afterwards. */
    function settleRunning(slot: Slot, answer: JudgeAnswer): void {
        const running = slot.running;
        if (!running) return;
        clearTimeout(running.timer);
        slot.running = null;
        running.job.settle(answer);
    }

    /** Drop `slot` and its Worker, whatever it was doing. */
    function retire(slot: Slot): void {
        slots = slots.filter((s) => s !== slot);
        slot.worker.onmessage = null;
        slot.worker.onerror = null;
        try {
            slot.worker.terminate();
        } catch {
            // Gone from here either way.
        }
    }

    function fail(slot: Slot, reason: string): void {
        if (!slots.includes(slot)) return;
        failures += 1;
        console.warn("verdict judge: Worker failed", reason);
        retire(slot);
        settleRunning(slot, { move: null, outcome: "worker-error" });
        pump();
    }

    function spawn(): Slot | null {
        let worker: Worker;
        try {
            worker = new Worker(brainWorkerUrl, { type: "module" });
        } catch (cause: unknown) {
            failures += 1;
            console.warn("verdict judge: Worker not constructed", cause);
            return null;
        }
        const slot: Slot = { worker, running: null };
        slots.push(slot);
        worker.onmessage = (e: MessageEvent<BrainResponse>) => {
            failures = 0;
            if (slot.running?.id !== e.data.id) return;
            settleRunning(slot, answerOf(e.data));
            pump();
        };
        worker.onerror = (e: ErrorEvent) =>
            // A script that never loaded fires an event with no message.
            fail(slot, e.message || "script failed to load");
        if (primed.size > 0) postPrime(worker, [...primed.values()]);
        return slot;
    }

    function arm(slot: Slot, id: number, timeoutMs: number) {
        const armedAt = Date.now();
        return setTimeout(() => {
            const running = slot.running;
            if (running?.id !== id) return;
            if (Date.now() - armedAt > timeoutMs * SUSPENDED_FACTOR) {
                running.timer = arm(slot, id, timeoutMs);
                return;
            }
            // The search cannot be cancelled: its Worker goes with it, so the
            // next consult never queues behind it.
            retire(slot);
            settleRunning(slot, { move: null, outcome: "timeout" });
            pump();
        }, timeoutMs);
    }

    function start(slot: Slot, job: Job): void {
        const id = nextId++;
        const { state, botId, iterations, seed, deckKnowledge } = job.consult;
        slot.running = {
            id,
            job,
            timer: arm(slot, id, judgeConsultTimeoutMs(iterations)),
        };
        const request: BrainRequest = {
            id,
            state,
            botId,
            // Iterations alone: a clock in the budget would make the answer
            // the device's.
            budget: { iterations },
            seed,
            ...(deckKnowledge ? { deckKnowledge } : {}),
        };
        try {
            slot.worker.postMessage(request);
        } catch (cause: unknown) {
            // The position cannot be cloned: this decision's loss alone.
            console.warn("verdict judge: position not posted", cause);
            settleRunning(slot, { move: null, outcome: "search-error" });
        }
    }

    /** Start every queued consult a Worker is free for. */
    function pump(): void {
        while (queue.length > 0) {
            let slot = slots.find((s) => s.running === null) ?? null;
            if (!slot && slots.length < size && canSpawn()) slot = spawn();
            if (slot) {
                start(slot, queue.shift()!);
                continue;
            }
            // Nothing free: a running search pumps again when it ends — unless
            // none runs and no Worker can be spawned.
            if (slots.length > 0) return;
            if (canSpawn()) continue;
            queue.shift()!.settle({ move: null, outcome: "worker-error" });
        }
    }

    return {
        prime: (entries) => {
            if (closed) return;
            const fresh = entries.filter((e) => !primed.has(e.definitionId));
            if (fresh.length === 0) return;
            for (const entry of fresh) primed.set(entry.definitionId, entry);
            for (const slot of slots) postPrime(slot.worker, fresh);
        },
        consult: (consult) =>
            new Promise((settle) => {
                if (closed) {
                    settle(CLOSED);
                    return;
                }
                queue.push({ consult, settle });
                pump();
            }),
        close: () => {
            if (closed) return;
            closed = true;
            for (const slot of [...slots]) {
                retire(slot);
                settleRunning(slot, CLOSED);
            }
            for (const job of queue.splice(0)) job.settle(CLOSED);
        },
    };
}

const CLOSED: JudgeAnswer = Object.freeze({
    move: null,
    outcome: "no-move",
    closed: true,
});

function answerOf(response: BrainResponse): JudgeAnswer {
    if (response.error) return { move: null, outcome: "search-error" };
    return {
        move: response.move,
        outcome: response.move ? "move" : "no-move",
        ...(response.trace ? { searchMs: response.trace.elapsedMs } : {}),
    };
}
