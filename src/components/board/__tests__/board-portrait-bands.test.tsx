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

    it("scrolling past 6 cards does not grow the hand band — it scrolls instead", () => {
        // The ticket's case: a full (7+) hand must not grow the strip (which
        // would eat back into the battlefield); past the scroll threshold the
        // row scrolls horizontally at the SAME constant band height instead.
        //
        // This replaces a tautological assertion (#1770 follow-up from
        // #1790's review): it used to render at 0 and 7 cards and diff the
        // two `className` snapshots, but the slot's class is a hard-coded
        // module constant `Board` never derives from hand size — the two
        // renders could not have differed even if the fix were broken. Real
        // coverage is the `data-hand-scrolls` flag (asserted here against
        // the actual scrolling case) plus the pure arithmetic in
        // `portrait-board-bands.test.ts`; comparing the rendered class
        // against the NAMED constants below is a genuine assertion because
        // it draws on an independent source of truth, not a second render.
        renderBoard(7);
        expect(screen.getByTestId("zone-player-hand").dataset.handScrolls).toBe(
            "true"
        );
        expect(slotOf("zone-player-hand").className).toBe(
            PORTRAIT_VIEWER_HAND_BAND
        );
        expect(slotOf("battlefield-me").className).toBe(
            PORTRAIT_VIEWER_BATTLEFIELD_BAND
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

describe("the mid-board line is drawn without spending band budget (#2727)", () => {
    beforeEach(() => {
        cleanup();
        ho.portrait = true;
    });

    // ADR 0103 asks for a mid-board hairline; before #2727 the midline existed
    // ONLY as `--portrait-midline`, the arithmetic boundary the two battlefield
    // bands tile against, with nothing painting it. The wrong way to add it is
    // a flex/flow child between the bands: that steals height from the budget
    // this whole file exists to protect. This asserts the mount AND that it
    // stays out of flow — the band classes above are unchanged either way, so
    // only the node's own position property can tell the two apart.
    it("mounts inside the board root, absolutely positioned and un-hit-testable", () => {
        renderBoard();
        const line = boardRoot().querySelector<HTMLElement>(
            "[data-board-mid-line]"
        );
        expect(line).toBeTruthy();
        expect(line!.className).toContain("absolute");
        expect(line!.className).toContain("h-px");
        expect(line!.className).toContain("pointer-events-none");
        // It follows the SAME var the bands tile against, not a hand-picked
        // offset that could drift from the boundary it claims to draw.
        expect(line!.className).toContain(`var(${PORTRAIT_MIDLINE_VAR})`);
    });
});
