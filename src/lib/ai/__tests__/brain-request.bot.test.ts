// The Brain's request handler (issue #2470).
//
// The handler used to live inside `brain.worker.ts`, where it could not be
// reached without spawning a real Worker — so its FAILURE path was never
// exercised, and that path is the whole point: a search that threw escaped to
// the Worker's `onerror`, which resolved every in-flight consult to a bare "no
// move" and discarded the error. The bot then passed every window for the rest
// of the game, indistinguishable from a bot that had chosen to pass (#2450).

import { describe, expect, it, vi } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import { handleBrainRequest, toBrainError } from "../brain-request";

const STATE = {
    seq: 1,
    turn: 1,
    passCount: 0,
    phase: "PRECOMBAT_MAIN",
    activePlayerId: "u1-p2",
    priorityPlayerId: "u1-p2",
    stack: [],
    players: [
        {
            id: "u1-p2",
            name: "bot",
            bgColor: "#000",
            life: 20,
            hand: [],
            library: { count: 0 },
            graveyard: [],
            exile: [],
            battlefield: [],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        },
        {
            id: "u1-p1",
            name: "human",
            bgColor: "#fff",
            life: 20,
            hand: [],
            library: { count: 0 },
            graveyard: [],
            exile: [],
            battlefield: [],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        },
    ],
} as unknown as PublicGameState;

const REQ = { id: 7, state: STATE, botId: "u1-p2", seed: 1 };

describe("handleBrainRequest (issue #2470)", () => {
    it("answers with the search's move and trace", () => {
        const search = vi.fn().mockReturnValue({
            move: { kind: "pass" },
            trace: { candidates: [] },
        });
        const res = handleBrainRequest(REQ, search as never);

        expect(res).toEqual({
            id: 7,
            move: { kind: "pass" },
            trace: { candidates: [] },
        });
        expect(res.error).toBeUndefined();
    });

    it("reports a thrown search as an error INSTEAD of throwing", () => {
        const search = vi.fn().mockImplementation(() => {
            throw new Error("Unknown card id");
        });

        // The contract that keeps one bad search from poisoning the Worker: the
        // call returns, and it returns evidence.
        const res = handleBrainRequest(REQ, search as never);

        expect(res.move).toBeNull();
        expect(res.trace).toBeNull();
        expect(res.error).toEqual({
            name: "Error",
            message: "Unknown card id",
        });
        expect(res.id).toBe(7);
    });

    it("is deterministic given the seed", () => {
        const seen: number[] = [];
        const search = vi
            .fn()
            .mockImplementation(
                (_s: unknown, _b: string, _bud: unknown, seed: number) => {
                    seen.push(seed);
                    return { move: null, trace: null };
                }
            );
        handleBrainRequest(REQ, search as never);
        handleBrainRequest(REQ, search as never);
        expect(seen).toEqual([1, 1]);
    });

    it("lowers a non-Error throw to plain data for the postMessage hop", () => {
        expect(toBrainError("boom")).toEqual({
            name: "UnknownError",
            message: "boom",
        });
    });
});
