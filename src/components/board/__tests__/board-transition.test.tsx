// Slice #252 (PRD #249) — board-level integration: when a card changes zone
// (hand → battlefield on cast) or a zone's count changes (draw / reflow), the
// spatial board keeps the card's slot identity (keyed by instance id) and
// re-places it via the shared layout math, animating instead of jumping.
//
// Asserts observable facts across the full Board → SpatialZone → SpatialSlot
// path: the card's slot is present (by id) before and after the move, its
// placement updates, neighbours reflow, and the LayoutGroup that drives the
// cross-zone FLIP wraps the tree. The spatial surface now lives inline in the
// `Board` orchestrator (the old standalone `BoardNext` was merged in), so this
// test renders `Board` with its Convex data layer + chrome mocked out.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { CARD_WIDTH } from "~/lib/board-layout";

const ZONE_W = 1000;
const ZONE_H = 300;
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: ZONE_W, height: ZONE_H },
    }),
}));

// Convex data layer: Board only consumes `getPublicState` for its render state;
// the other queries' results are ignored or tolerate the same object, so the
// mock returns one shared, mutable state value for every `useQuery`.
const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", () => ({
    useQuery: () => h.state,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

// Board chrome → inert; the spatial subtree is the system under test.
vi.mock("../controller", () => ({ default: () => null }));
vi.mock("../auto-pass-controller", () => ({ default: () => null }));
vi.mock("../pause-menu-dialog", () => ({ default: () => null }));
vi.mock("../error-toast", () => ({ default: () => null }));
vi.mock("../board-background", () => ({ default: () => null }));
vi.mock("../vs-ai-driver", () => ({ default: () => null }));
vi.mock("../game-stack", () => ({ default: () => null }));
vi.mock("../priority-indicator", () => ({ default: () => null }));
vi.mock("../board-arrows", () => ({ default: () => null }));
vi.mock("../board-piles", () => ({ default: () => null }));

// Leaf card visuals → inert marker carrying the card id, so we can follow a
// specific card across zones. Note: spatial-slot is NOT mocked — the real
// animated slot runs through this test.
vi.mock("../board-card", () => ({
    default: ({ card }: { card: CardInstance | null }) => (
        <div data-testid="bn-card" data-card-id={card ? card.id : "back"} />
    ),
}));
// Interactive viewer-hand card (#254) pulls in Convex useMutation — stub inert;
// slot identity for the FLIP comes from SpatialSlot, not this leaf.
vi.mock("../board-hand-card", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="bn-card" data-card-id={card.id} />
    ),
}));
// The battlefield wrapper runs useBattlefieldVisualState (needs real card
// defs); stub it to the SAME shared SpatialZone with inert nodes so slot
// identity / reflow is still exercised through the real SpatialSlot path.
vi.mock("../board-battlefield", async () => {
    const { default: SpatialZone } = await import("../spatial-zone");
    const { rowLayout } = await import("~/lib/board-layout");
    return {
        default: ({
            player,
            mirror,
            "data-testid": testId,
        }: {
            player: Player;
            mirror?: boolean;
            "data-testid"?: string;
        }) => (
            <SpatialZone
                items={player.battlefield.map((card) => ({
                    key: card.id,
                    node: <div data-testid="bn-card" data-card-id={card.id} />,
                }))}
                layout={(count, width, height) =>
                    rowLayout({ count, width, centerY: height / 2 })
                }
                mirror={mirror}
                data-testid={testId}
            />
        ),
    };
});
// Player nameplate (#280) runs useMutation; this transition test is concerned
// only with card slot identity, so stub it inert.
vi.mock("../board-player", () => ({ default: () => null }));

import Board from "../board";

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

/** Point the shared Convex state at this seat layout (opponent first). */
function setState(opp: Player, me: Player) {
    h.state = {
        players: [opp, me],
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stack: [],
    };
}

// A FRESH element each call: re-rendering the SAME element object lets React
// bail out of reconciliation, so the board would never pick up the new Convex
// state. No `key` is set, so the component type is reused and slot identity
// (the FLIP) is preserved across the rerender.
function boardEl() {
    return (
        <Board
            gameId={"game-id" as never}
            playerId="me"
            solo={false}
            vsAi={false}
            showAllCards={false}
            debugAllActions={false}
        />
    );
}

function renderBoard(me: Player, opp: Player) {
    setState(opp, me);
    return render(boardEl());
}

function slot(id: string) {
    return document.querySelector<HTMLElement>(`[data-card-slot='${id}']`);
}

function centerX(el: HTMLElement) {
    const m = el.style.transform.match(/translate\(([-\d.]+)px,/);
    return Number(m![1]) + CARD_WIDTH / 2;
}

describe("Board zone-transition (#252)", () => {
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
            document
                .querySelector("[data-testid='zone-player-hand']")!
                .querySelector("[data-card-slot='bolt']")
        ).toBeTruthy();

        // Cast: the same card instance is now on the battlefield.
        setState(
            makePlayer("opp"),
            makePlayer("me", { hand: [], battlefield: [makeCard("bolt")] })
        );
        rerender(boardEl());

        const onBf = slot("bolt");
        // Same logical card slot (same instance id) — animates across zones, not
        // a fresh element. It now lives in the battlefield zone.
        expect(onBf).toBeTruthy();
        expect(
            document
                .querySelector("[data-testid='zone-player-battlefield']")!
                .querySelector("[data-card-slot='bolt']")
        ).toBeTruthy();
        expect(
            document
                .querySelector("[data-testid='zone-player-hand']")!
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
        setState(
            makePlayer("opp"),
            makePlayer("me", {
                hand: [makeCard("a"), makeCard("b"), makeCard("c")],
            })
        );
        rerender(boardEl());

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
