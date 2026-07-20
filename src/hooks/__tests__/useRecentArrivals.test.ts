// Zone-change arrival detection: the wire is a pure snapshot, so the client
// diffs consecutive states by stable instance id to learn which cards changed
// zone (or appeared from a hidden one). That set drives the arrival glow and
// the battlefield permanent-stack deferral.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRecentArrivals, ARRIVAL_GLOW_MS } from "../useRecentArrivals";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { emptyManaPool } from "~/types/game";

function makeCard(id: string, zone = "hand"): CardInstance {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: "p1",
        ownerId: "p1",
        zone,
    } as CardInstance;
}

function makePlayer(
    zones: Partial<
        Pick<Player, "hand" | "battlefield" | "graveyard" | "exile">
    > = {}
): Player {
    return {
        id: "p1",
        name: "P1",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: emptyManaPool,
        ...zones,
    };
}

function makeStackItem(id: string): StackItem {
    return { ...makeCard(id, "stack"), castById: "p1" } as unknown as StackItem;
}

afterEach(() => {
    vi.useRealTimers();
});

describe("useRecentArrivals", () => {
    it("treats the first snapshot as the baseline — no arrivals on mount", () => {
        const players = [makePlayer({ hand: [makeCard("a")] })];
        const { result } = renderHook(() => useRecentArrivals(players, []));
        expect(result.current.size).toBe(0);
    });

    it("detects a card moving hand → stack", () => {
        const before = [makePlayer({ hand: [makeCard("a")] })];
        const after = [makePlayer({ hand: [] })];
        const { result, rerender } = renderHook(
            ({ players, stack }) => useRecentArrivals(players, stack),
            { initialProps: { players: before, stack: [] as StackItem[] } }
        );
        rerender({ players: after, stack: [makeStackItem("a")] });
        expect(result.current.has("a")).toBe(true);
    });

    it("detects battlefield → graveyard and stack → battlefield", () => {
        const before = [makePlayer({ battlefield: [makeCard("x")] })];
        const { result, rerender } = renderHook(
            ({ players, stack }) => useRecentArrivals(players, stack),
            {
                initialProps: {
                    players: before,
                    stack: [makeStackItem("y")],
                },
            }
        );
        const after = [
            makePlayer({
                battlefield: [makeCard("y")],
                graveyard: [makeCard("x")],
            }),
        ];
        rerender({ players: after, stack: [] });
        expect(result.current.has("x")).toBe(true);
        expect(result.current.has("y")).toBe(true);
    });

    it("flags a card appearing from a hidden zone (no previous membership)", () => {
        const before = [makePlayer()];
        const { result, rerender } = renderHook(
            ({ players, stack }) => useRecentArrivals(players, stack),
            { initialProps: { players: before, stack: [] as StackItem[] } }
        );
        // Opponent casts from a hidden hand: the id was never visible before.
        rerender({ players: [makePlayer()], stack: [makeStackItem("opp")] });
        expect(result.current.has("opp")).toBe(true);
    });

    it("does NOT flag a card that stays in the same zone across pushes", () => {
        const before = [makePlayer({ battlefield: [makeCard("a")] })];
        const { result, rerender } = renderHook(
            ({ players, stack }) => useRecentArrivals(players, stack),
            { initialProps: { players: before, stack: [] as StackItem[] } }
        );
        // A tap/state change push with identical zone membership.
        rerender({
            players: [
                makePlayer({
                    battlefield: [{ ...makeCard("a"), isTapped: true }],
                }),
            ],
            stack: [],
        });
        expect(result.current.size).toBe(0);
    });

    it("flags every card of a simultaneous multi-card move (draw 3)", () => {
        const before = [makePlayer()];
        const { result, rerender } = renderHook(
            ({ players }) => useRecentArrivals(players, []),
            { initialProps: { players: before } }
        );
        rerender({
            players: [
                makePlayer({
                    hand: [makeCard("d1"), makeCard("d2"), makeCard("d3")],
                }),
            ],
        });
        expect(result.current.size).toBe(3);
    });

    it("expires arrivals after ARRIVAL_GLOW_MS", () => {
        vi.useFakeTimers();
        const before = [makePlayer({ hand: [makeCard("a")] })];
        const { result, rerender } = renderHook(
            ({ players, stack }) => useRecentArrivals(players, stack),
            { initialProps: { players: before, stack: [] as StackItem[] } }
        );
        rerender({ players: [makePlayer()], stack: [makeStackItem("a")] });
        expect(result.current.has("a")).toBe(true);
        act(() => {
            vi.advanceTimersByTime(ARRIVAL_GLOW_MS + 10);
        });
        expect(result.current.size).toBe(0);
    });
});
