// A dead Brain Worker is recoverable, bounded, and loud (issue #3040).
//
// The reported symptom was "the bot kept a hand with 0 lands". It had not: the
// attached state shows four lands in hand at turn 4 and an empty battlefield,
// and the report's own decision ring shows why — one `worker-error` on the
// bot's first main phase, then nothing but `timeout` for the rest of the game.
// The recorded reason was the literal fallback string `"worker error"`, which
// the client emitted only for an event with no `message` property at all: the
// signature of a module Worker whose SCRIPT FAILED TO LOAD (a runtime crash
// always arrives as an `ErrorEvent`, carrying `message`).
//
// The search was healthy on that position — it returns `play-land` in ~1s at
// `medium` on every seed. What was broken was the handle: the Worker is a
// module-level singleton, and `onerror` failed the in-flight consults and
// stopped there. It never terminated the handle and never cleared the
// singleton, so every later consult posted into a dead Worker, waited out the
// full consult timeout and settled with no move — which the driver's fallback
// turns into a PASS on an ordinary priority window. One load failure therefore
// made the bot pass every real decision for the rest of the game.
//
// Everything below drives the REAL `brain-client` module with a stub `Worker`,
// because the failure lives in the handle's lifecycle and nowhere else. Each
// stub COUNTS its constructions: "how many Workers did this game build" is the
// assertion the old code fails, with the count stuck at 1.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import type { SearchBudget } from "@convex/gre";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { DIFFICULTY_BUDGETS } from "@convex/gre/difficulty";
import {
    consultBrain,
    disposeBrain,
    warmBrain,
    BRAIN_CONSULT_TIMEOUT_MS,
    BRAIN_FALLBACK_BUDGET,
    MAX_BRAIN_WORKER_SPAWNS,
    WORKER_SCRIPT_LOAD_FAILURE,
} from "../brain-client";
import { clearAiDecisions, getAiDecisions } from "../trace-store";

/** Every budget the in-thread handler was actually asked to search at. The
 *  handler itself is the REAL one — only wrapped — because the fallback's job is
 *  to return a real move, and a stubbed search could not show that. Without
 *  this seam the clamp is unobservable: a fallback searching at the caller's
 *  full `hard` budget still returns the same move, three seconds later, on the
 *  UI thread. */
const searchedAt: (SearchBudget | undefined)[] = [];
vi.mock("../brain-request", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../brain-request")>();
    return {
        ...actual,
        handleBrainRequest: (
            ...args: Parameters<typeof actual.handleBrainRequest>
        ) => {
            searchedAt.push(args[0].budget);
            return actual.handleBrainRequest(...args);
        },
    };
});

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const FOREST = getCardByName("Forest").id;

/** How many Workers the stub under test has constructed. */
let constructed = 0;

/** A Worker whose SCRIPT never loads: the spec fires a plain `Event` — no
 *  `message`, no `filename` — asynchronously, and `postMessage` reaches nothing.
 *  This is the shape issue #3040's report proves it hit. */
class LoadFailingWorker {
    onmessage: unknown = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
        constructed += 1;
        // A microtask, not a timer: the spec fires this event on its own,
        // without anything being asked of the Worker, which is exactly why the
        // warm-up spawn can fail with no consult pending.
        void Promise.resolve().then(() => this.onerror?.({ type: "error" }));
    }
    postMessage() {}
    terminate() {}
}

/** A Worker that CRASHED at runtime: an `ErrorEvent`, so a message and a
 *  position are both available — and both used to be thrown away. */
class CrashingWorker {
    onmessage: unknown = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
        constructed += 1;
        void Promise.resolve().then(() =>
            this.onerror?.({
                message: "x is not a function",
                filename: "http://localhost/assets/brain.worker-abc123.js",
                lineno: 42,
                colno: 7,
            })
        );
    }
    postMessage() {}
    terminate() {}
}

/** A Worker that fails ONCE — the transient crash the respawn is for. The
 *  second construction answers normally. */
class FlakyWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private readonly healthy: boolean;
    constructor() {
        constructed += 1;
        this.healthy = constructed > 1;
        if (!this.healthy) {
            void Promise.resolve().then(() =>
                this.onerror?.({ message: "boom" })
            );
        }
    }
    postMessage(req: { id: number }) {
        if (this.healthy)
            this.onmessage?.({
                data: { id: req.id, move: { kind: "pass" }, trace: null },
            });
    }
    terminate() {}
}

const originalWorker = globalThis.Worker;
function useWorker(stub: unknown) {
    (globalThis as { Worker?: unknown }).Worker = stub;
}

