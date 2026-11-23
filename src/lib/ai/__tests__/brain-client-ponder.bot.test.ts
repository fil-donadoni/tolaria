// The page's ponder channel (issue #10472, ADR 0185 Amendment I): a ponder
// grows the tree the last consult kept, for that consult's seat and with its
// knowledge, on a Worker already running — never a fresh Worker, never
// in-thread.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import {
    consultBrain,
    disposeBrain,
    ponderBrain,
    stopPonderingBrain,
} from "../brain-client";

const posted: unknown[] = [];
let spawned = 0;

class RecordingWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    constructor() {
        spawned++;
    }
    postMessage(message: { id?: number; kind?: string }) {
        posted.push(message);
        if (message.kind === undefined) {
            this.onmessage?.({
                data: { id: message.id, move: null, trace: null },
            });
        }
    }
    terminate() {}
}

const originalWorker = globalThis.Worker;
const STATE = { seq: 7 } as unknown as PublicGameState;
const KNOWLEDGE = [{ playerId: "u-p2", cardIds: ["c1"] }];

beforeEach(() => {
    posted.length = 0;
    spawned = 0;
    (globalThis as { Worker?: unknown }).Worker =
        RecordingWorker as unknown as typeof Worker;
});

afterEach(() => {
    disposeBrain();
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
});

describe("ponderBrain", () => {
    it("posts nothing — and spawns nothing — before a consult of the game", () => {
        expect(ponderBrain(STATE, "g1", [], false)).toBe(false);
        expect(spawned).toBe(0);
        expect(posted).toEqual([]);
    });

    it("ponders for the last consult's seat, with its knowledge", async () => {
        await consultBrain(STATE, "u-p2", undefined, KNOWLEDGE, undefined, {
            gameId: "g1",
            steps: [],
        });
        const steps = [{ seat: "u-p2", key: "pass" }];
        expect(ponderBrain(STATE, "g1", steps, true)).toBe(true);
        expect(posted.at(-1)).toEqual({
            kind: "ponder",
            state: STATE,
            botId: "u-p2",
            deckKnowledge: KNOWLEDGE,
            reuse: { gameId: "g1", steps },
            mobile: true,
        });
        stopPonderingBrain();
        expect(posted.at(-1)).toEqual({ kind: "ponder-stop" });
    });

    it("ponders nothing for another game, or after a consult with no reuse", async () => {
        await consultBrain(STATE, "u-p2", undefined, KNOWLEDGE, undefined, {
            gameId: "g1",
            steps: [],
        });
        expect(ponderBrain(STATE, "g2", [], false)).toBe(false);
        await consultBrain(STATE, "u-p2", undefined, KNOWLEDGE);
        expect(ponderBrain(STATE, "g1", [], false)).toBe(false);
    });

    it("forgets the game on dispose", async () => {
        await consultBrain(STATE, "u-p2", undefined, KNOWLEDGE, undefined, {
            gameId: "g1",
            steps: [],
        });
        disposeBrain();
        expect(ponderBrain(STATE, "g1", [], false)).toBe(false);
    });
});
