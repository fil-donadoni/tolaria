// Portrait hand (#336): a flat overlap that scrolls horizontally once it holds
// MORE THAN six cards; at or below six it lays out without a scroll. These tests
// assert the threshold as external behavior — the scroll state the component
// exposes — plus that every card renders and the interactive vs. presentational
// split is honoured.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import {
    PORTRAIT_HAND_SCROLL_THRESHOLD,
    portraitHandScrolls,
} from "~/lib/board-layout";
import BoardHandPortrait from "../board-hand-portrait";

// The hand cards pull in the full drag-to-cast / tilt / preview stack; stub them
// to plain markers so the test isolates the LAYOUT contract (scroll threshold,
// card count, interactive split).
vi.mock("../board-hand-card", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="hand-card-interactive" data-card-id={card.id} />
    ),
}));
vi.mock("../board-card", () => ({
    default: ({ card }: { card: CardInstance | null }) => (
        <div
            data-testid="hand-card-presentational"
            data-card-id={card?.id ?? "hidden"}
        />
    ),
}));

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
    };
}

function makePlayer(handSize: number): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: Array.from({ length: handSize }, (_, i) => makeCard(`h${i}`)),
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

beforeEach(() => cleanup());

describe("portraitHandScrolls (#336 threshold)", () => {
    it("does not scroll at or below the threshold", () => {
        for (let n = 0; n <= PORTRAIT_HAND_SCROLL_THRESHOLD; n++) {
            expect(portraitHandScrolls(n)).toBe(false);
        }
    });

    it("scrolls strictly above the threshold", () => {
        expect(portraitHandScrolls(PORTRAIT_HAND_SCROLL_THRESHOLD + 1)).toBe(
            true
        );
        expect(portraitHandScrolls(12)).toBe(true);
    });
});

describe("BoardHandPortrait (#336)", () => {
    it("lays out WITHOUT a horizontal scroll at exactly 6 cards", () => {
        render(
            <BoardHandPortrait
                player={makePlayer(6)}
                interactive
                data-testid="hand"
            />
        );
        const hand = screen.getByTestId("hand");
        expect(hand.getAttribute("data-hand-scrolls")).toBe("false");
        expect(hand.className).toContain("overflow-x-hidden");
        expect(hand.className).not.toContain("overflow-x-auto");
        expect(screen.getAllByTestId("hand-card-interactive")).toHaveLength(6);
    });

    it("scrolls HORIZONTALLY at 7 cards (more than 6)", () => {
        render(
            <BoardHandPortrait
                player={makePlayer(7)}
                interactive
                data-testid="hand"
            />
        );
        const hand = screen.getByTestId("hand");
        expect(hand.getAttribute("data-hand-scrolls")).toBe("true");
        expect(hand.className).toContain("overflow-x-auto");
        expect(hand.className).not.toContain("overflow-x-hidden");
        expect(screen.getAllByTestId("hand-card-interactive")).toHaveLength(7);
    });

    it("renders the opponent hand as presentational cards (not interactive)", () => {
        render(
            <BoardHandPortrait
                player={makePlayer(3)}
                interactive={false}
                data-testid="hand"
            />
        );
        expect(screen.getAllByTestId("hand-card-presentational")).toHaveLength(
            3
        );
        expect(screen.queryByTestId("hand-card-interactive")).toBeNull();
    });
});