/** A board the bot should answer on: its own precombat main, priority held, a
 *  land in hand. Projected to the bot's viewpoint, because that is what a
 *  consult is handed — a hand-built view would not exercise the adapter the
 *  in-thread handler runs. */
function landInHandBoard(): PublicGameState {
    const state = makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, {
                hand: [
                    makeInstance(FOREST, {
                        id: "land1",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    return projectPublicState(state, 1, BOT);
}

/** Let the stub's asynchronous `error` event — and the recovery it triggers —
 *  run, without letting the consult timeout fire. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    constructed = 0;
    searchedAt.length = 0;
    clearAiDecisions();
    vi.useFakeTimers();
    // The handler draws its own seed from `Math.random` when the caller gives
    // none, and `consultBrain` gives none: pin it so the in-thread fallback's
    // search is deterministic.
    vi.spyOn(Math, "random").mockReturnValue(0);
    useWorker(LoadFailingWorker);
});

afterEach(() => {
    disposeBrain();
    useWorker(originalWorker);
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("a failed Brain Worker is replaced, not reused (issue #3040)", () => {
    it("constructs a NEW Worker for the next consult", async () => {
        const first = consultBrain(landInHandBoard(), BOT);
        await flush();
        // The failing consult still reports the failure — that breadcrumb is
        // what #2470 shipped and it stays.
        await expect(first).resolves.toMatchObject({
            outcome: "worker-error",
            via: "worker",
        });
        expect(constructed).toBe(1);

        // THE defect: the singleton was left installed, so this posted into a
        // dead handle and the count stayed at 1 forever.
        const second = consultBrain(landInHandBoard(), BOT);
        await flush();
        await second;
        expect(constructed).toBe(2);
    });

    it("recovers completely when the failure was transient", async () => {
        useWorker(FlakyWorker);
        const first = consultBrain(landInHandBoard(), BOT);
        await flush();
        await expect(first).resolves.toMatchObject({ outcome: "worker-error" });

        // The respawned Worker is healthy, and the bot is back on the Worker
        // path — not stuck on a fallback for the rest of the game.
        const second = consultBrain(landInHandBoard(), BOT);
        await flush();
        await expect(second).resolves.toMatchObject({
            outcome: "move",
            via: "worker",
            move: { kind: "pass" },
        });
        expect(constructed).toBe(2);
    });

    it("never constructs more than MAX_BRAIN_WORKER_SPAWNS in one game", async () => {
        for (let i = 0; i < 6; i += 1) {
            const consult = consultBrain(landInHandBoard(), BOT);
            await flush();
            await consult;
        }
        expect(constructed).toBe(MAX_BRAIN_WORKER_SPAWNS);
    });

    it("gives the next game a fresh budget — the cap is per GAME", async () => {
        for (let i = 0; i < 3; i += 1) {
            const consult = consultBrain(landInHandBoard(), BOT);
            await flush();
            await consult;
        }
        expect(constructed).toBe(MAX_BRAIN_WORKER_SPAWNS);

        // `useVsAiDriver` calls this when the bot seat goes away. Without the
        // reset the cap would be per TAB: the next game would inherit an
        // exhausted Brain and never even try to spawn one.
        disposeBrain();
        const consult = consultBrain(landInHandBoard(), BOT);
        await flush();
        await consult;
        expect(constructed).toBe(MAX_BRAIN_WORKER_SPAWNS + 1);
    });
});

describe("the in-thread fallback answers once the Worker is out of respawns (issue #3040)", () => {
    /** Drive the game to the exhausting failure the way the app does: the
     *  warm-up spawn at mount, then the bot's first real consult. */
    async function firstConsultAfterWarmUp() {
        warmBrain();
        await flush();
        const consult = consultBrain(landInHandBoard(), BOT);
        await flush();
        return consult;
    }

    it("plays a land on the bot's own main phase instead of returning no move", async () => {
        const result = await firstConsultAfterWarmUp();
        // The whole point: `move: null` here is what the driver turns into a
        // pass, which is what made the bot sit on four lands in hand all game.
        expect(result).toMatchObject({
            outcome: "move",
            via: "inline",
            move: { kind: "play-land" },
        });
        expect(constructed).toBe(MAX_BRAIN_WORKER_SPAWNS);
    });

    it("pays no consult timeout — it settles without the clock moving", async () => {
        // With fake timers NOT advanced past 0, a result that needed
        // `BRAIN_CONSULT_TIMEOUT_MS` could not have arrived at all. This is the
        // second half of the report's signature: `timeout after 5003ms`,
        // repeated for every window after the first.
        const result = await firstConsultAfterWarmUp();
        expect(result.outcome).not.toBe("timeout");
        expect(BRAIN_FALLBACK_BUDGET.timeMs!).toBeLessThan(
            BRAIN_CONSULT_TIMEOUT_MS
        );
    });

    it("searches at the reduced budget, because it runs on the UI thread", async () => {
        // The player asked for `hard` — 1,200 iterations / 3,000 ms. Handing
        // that to the main thread would freeze the tab for three seconds per
        // decision, so the fallback clamps it.
        warmBrain();
        await flush();
        const consult = consultBrain(
            landInHandBoard(),
            BOT,
            DIFFICULTY_BUDGETS.hard
        );
        await flush();
        await consult;
        expect(searchedAt.at(-1)).toMatchObject({
            iterations: BRAIN_FALLBACK_BUDGET.iterations,
            timeMs: BRAIN_FALLBACK_BUDGET.timeMs,
        });
        // Weaker than every real preset above `easy`.
        expect(BRAIN_FALLBACK_BUDGET.iterations!).toBeGreaterThan(0);
        expect(BRAIN_FALLBACK_BUDGET.iterations!).toBeLessThan(
            DIFFICULTY_BUDGETS.medium.iterations!
        );
        expect(BRAIN_FALLBACK_BUDGET.timeMs!).toBeLessThan(
            DIFFICULTY_BUDGETS.medium.timeMs!
        );
    });

    it("keeps a caller's already-smaller budget rather than raising it", async () => {
        // `easy` is 3 iterations / 120ms — the clamp is a CEILING, so it must
        // not hand the main thread MORE work than the player asked for.
        expect(DIFFICULTY_BUDGETS.easy.iterations!).toBeLessThan(
            BRAIN_FALLBACK_BUDGET.iterations!
        );
        warmBrain();
        await flush();
        const consult = consultBrain(
            landInHandBoard(),
            BOT,
            DIFFICULTY_BUDGETS.easy
        );
        await flush();
        await expect(consult).resolves.toMatchObject({ via: "inline" });
        expect(searchedAt.at(-1)).toMatchObject({
            iterations: DIFFICULTY_BUDGETS.easy.iterations,
            timeMs: DIFFICULTY_BUDGETS.easy.timeMs,
        });
    });
});

describe("a Worker failure names what failed (issue #3040)", () => {
    it("reports an event carrying no message as a load failure, not 'worker error'", async () => {
        const consult = consultBrain(landInHandBoard(), BOT);
        await flush();
        const { message } = await consult;
        expect(message).toContain(WORKER_SCRIPT_LOAD_FAILURE);
        expect(message).toContain("brain.worker.ts");
        // The old reason, and the one the report arrived with — it named
        // neither the script nor the position.
        expect(message).not.toBe("worker error");
    });

    it("keeps a runtime crash's message AND its position", async () => {
        useWorker(CrashingWorker);
        const consult = consultBrain(landInHandBoard(), BOT);
        await flush();
        const { message } = await consult;
        expect(message).toContain("x is not a function");
        expect(message).toContain("brain.worker-abc123.js:42:7");
        expect(message).not.toContain(WORKER_SCRIPT_LOAD_FAILURE);
    });
});

describe("a Worker failure nobody is waiting on is still recorded (issue #3040)", () => {
    it("records the warm-up spawn's failure, with no window to name", async () => {
        // Nothing is pending: `warmBrain` runs on mount, before the game rests
        // on the bot. This failure resolved nothing and was recorded nowhere,
        // so the bot's breakage was invisible until its first real decision.
        warmBrain();
        await flush();

        const records = getAiDecisions();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            outcome: "worker-error",
            via: "worker",
        });
        expect(records[0].message).toContain(WORKER_SCRIPT_LOAD_FAILURE);
        // Honestly incomplete rather than padded: a `seq` naming a version the
        // failure never saw cannot be lined up with the board snapshot beside
        // it, which is the whole job of these fields.
        expect(records[0].expectedKind).toBeUndefined();
        expect(records[0].phase).toBeUndefined();
        expect(records[0].seq).toBeUndefined();
    });

    it("records the exhausting failure, whose consult reports the fallback instead", async () => {
        warmBrain();
        await flush();
        const consult = consultBrain(landInHandBoard(), BOT);
        await flush();
        await consult;

        const records = getAiDecisions();
        expect(records).toHaveLength(2);
        expect(records[1].message).toContain("out of respawns");
    });

    it("does not double-record a failure an in-flight consult already reports", async () => {
        // The first failure with a consult pending: the consult's own verdict
        // carries it to the ring through the driver, so recording it here too
        // would show the same failure twice.
        const consult = consultBrain(landInHandBoard(), BOT);
        await flush();
        await consult;
        expect(getAiDecisions()).toHaveLength(0);
    });
});
