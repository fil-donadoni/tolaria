// The Verdict Proposal judge's Workers (`judge-brain.ts`): searches run side by
// side, one per Worker; a Worker that dies, wedges or never loads costs the
// consults it held and nothing else; leaving the game stops them at once.
//
// The Worker is faked at its message boundary: each fake keeps what it was
// posted, and the test answers, fails or ignores it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import {
    JUDGE_MS_PER_ITERATION_CEILING,
    MAX_JUDGE_WORKER_FAILURES,
    judgeConsultTimeoutMs,
    judgeWorkerCount,
    openJudgeBrain,
    type JudgeBrain,
    type JudgeConsult,
} from "../judge-brain";

type Posted = { id: number; kind?: string; state?: unknown; entries?: unknown };

class FakeWorker {
    static all: FakeWorker[] = [];
    /** Constructing a Worker throws. */
    static refuses = false;
    posted: Posted[] = [];
    terminated = false;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
        if (FakeWorker.refuses) throw new Error("no Worker for you");
        FakeWorker.all.push(this);
    }
    postMessage(message: Posted) {
        this.posted.push(message);
    }
    terminate() {
        this.terminated = true;
    }
    get requests(): Posted[] {
        return this.posted.filter((p) => p.kind !== "prime");
    }
    /** Answer the last request posted. */
    answer(move: unknown = { kind: "pass" }) {
        const { id } = this.requests[this.requests.length - 1];
        this.onmessage?.({ data: { id, move, trace: null } });
    }
}

const position = (n: number, iterations = 200): JudgeConsult => ({
    state: { seq: n } as unknown as PublicGameState,
    botId: "me",
    iterations,
    seed: 1,
});

const entry = (definitionId: string) =>
    ({ definitionId, set: "lea" }) as unknown as DefinitionManifestEntry;

let brain: JudgeBrain;

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeWorker.all = [];
    FakeWorker.refuses = false;
    vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
    brain?.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("judge Workers — searches side by side", () => {
    it("spawns none before a consult, then one per consult up to the size; the rest wait for a free one", async () => {
        brain = openJudgeBrain(2);
        expect(FakeWorker.all).toHaveLength(0);
        const answers = [1, 2, 3].map((n) => brain.consult(position(n)));
        expect(FakeWorker.all).toHaveLength(2);
        // One search each: the third is in no Worker's queue.
        expect(FakeWorker.all.map((w) => w.requests.length)).toEqual([1, 1]);

        FakeWorker.all[1].answer();
        expect(FakeWorker.all).toHaveLength(2);
        expect(FakeWorker.all[1].requests.map((r) => r.state)).toEqual([
            { seq: 2 },
            { seq: 3 },
        ]);
        FakeWorker.all[0].answer({ kind: "pass", n: 1 });
        FakeWorker.all[1].answer({ kind: "pass", n: 3 });
        expect((await Promise.all(answers)).map((a) => a.move)).toEqual([
            { kind: "pass", n: 1 },
            { kind: "pass" },
            { kind: "pass", n: 3 },
        ]);
    });

    it("runs the device's cores but one, a handful at most, fewer on a phone", () => {
        expect(judgeWorkerCount(1, false)).toBe(1);
        expect(judgeWorkerCount(undefined, false)).toBe(1);
        expect(judgeWorkerCount(4, false)).toBe(3);
        expect(judgeWorkerCount(16, false)).toBe(4);
        expect(judgeWorkerCount(8, true)).toBe(2);
    });
});

describe("judge Workers — primed with the game's Manifest", () => {
    it("a Worker gets the Manifest before its first request, and an entry that arrives later at once", () => {
        brain = openJudgeBrain(1);
        brain.prime([entry("a")]);
        expect(FakeWorker.all).toHaveLength(0);
        void brain.consult(position(1));
        const [w] = FakeWorker.all;
        expect(w.posted.map((p) => p.kind ?? "consult")).toEqual([
            "prime",
            "consult",
        ]);
        expect(w.posted[0].entries).toEqual([entry("a")]);
        brain.prime([entry("a"), entry("b")]);
        expect(w.posted[2]).toEqual({ kind: "prime", entries: [entry("b")] });
    });
});

