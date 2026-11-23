// The Brain Worker's pondering scheduler (issue #10472, ADR 0185 Amendment I):
// time slices that yield to the event loop, a consult that waits at most one
// slice, and the stops — a hidden page, the node cap, a tree a consult took.
// The clock and the event loop are stepped by hand: never wall-clock.

import { describe, expect, it } from "vitest";
import type { BrainPonder, PonderSession } from "@convex/gre/ai/ponder";
import type { TreeKeeper } from "../brain-request";
import {
    createPonderer,
    PONDER_NODE_CAP,
    PONDER_SLICE_MS,
    type PonderStopReason,
} from "../brain-ponder";

/** One iteration's cost on the fake clock. */
const ITERATION_MS = 10;

const MESSAGE = {
    kind: "ponder",
    state: {},
    botId: "bot",
    reuse: { gameId: "g", steps: [] },
} as unknown as BrainPonder;

function harness(
    options: {
        nodesPerIteration?: number;
        nodeCap?: number;
        slice?: { ms: number } | { iterations: number };
    } = {}
) {
    let clock = 0;
    const queue: (() => void)[] = [];
    const stops: PonderStopReason[] = [];
    let iterations = 0;
    let live = true;
    const session: PonderSession = {
        continued: true,
        live: () => live,
        slice(max, stop, now) {
            let ran = 0;
            while (ran < max) {
                clock += ITERATION_MS;
                ran++;
                iterations++;
                if (stop?.()) break;
            }
            void now;
            return ran;
        },
        nodes: () => 1 + iterations * (options.nodesPerIteration ?? 1),
    };
    const ponderer = createPonderer({
        keeper: { kept: null, catalogue: () => "c" } as TreeKeeper,
        defer: (task) => queue.push(task),
        now: () => clock,
        slice: options.slice ?? { ms: PONDER_SLICE_MS },
        ...(options.nodeCap === undefined ? {} : { nodeCap: options.nodeCap }),
        onStop: (reason) => stops.push(reason),
        begin: () => session,
    });
    return {
        ponderer,
        stops,
        now: () => clock,
        iterations: () => iterations,
        setLive: (value: boolean) => (live = value),
        /** Run the next task of the event loop; false when there is none. */
        tick(): boolean {
            const task = queue.shift();
            if (!task) return false;
            task();
            return true;
        },
    };
}

describe("createPonderer", () => {
    it("searches in slices of about PONDER_SLICE_MS, yielding between them", () => {
        const h = harness();
        h.ponderer.start(MESSAGE);
        // Nothing runs synchronously: the first slice is a later task.
        expect(h.iterations()).toBe(0);
        h.tick();
        expect(h.iterations()).toBe(PONDER_SLICE_MS / ITERATION_MS);
        h.tick();
        expect(h.iterations()).toBe((2 * PONDER_SLICE_MS) / ITERATION_MS);
        expect(h.ponderer.active()).toBe(true);
    });

    it("a consult arriving mid-ponder waits at most one slice", () => {
        const h = harness();
        h.ponderer.start(MESSAGE);
        // The consult is posted 20 ms into the third slice. A message is read
        // between two tasks, never inside one: the Worker's `onmessage` stops
        // the ponder first thing (`brain.worker.ts`).
        const arrival = 2 * PONDER_SLICE_MS + 20;
        let stoppedAt: number | null = null;
        while (h.tick()) {
            if (stoppedAt === null && h.now() >= arrival) {
                h.ponderer.stop("message");
                stoppedAt = h.now();
            }
        }
        expect(stoppedAt).not.toBeNull();
        expect(stoppedAt! - arrival).toBeLessThanOrEqual(PONDER_SLICE_MS);
        // Nothing ran after the stop: the queued slice found it ended.
        expect(h.iterations()).toBe(stoppedAt! / ITERATION_MS);
        expect(h.stops).toEqual(["message"]);
    });

    it("stops on a hidden page, and nothing resumes it", () => {
        const h = harness();
        h.ponderer.start(MESSAGE);
        h.tick();
        const ran = h.iterations();
        h.ponderer.stop("hidden");
        while (h.tick());
        expect(h.iterations()).toBe(ran);
        expect(h.ponderer.active()).toBe(false);
        expect(h.stops).toEqual(["hidden"]);
    });

    it("stops on the node cap", () => {
        const h = harness({ nodeCap: 60 });
        h.ponderer.start(MESSAGE);
        while (h.tick());
        expect(h.stops).toEqual(["cap"]);
        // One slice past the cap at most: the tree is counted between slices.
        expect(1 + h.iterations()).toBeGreaterThanOrEqual(60);
        expect(1 + h.iterations()).toBeLessThan(60 + PONDER_SLICE_MS);
    });

    it("applies the phone's lower cap — pondering still runs there", () => {
        const phone = harness({ nodesPerIteration: 100 });
        phone.ponderer.start({ ...MESSAGE, mobile: true });
        while (phone.tick());
        const desktop = harness({ nodesPerIteration: 100 });
        desktop.ponderer.start(MESSAGE);
        while (desktop.tick());
        expect(phone.stops).toEqual(["cap"]);
        expect(desktop.stops).toEqual(["cap"]);
        expect(phone.iterations()).toBeGreaterThan(0);
        expect(phone.iterations() * 100).toBeGreaterThanOrEqual(
            PONDER_NODE_CAP.mobile - 1
        );
        expect(phone.iterations()).toBeLessThan(desktop.iterations());
    });

    it("stops when a consult has taken the tree", () => {
        const h = harness();
        h.ponderer.start(MESSAGE);
        h.tick();
        h.setLive(false);
        const ran = h.iterations();
        while (h.tick());
        expect(h.iterations()).toBe(ran);
        expect(h.stops).toEqual(["taken"]);
    });

    it("runs a fixed number of iterations per slice in a test", () => {
        const h = harness({ slice: { iterations: 7 } });
        h.ponderer.start(MESSAGE);
        h.tick();
        h.tick();
        expect(h.iterations()).toBe(14);
    });

    it("a new ponder ends the one under way", () => {
        const h = harness();
        h.ponderer.start(MESSAGE);
        h.ponderer.start(MESSAGE);
        expect(h.stops).toEqual(["message"]);
        expect(h.ponderer.active()).toBe(true);
    });
});
