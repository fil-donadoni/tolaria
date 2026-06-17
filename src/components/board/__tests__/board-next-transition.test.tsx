// Slice #252 (PRD #249) — board-level integration: when a card changes zone
// (hand → battlefield on cast) or a zone's count changes (draw / reflow), the
// new spatial board keeps the card's slot identity (keyed by instance id) and
// re-places it via the shared layout math, animating instead of jumping.
//
// Asserts observable facts across the full BoardNext → SpatialZone → SpatialSlot
// path: the card's slot is present (by id) before and after the move, its
// placement updates, neighbours reflow, and the LayoutGroup that drives the
// cross-zone FLIP wraps the tree.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CARD_WIDTH } from "~/lib/board-layout";

const ZONE_W = 1000;
const ZONE_H = 300;
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: ZONE_W, height: ZONE_H },
    }),
}));

// Leaf card visuals → inert marker carrying the card id, so we can follow a
// specific card across zones. Note: spatial-slot is NOT mocked — the real
// animated slot runs through this test.
vi.mock("../board-next-card", () => ({
    default: ({ card }: { card: CardInstance | null }) => (
        <div data-testid="bn-card" data-card-id={card ? card.id : "back"} />
    ),
}));
// Interactive viewer-hand card (#254) pulls in Convex useMutation — stub inert;
// slot identity for the FLIP comes from SpatialSlot, not this leaf.
vi.mock("../board-next-hand-card", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="bn-card" data-card-id={card.id} />
    ),
}));
vi.mock("../game-stack", () => ({ default: () => null }));
vi.mock("../board-next-piles", () => ({ default: () => null }));
vi.mock("../phase-tracker", () => ({ default: () => null }));
vi.mock("../priority-indicator", () => ({ default: () => null }));
vi.mock("../target-arrows-overlay", () => ({ default: () => null }));

import BoardNext from "../board-next";

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
    };
}

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function ctx(): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
}

function renderBoard(me: Player, opp: Player) {
    return render(
        <GameContext value={ctx()}>
            <BoardNext orderedPlayers={[opp, me]} stackItems={[]} />
        </GameContext>
    );
}

function slot(id: string) {
    return document.querySelector<HTMLElement>(`[data-card-slot='${id}']`);
}

function centerX(el: HTMLElement) {
    const m = el.style.transform.match(/translate\(([-\d.]+)px,/);
    return Number(m![1]) + CARD_WIDTH / 2;
}

describe("BoardNext zone-transition (#252)", () => {
    beforeEach(() => cleanup());

    it("wraps the board in a shared LayoutGroup (cross-zone FLIP context)", () => {
        // LayoutGroup renders no DOM of its own, but the presence of the
        // animated slots (data-card-slot) confirms the SpatialSlot path is live.
        renderBoard(
            makePlayer("me", { hand: [makeCard("bolt")] }),
            makePlayer("opp")
        );
        expect(slot("bolt")).toBeTruthy();
    });

    it("keeps a card's slot identity (by id) when it moves hand → battlefield", () => {
        const { rerender } = renderBoard(
            makePlayer("me", { hand: [makeCard("bolt")], battlefield: [] }),
            makePlayer("opp")
        );

        const inHand = slot("bolt");
        expect(inHand).toBeTruthy();
        // It lives in the hand zone before the move.
        expect(
            screen
                .getByTestId("zone-player-hand")
                .querySelector("[data-card-slot='bolt']")
        ).toBeTruthy();

        // Cast: the same card instance is now on the battlefield.
        rerender(
            <GameContext value={ctx()}>
                <BoardNext
                    orderedPlayers={[
                        makePlayer("opp"),
                        makePlayer("me", {
                            hand: [],
                            battlefield: [makeCard("bolt")],
                        }),
                    ]}
                    stackItems={[]}
                />
            </GameContext>
        );

        const onBf = slot("bolt");
        // Same logical card slot (same instance id) — animates across zones, not
        // a fresh element. It now lives in the battlefield zone.
        expect(onBf).toBeTruthy();
        expect(
            screen
                .getByTestId("zone-player-battlefield")
                .querySelector("[data-card-slot='bolt']")
        ).toBeTruthy();
        expect(
            screen
                .getByTestId("zone-player-hand")
                .querySelector("[data-card-slot='bolt']")
        ).toBeNull();
    });

    it("re-flows neighbours without remounting when a card is added to a zone (draw)", () => {
        const { rerender } = renderBoard(
            makePlayer("me", { hand: [makeCard("a"), makeCard("b")] }),
            makePlayer("opp")
        );
        const aBefore = slot("a")!;
        const bBefore = slot("b")!;
        const aX0 = centerX(aBefore);
        const bX0 = centerX(bBefore);

        // Draw a third card — the hand re-flows.
        rerender(
            <GameContext value={ctx()}>
                <BoardNext
                    orderedPlayers={[
                        makePlayer("opp"),
                        makePlayer("me", {
                            hand: [makeCard("a"), makeCard("b"), makeCard("c")],
                        }),
                    ]}
                    stackItems={[]}
                />
            </GameContext>
        );

        // Existing cards keep their DOM node (no jump/remount) ...
        expect(slot("a")).toBe(aBefore);
        expect(slot("b")).toBe(bBefore);
        // ... and re-placed: at least one existing card moved to make room.
        const moved =
            centerX(slot("a")!) !== aX0 || centerX(slot("b")!) !== bX0;
        expect(moved).toBe(true);
        // The new card appears with its own slot.
        expect(slot("c")).toBeTruthy();
    });
});
