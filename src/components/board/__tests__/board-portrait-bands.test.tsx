// The portrait board's four vertical bands must TILE (#1760). Before this, the
// viewer battlefield was a fixed `top-1/2 h-[32%]` slice while the hand strip
// floated bottom-anchored above the bar — nothing tied them together, so on a
// phone the battlefield ran ~140px past the top of the hand and its back row
// (lands + other noncreatures) rendered UNDER the hand. With a full hand the
// strip is opaque edge to edge and those lands could not be tapped for mana.
//
// jsdom has no layout engine, so this drives the CONTRACT through the REAL
// Board: which band class each slot gets, and that the published band budget
// reserves the hand strip. The pure arithmetic of the budget (no overlap, equal
// battlefields, a usable row height) is checked in
// `src/lib/__tests__/portrait-board-bands.test.ts`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";
import {
    PORTRAIT_HAND_BAND_H,
    PORTRAIT_HAND_BAND_VAR,
    PORTRAIT_MIDLINE_VAR,
    PORTRAIT_OPPONENT_BATTLEFIELD_BAND,
    PORTRAIT_OPPONENT_BF_BOTTOM_VAR,
    PORTRAIT_OPPONENT_HAND_BAND,
    PORTRAIT_VIEWER_BATTLEFIELD_BAND,
    PORTRAIT_VIEWER_BF_BOTTOM_VAR,
    PORTRAIT_VIEWER_HAND_BAND,
} from "~/lib/portrait-board-bands";

const ho = vi.hoisted(() => ({ portrait: true }));
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => ho.portrait,
}));

vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 400, height: 800 },
    }),
}));

const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", () => ({
    useQuery: () => h.state,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

// The REAL portrait hand strip stays mounted (its scroll behaviour is part of
// the geometry under test); the battlefield is stubbed down to a marker so the
// band slot wrapping it can be identified. Everything else is inert chrome.
vi.mock("../board-battlefield", () => ({
    default: ({ player }: { player: Player }) => (
        <div data-testid={`battlefield-${player.id}`} />
    ),
}));
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
vi.mock("../board-card", () => ({ default: () => null }));
vi.mock("../board-hand-card", () => ({ default: () => null }));
vi.mock("../board-hand", () => ({ default: () => null }));
vi.mock("../board-portrait-chips", () => ({ default: () => null }));
vi.mock("../board-player", () => ({ default: () => null }));

import Board from "../board";

function makePlayer(id: string, handSize = 0): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        // Face-down entries: the strip's geometry is hand-SIZE dependent, not
        // card dependent, and backs need no card fixture.
        hand: Array.from({ length: handSize }, () => null),
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function renderBoard(handSize = 0) {
    h.state = {
        players: [makePlayer("opp", handSize), makePlayer("me", handSize)],
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stack: [],
    };
    return render(
        <Board
            gameId={"game-id" as never}
            playerId="me"
            solo={false}
            vsAi={false}
            showAllCards={false}
            debugAllActions={false}
            onSwitchGame={() => {}}
        />
    );
}

const slotOf = (testId: string) =>
    screen.getByTestId(testId).parentElement as HTMLElement;

const boardRoot = () =>
    document.querySelector("[data-board-root]") as HTMLElement;

describe("portrait bands never run under the hand strip (#1760)", () => {
    beforeEach(() => {
        cleanup();
        ho.portrait = true;
    });

    it("bottom-anchors the viewer battlefield to the reserved hand band", () => {
        renderBoard();
        const bf = slotOf("battlefield-me");
        expect(bf.className).toBe(PORTRAIT_VIEWER_BATTLEFIELD_BAND);
        // THE regression: a fixed-height slice that ignores the hand strip.
        expect(bf.className).not.toContain("h-[32%]");
        expect(bf.className).not.toContain("top-1/2");
    });

    it("publishes a band budget that reserves the hand and the measured bar", () => {
        renderBoard();
        const root = boardRoot();
        expect(root.style.getPropertyValue(PORTRAIT_HAND_BAND_VAR)).toBe(
            PORTRAIT_HAND_BAND_H
        );
        const inset = root.style.getPropertyValue(
            PORTRAIT_VIEWER_BF_BOTTOM_VAR
        );
        expect(inset).toContain("var(--controller-bar-h");
        expect(inset).toContain(`var(${PORTRAIT_HAND_BAND_VAR})`);
        // The midline shifts up by half the clearance so both battlefields are
        // equal; the opponent's bottom inset is its mirror.
        expect(root.style.getPropertyValue(PORTRAIT_MIDLINE_VAR)).toContain(
            "50% -"
        );
        expect(
            root.style.getPropertyValue(PORTRAIT_OPPONENT_BF_BOTTOM_VAR)
        ).toContain("50% +");
    });

    it("keeps the hand slot on the #1759 measured-bar anchor", () => {
        renderBoard();
        const hand = slotOf("zone-player-hand");
        expect(hand.className).toBe(PORTRAIT_VIEWER_HAND_BAND);
        expect(hand.className).toContain(ABOVE_CONTROLLER_BAR);
        expect(hand.className).not.toContain("bottom-32");
        // The hand's height IS the band the battlefield above reserves — one
        // constant, so the two cannot drift apart.
        expect(hand.className).toContain(`h-[var(${PORTRAIT_HAND_BAND_VAR})]`);
    });

    it("gives the opponent the same tiled bands", () => {
        renderBoard();
        expect(slotOf("zone-opponent-hand").className).toBe(
            PORTRAIT_OPPONENT_HAND_BAND
        );
        expect(slotOf("battlefield-opp").className).toBe(
            PORTRAIT_OPPONENT_BATTLEFIELD_BAND
        );
    });

    it("does not change the geometry for a 7-card hand — it scrolls instead", () => {
        // The ticket's case. A full hand must not grow the strip (which would
        // eat back into the battlefield); past the scroll threshold the row
        // scrolls horizontally at a constant height.
        renderBoard(0);
        const emptyBf = slotOf("battlefield-me").className;
        const emptyHand = slotOf("zone-player-hand").className;
        cleanup();

        renderBoard(7);
        expect(slotOf("battlefield-me").className).toBe(emptyBf);
        expect(slotOf("zone-player-hand").className).toBe(emptyHand);
        expect(screen.getByTestId("zone-player-hand").dataset.handScrolls).toBe(
            "true"
        );
    });

    it("leaves landscape/desktop bands untouched", () => {
        ho.portrait = false;
        renderBoard(7);
        const bf = slotOf("battlefield-me");
        expect(bf.className).toContain("top-1/2");
        expect(bf.className).toContain("h-[32%]");
        expect(bf.className).not.toContain("var(--portrait-midline)");
    });
});
