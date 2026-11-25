// The Bot's Brain channel says when the Bot is searching (`isBrainBusy`,
// `onBrainBusyChange`): raised before a consult's search starts, lowered once
// it settled — answered, failed, timed out or disposed — so that work which
// must not slow the Bot can wait for it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import {
    BRAIN_CONSULT_TIMEOUT_MS,
    calibrateBrain,
    consultBrain,
    disposeBrain,
    isBrainBusy,
    onBrainBusyChange,
    warmBrain,
} from "../brain-client";

class SilentWorker {
    static last: SilentWorker;
    /** Whether the Bot read as searching when each consult was posted. */
    static busyAtPost: boolean[] = [];
    ids: number[] = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
        SilentWorker.last = this;
    }
    postMessage(message: { id: number }) {
        SilentWorker.busyAtPost.push(isBrainBusy());
        this.ids.push(message.id);
    }
    terminate() {}
    answer(n: number) {
        this.onmessage?.({
            data: { id: this.ids[n], move: { kind: "pass" }, trace: null },
        });
    }
}

const STATE = {} as unknown as PublicGameState;
let seen: boolean[] = [];
let unsubscribe: () => void;

const consult = () => consultBrain(STATE, "bot", { iterations: 1 });
/** Every settled promise's continuations have run. */
const settled = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    vi.useFakeTimers();
    SilentWorker.busyAtPost = [];
    vi.stubGlobal("Worker", SilentWorker);
    seen = [];
    unsubscribe = onBrainBusyChange((busy) => seen.push(busy));
});

afterEach(async () => {
    unsubscribe();
    disposeBrain();
    await settled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("the Brain's busy signal", () => {
    it("is raised before the search starts and lowered once the consult answered", async () => {
        expect(isBrainBusy()).toBe(false);
        const answer = consult();
        expect(SilentWorker.busyAtPost).toEqual([true]);
        expect(isBrainBusy()).toBe(true);
        expect(seen).toEqual([true]);
        SilentWorker.last.answer(0);
        expect((await answer).outcome).toBe("move");
        expect(isBrainBusy()).toBe(false);
        expect(seen).toEqual([true, false]);
    });

    it("stays up across overlapping consults: one stretch, not two", async () => {
        const first = consult();
        const second = consult();
        SilentWorker.last.answer(0);
        await first;
        expect(isBrainBusy()).toBe(true);
        SilentWorker.last.answer(1);
        await second;
        expect(seen).toEqual([true, false]);
    });

    it.each([
        [
            "a Worker that died",
            () => SilentWorker.last.onerror!({ message: "boom" }),
        ],
        [
            "a timeout",
            () => vi.advanceTimersByTimeAsync(BRAIN_CONSULT_TIMEOUT_MS),
        ],
        ["a dispose", () => disposeBrain()],
    ])("is lowered by %s", async (_, end) => {
        const answer = consult();
        await end();
        expect((await answer).move).toBeNull();
        expect(isBrainBusy()).toBe(false);
        expect(seen).toEqual([true, false]);
    });

    it("is not raised by the warm-up or a calibration", async () => {
        warmBrain();
        void calibrateBrain();
        expect(isBrainBusy()).toBe(false);
        expect(seen).toEqual([]);
    });

    it("a listener that throws costs the Bot nothing, and one that unsubscribed hears nothing", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const off = onBrainBusyChange(() => {
            throw new Error("listener exploded");
        });
        const answer = consult();
        SilentWorker.last.answer(0);
        expect((await answer).outcome).toBe("move");
        off();
        unsubscribe();
        seen = [];
        const next = consult();
        SilentWorker.last.answer(1);
        await next;
        expect(seen).toEqual([]);
    });
});