describe("judge Workers — a failure costs the consult it held", () => {
    it("a Worker that dies settles its consult as worker-error; the next runs on a fresh one", async () => {
        brain = openJudgeBrain(1);
        const first = brain.consult(position(1));
        const second = brain.consult(position(2));
        const [dead] = FakeWorker.all;
        dead.onerror!({ message: "boom" });
        expect(await first).toEqual({ move: null, outcome: "worker-error" });
        expect(dead.terminated).toBe(true);
        expect(FakeWorker.all).toHaveLength(2);
        FakeWorker.all[1].answer();
        expect((await second).outcome).toBe("move");
    });

    it("a script that never loads stops being spawned, and every consult still settles", async () => {
        brain = openJudgeBrain(1);
        const all = [1, 2, 3, 4].map((n) => brain.consult(position(n)));
        for (let n = 0; n < MAX_JUDGE_WORKER_FAILURES; n++) {
            FakeWorker.all[FakeWorker.all.length - 1].onerror!({});
        }
        expect((await Promise.all(all)).map((a) => a.outcome)).toEqual(
            Array(4).fill("worker-error")
        );
        expect(FakeWorker.all).toHaveLength(MAX_JUDGE_WORKER_FAILURES);
    });

    it("a reply proves the script loads: failures apart never add up", async () => {
        brain = openJudgeBrain(1);
        for (let n = 0; n < MAX_JUDGE_WORKER_FAILURES + 1; n++) {
            const ok = brain.consult(position(n));
            FakeWorker.all[FakeWorker.all.length - 1].answer();
            expect((await ok).outcome).toBe("move");
            const lost = brain.consult(position(n));
            FakeWorker.all[FakeWorker.all.length - 1].onerror!({});
            expect((await lost).outcome).toBe("worker-error");
        }
    });

    it("no Worker here, or one that cannot be constructed, is no answer — never a search on this thread", async () => {
        FakeWorker.refuses = true;
        brain = openJudgeBrain(2);
        expect(await brain.consult(position(1))).toEqual({
            move: null,
            outcome: "worker-error",
        });
        brain.close();
        vi.stubGlobal("Worker", undefined);
        brain = openJudgeBrain(2);
        expect((await brain.consult(position(1))).outcome).toBe("worker-error");
    });

    it("a search that throws in the Worker is that decision's alone", async () => {
        brain = openJudgeBrain(1);
        const answer = brain.consult(position(1));
        const [w] = FakeWorker.all;
        w.onmessage!({
            data: {
                id: w.requests[0].id,
                move: null,
                trace: null,
                error: { name: "Error", message: "bad position" },
            },
        });
        expect(await answer).toEqual({ move: null, outcome: "search-error" });
        expect(w.terminated).toBe(false);
    });
});

describe("judge Workers — slow is not wedged", () => {
    it("waits a whole slow device's search, then gives the Worker up with it", async () => {
        brain = openJudgeBrain(1);
        const iterations = 200;
        expect(judgeConsultTimeoutMs(iterations)).toBe(
            iterations * JUDGE_MS_PER_ITERATION_CEILING
        );
        const wedged = brain.consult(position(1, iterations));
        const next = brain.consult(position(2, iterations));
        // Gecko's p90 field reading, end to end.
        vi.advanceTimersByTime(iterations * 1_658);
        expect(FakeWorker.all[0].terminated).toBe(false);
        vi.advanceTimersByTime(iterations * JUDGE_MS_PER_ITERATION_CEILING);
        expect((await wedged).outcome).toBe("timeout");
        expect(FakeWorker.all[0].terminated).toBe(true);
        // The next consult queues behind nothing.
        FakeWorker.all[1].answer();
        expect((await next).outcome).toBe("move");
    });

    it("a tab suspended past the timeout delays the answer, it does not lose it", async () => {
        brain = openJudgeBrain(1);
        const answer = brain.consult(position(1, 200));
        // The timer fires on resume, long after its delay.
        vi.setSystemTime(Date.now() + 28.5 * 60_000);
        vi.advanceTimersByTime(judgeConsultTimeoutMs(200));
        expect(FakeWorker.all[0].terminated).toBe(false);
        FakeWorker.all[0].answer();
        expect((await answer).outcome).toBe("move");
    });
});

describe("judge Workers — leaving the game", () => {
    it("close stops every Worker and settles every consult, running or waiting, then and later", async () => {
        brain = openJudgeBrain(1);
        const running = brain.consult(position(1));
        const waiting = brain.consult(position(2));
        brain.close();
        brain.close();
        expect(FakeWorker.all[0].terminated).toBe(true);
        expect((await running).closed).toBe(true);
        expect((await waiting).closed).toBe(true);
        expect((await brain.consult(position(3))).closed).toBe(true);
        expect(FakeWorker.all).toHaveLength(1);
    });
});
