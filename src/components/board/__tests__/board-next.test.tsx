// Seam 2 (PRD #249, issue #251): every card in every BoardNext zone is placed
// from the shared pure layout math (`src/lib/board-layout.ts`), not static CSS.
// This render test asserts the wiring: each card instance gets a positioned
// slot, and the slot's transform matches the layout function's output for the
// measured container size — so the layout module is provably the single source
// of truth for card positions.
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    rowLayout,
    fanLayout,
    mirrorVertical,
    CARD_WIDTH,
    CARD_HEIGHT,
} from "~/lib/board-layout";

// Fixed container size so placements are deterministic (jsdom has no real
// layout). useElementSize is the only DOM-measuring seam; stub it.
const ZONE_W = 1000;
const ZONE_H = 300;
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: ZONE_W, height: ZONE_H },
    }),
}));

// Leaf card visuals + board chrome → inert markers (no Convex/router/refs).
vi.mock("../board-next-card", () => ({
    default: ({ card }: { card: CardInstance | null }) => (
        <div data-testid="bn-card" data-card-id={card ? card.id : "back"} />
    ),
}));
// The viewer's own hand renders the interactive card (#254), which pulls in
// Convex's useMutation. This is a layout-placement test, so stub it inert.
vi.mock("../board-next-hand-card", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="bn-hand-card" data-card-id={card.id} />
    ),
}));
vi.mock("../game-stack", () => ({ default: () => null }));
vi.mock("../phase-tracker", () => ({ default: () => null }));
vi.mock("../priority-indicator", () => ({ default: () => null }));
vi.mock("../target-arrows-overlay", () => ({ default: () => null }));

import BoardNext from "../board-next";

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: id.startsWith("opp") ? "opp" : "me",
        ownerId: id.startsWith("opp") ? "opp" : "me",
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

function renderBoard(opponent: Player, me: Player) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [opponent, me],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <BoardNext orderedPlayers={[opponent, me]} stackItems={[]} />
        </GameContext>
    );
}

/** Reads the translate(x,y) from a slot's transform and recovers the card
 *  center (the slot offsets by half the card footprint). */
function centerFromSlot(el: HTMLElement) {
    const t = el.style.transform;
    const m = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    expect(m).toBeTruthy();
    const x = Number(m![1]) + CARD_WIDTH / 2;
    const y = Number(m![2]) + CARD_HEIGHT / 2;
    return { x, y };
}

function rotationFromSlot(el: HTMLElement) {
    const m = el.style.transform.match(/rotate\(([-\d.]+)deg\)/);
    expect(m).toBeTruthy();
    return Number(m![1]);
}

describe("BoardNext spatial placement (seam 2, #251)", () => {
    it("places each battlefield card from rowLayout output", () => {
        cleanup();
        const me = makePlayer("me", {
            battlefield: [makeCard("a"), makeCard("b"), makeCard("c")],
        });
        const opp = makePlayer("opp");
        renderBoard(opp, me);

        const zone = screen.getByTestId("zone-player-battlefield");
        const slots = Array.from(
            zone.querySelectorAll<HTMLElement>("[data-card-slot]")
        );
        expect(slots).toHaveLength(3);

        const expected = rowLayout({
            count: 3,
            width: ZONE_W,
            centerY: ZONE_H / 2,
        });
        slots.forEach((slot, i) => {
            const { x, y } = centerFromSlot(slot);
            expect(x).toBeCloseTo(expected[i].x, 2);
            expect(y).toBeCloseTo(expected[i].y, 2);
            expect(rotationFromSlot(slot)).toBeCloseTo(expected[i].rotation, 2);
        });
    });

    it("places each hand card from fanLayout output (fanned rotation)", () => {
        cleanup();
        const me = makePlayer("me", {
            hand: [makeCard("h0"), makeCard("h1"), makeCard("h2")],
        });
        const opp = makePlayer("opp");
        renderBoard(opp, me);

        const zone = screen.getByTestId("zone-player-hand");
        const slots = Array.from(
            zone.querySelectorAll<HTMLElement>("[data-card-slot]")
        );
        expect(slots).toHaveLength(3);

        const expected = fanLayout({
            count: 3,
            width: ZONE_W,
            baseY: ZONE_H * 0.6,
        });
        slots.forEach((slot, i) => {
            expect(rotationFromSlot(slot)).toBeCloseTo(expected[i].rotation, 2);
        });
        // Fan is symmetric: edge cards rotate opposite directions.
        expect(rotationFromSlot(slots[0])).toBeCloseTo(
            -rotationFromSlot(slots[2]),
            2
        );
    });

    it("mirrors the opponent's battlefield with the same math", () => {
        cleanup();
        const opp = makePlayer("opp", {
            battlefield: [makeCard("opp-a"), makeCard("opp-b")],
        });
        const me = makePlayer("me");
        renderBoard(opp, me);

        const zone = screen.getByTestId("zone-opponent-battlefield");
        const slots = Array.from(
            zone.querySelectorAll<HTMLElement>("[data-card-slot]")
        );
        expect(slots).toHaveLength(2);

        const base = rowLayout({
            count: 2,
            width: ZONE_W,
            centerY: ZONE_H / 2,
        });
        slots.forEach((slot, i) => {
            const expected = mirrorVertical(base[i], ZONE_H);
            const { x, y } = centerFromSlot(slot);
            expect(x).toBeCloseTo(expected.x, 2);
            expect(y).toBeCloseTo(expected.y, 2);
        });
    });

    it("renders a back slot for each hidden opponent hand card", () => {
        cleanup();
        const opp = makePlayer("opp", { hand: [null, null, null] });
        const me = makePlayer("me");
        renderBoard(opp, me);

        const zone = screen.getByTestId("zone-opponent-hand");
        const slots = zone.querySelectorAll("[data-card-slot]");
        expect(slots).toHaveLength(3);
    });
});
