// Which SERVER verb each manual dispatch key reaches.
//
// The bug this pins (QA: "the concede button in manual is still inert"):
// `concede` was bound to `api.game.manualConcede`, a mutation that stamped
// `concededBy` on the manual state and stopped — a field no client and no
// server path ever read. The click wrote a row and ended nothing. Manual Mode
// has exactly ONE terminator (ADR 0080: "a game ends by concede only"), so the
// binding must be `manualConcedeMatch`, which finishes the game row, awards
// the opponent and advances the Match.
//
// Asserted as the WHOLE map rather than the one key, because the failure mode
// is generic: any dispatch key silently pointed at a near-miss mutation looks
// wired at the call site and does nothing on the server.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {};

vi.mock("convex/react", () => ({
    useMutation: (ref?: { _name?: string }) => {
        const name = ref?._name;
        if (!name) throw new Error("useMutation called with no function ref");
        MUTATIONS[name] ??= vi.fn();
        return MUTATIONS[name];
    },
}));

// A Proxy stands in for the generated `api.game`, so an unknown mutation name
// resolves to a ref instead of `undefined` — a typo'd binding then shows up as
// a WRONG name in the assertion below rather than as a crash with no name.
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: new Proxy(
            {},
            { get: (_t, prop: string) => ({ _name: prop }) }
        ) as Record<string, { _name: string }>,
    },
}));

import { useManualDispatch } from "~/hooks/useManualDispatch";

const GAME_ID = "game_1" as Id<"games">;

/** Every dispatch key, with the server mutation it must reach and one legal
 *  argument object to invoke it with. */
const BINDINGS: {
    key: keyof ReturnType<typeof useManualDispatch>;
    mutation: string;
    args: Record<string, unknown>;
}[] = [
    { key: "moveCard", mutation: "manualMoveCard", args: {} },
    { key: "setTapped", mutation: "manualSetTapped", args: {} },
    { key: "untapAll", mutation: "manualUntapAll", args: {} },
    { key: "adjustLife", mutation: "manualAdjustLife", args: {} },
    { key: "adjustCounter", mutation: "manualAdjustCounter", args: {} },
    { key: "setFaceDown", mutation: "manualSetFaceDown", args: {} },
    { key: "setLane", mutation: "manualSetLane", args: {} },
    { key: "setBackColumn", mutation: "manualSetBackColumn", args: {} },
    { key: "attach", mutation: "manualAttach", args: {} },
    { key: "setArrow", mutation: "manualSetArrow", args: {} },
    { key: "clearArrow", mutation: "manualClearArrow", args: {} },
    { key: "draw", mutation: "manualDraw", args: {} },
    { key: "mill", mutation: "manualMill", args: {} },
    { key: "exileTop", mutation: "manualExileTop", args: {} },
    { key: "peek", mutation: "manualPeek", args: {} },
    { key: "shuffle", mutation: "manualShuffle", args: {} },
    { key: "setNote", mutation: "manualSetNote", args: {} },
    { key: "setPhase", mutation: "manualSetPhase", args: {} },
    { key: "reveal", mutation: "manualReveal", args: {} },
    { key: "revealHand", mutation: "manualRevealHand", args: {} },
    { key: "endTurn", mutation: "manualEndTurn", args: {} },
    {
        key: "concede",
        mutation: "manualConcedeMatch",
        args: { playerId: "p1" },
    },
];

describe("useManualDispatch (ADR 0080)", () => {
    beforeEach(() => {
        for (const fn of Object.values(MUTATIONS)) fn.mockClear();
    });

    it.each(BINDINGS)(
        "dispatch.$key calls $mutation with the bound gameId",
        ({ key, mutation, args }) => {
            const { result } = renderHook(() => useManualDispatch(GAME_ID));
            (result.current[key] as (a: Record<string, unknown>) => void)(args);

            expect(MUTATIONS[mutation]).toHaveBeenCalledWith({
                gameId: GAME_ID,
                ...args,
            });
        }
    );

    it("never binds the inert `manualConcede` write-and-do-nothing mutation", () => {
        const { result } = renderHook(() => useManualDispatch(GAME_ID));
        result.current.concede({ playerId: "p1" });

        expect(MUTATIONS.manualConcede).toBeUndefined();
    });
});
