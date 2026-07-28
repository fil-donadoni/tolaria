// The landscape-compact BOARD layout (#1768), driven through the REAL Board at
// the ticket's representative compact viewport (844×390).
//
// Until #1763 there was no landscape mode at all, so a phone held sideways fell
// through to the DESKTOP board: `top-[18%] h-[32%]` battlefield bands capping
// permanents at ~49×35px, next to a hand still fanning full-size 120×168 cards,
// with the nameplates parked on the hand strips and the pile row under the
// control strip. jsdom has no layout engine, so this drives the CONTRACT —
// which band class each slot gets, that the hand and the battlefield are handed
// the IDENTICAL card footprint, that the pile rail clears the strip and keeps
// one tile box for empty and populated zones, and that desktop/portrait come
// out byte-identical. The pure arithmetic of the budget lives in
// `src/lib/__tests__/landscape-board-bands.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { BESIDE_CONTROLLER_STRIP } from "~/lib/controller-bar-metrics";
import { PILE_TILE_BOX } from "~/lib/card-layout";
import {
    PORTRAIT_OPPONENT_BATTLEFIELD_BAND,
    PORTRAIT_OPPONENT_HAND_BAND,
    PORTRAIT_VIEWER_BATTLEFIELD_BAND,
    PORTRAIT_VIEWER_HAND_BAND,
} from "~/lib/portrait-board-bands";
import {
    LANDSCAPE_CARD_H_VAR,
    LANDSCAPE_CARD_W_VAR,
    LANDSCAPE_HAND_BAND_VAR,
    LANDSCAPE_MIDLINE_VAR,
    LANDSCAPE_OPPONENT_BATTLEFIELD_BAND,
    LANDSCAPE_OPPONENT_HAND_BAND,
    LANDSCAPE_OPPONENT_SEAT_ANCHOR,
    LANDSCAPE_OPP_BF_BOTTOM_VAR,
    LANDSCAPE_OPP_HAND_BAND_VAR,
    LANDSCAPE_PILE_TILE_VAR,
    LANDSCAPE_RIGHT_RAIL_VAR,
    LANDSCAPE_SIDE_GUTTER_VAR,
    LANDSCAPE_VIEWER_BATTLEFIELD_BAND,
    LANDSCAPE_VIEWER_HAND_BAND,
    LANDSCAPE_VIEWER_SEAT_ANCHOR,
    landscapeCardMetrics,
} from "~/lib/landscape-board-bands";

/** The ONE seam: every board zone reads the mode through this hook. Mocking it
 *  (rather than `useIsPortrait`) also proves the portrait projection still
 *  derives from it — `useIsPortrait` is left real. */
const ho = vi.hoisted(() => ({ mode: "landscape-compact" as ViewportMode }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => ho.mode,
}));

vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 700, height: 70 },
    }),
}));

const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", () => ({
    useQuery: () => h.state,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

// The hand and the battlefield are stubbed to REPORT the footprint they were
// handed — that shared number is the substance of this ticket, and asserting it
// on the props is exact where a jsdom pixel measurement would be zero.
vi.mock("../board-hand", () => ({
    default: (p: {
        cardWidth?: number;
        cardHeight?: number;
        "data-testid"?: string;
    }) => (
        <div
            data-testid={p["data-testid"]}
            data-card-w={p.cardWidth}
            data-card-h={p.cardHeight}
        />
    ),
}));
vi.mock("../board-battlefield", () => ({
    default: (p: {
        compact?: { cardWidth: number; cardHeight: number; bandPad: number };
        "data-testid"?: string;
    }) => (
        <div
            data-testid={p["data-testid"]}
            data-card-w={p.compact?.cardWidth}
            data-card-h={p.compact?.cardHeight}
            data-band-pad={p.compact?.bandPad}
        />
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
vi.mock("../board-hand-portrait", () => ({
    default: (p: { "data-testid"?: string }) => (
        <div data-testid={p["data-testid"]} />
    ),
}));
vi.mock("../board-portrait-chips", () => ({ default: () => null }));

import Board from "../board";

const PHONE = { width: 844, height: 390 };

function makePlayer(id: string, handSize = 0, graveyard = 0): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: Array.from({ length: handSize }, () => null),
        library: { count: 0 },
        graveyard: Array.from({ length: graveyard }, (_, i) => ({
            id: `gy-${id}-${i}`,
            card: { id: "lea-mountain" },
            ownerId: id,
            controllerId: id,
        })) as Player["graveyard"],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function renderBoard(handSize = 0, graveyard = 0) {
    h.state = {
        players: [
            makePlayer("opp", handSize, graveyard),
            makePlayer("me", handSize, graveyard),
        ],
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

const originalHeight = window.innerHeight;
const originalWidth = window.innerWidth;

beforeEach(() => {
    cleanup();
    ho.mode = "landscape-compact";
    window.innerWidth = PHONE.width;
    window.innerHeight = PHONE.height;
});

afterEach(() => {
    window.innerWidth = originalWidth;
    window.innerHeight = originalHeight;
});

describe("landscape-compact board bands (#1768)", () => {
    it("mounts the landscape bands instead of the desktop ones", () => {
        renderBoard(7);
        expect(slotOf("zone-opponent-hand").className).toBe(
            LANDSCAPE_OPPONENT_HAND_BAND
        );
        expect(slotOf("zone-opponent-battlefield").className).toBe(
            LANDSCAPE_OPPONENT_BATTLEFIELD_BAND
        );
        expect(slotOf("zone-player-battlefield").className).toBe(
            LANDSCAPE_VIEWER_BATTLEFIELD_BAND
        );
        expect(slotOf("zone-player-hand").className).toBe(
            LANDSCAPE_VIEWER_HAND_BAND
        );
        // THE regression: the desktop geometry a landscape phone used to get.
        const bf = slotOf("zone-player-battlefield").className;
        expect(bf).not.toContain("top-1/2");
        expect(bf).not.toContain("h-[32%]");
    });

    it("publishes the landscape band budget on the board root", () => {
        renderBoard();
        const root = boardRoot();
        expect(root.style.getPropertyValue(LANDSCAPE_OPP_HAND_BAND_VAR)).toBe(
            "10%"
        );
        expect(root.style.getPropertyValue(LANDSCAPE_HAND_BAND_VAR)).toBe(
            "18%"
        );
        expect(root.style.getPropertyValue(LANDSCAPE_MIDLINE_VAR)).toBe("46%");
        expect(root.style.getPropertyValue(LANDSCAPE_OPP_BF_BOTTOM_VAR)).toBe(
            "54%"
        );
        expect(root.style.getPropertyValue(LANDSCAPE_SIDE_GUTTER_VAR)).toBe(
            "8rem"
        );
        // The right rail is derived from the strip's MEASURED width (#1769).
        expect(root.style.getPropertyValue(LANDSCAPE_RIGHT_RAIL_VAR)).toContain(
            "var(--controller-strip-w"
        );
    });

    it("hands the hand and the battlefield ONE shared card footprint", () => {
        renderBoard(7);
        const expected = landscapeCardMetrics(PHONE.height);
        const hand = screen.getByTestId("zone-player-hand");
        const battlefield = screen.getByTestId("zone-player-battlefield");

        expect(hand.dataset.cardW).toBe(String(expected.cardWidth));
        expect(hand.dataset.cardH).toBe(String(expected.cardHeight));
        // The whole ticket in one assertion: hand card size === board card size.
        expect(battlefield.dataset.cardW).toBe(hand.dataset.cardW);
        expect(battlefield.dataset.cardH).toBe(hand.dataset.cardH);
        expect(battlefield.dataset.bandPad).toBe(String(expected.bandPad));

        // …and the SAME number is the published scale var, so pile tiles and
        // any other chrome read one source rather than a second copy.
        const root = boardRoot();
        expect(root.style.getPropertyValue(LANDSCAPE_CARD_W_VAR)).toBe(
            `${expected.cardWidth}px`
        );
        expect(root.style.getPropertyValue(LANDSCAPE_CARD_H_VAR)).toBe(
            `${expected.cardHeight}px`
        );
    });

    it("gives the opponent's hand backs the same footprint, not the 70% desktop one", () => {
        renderBoard(7);
        const expected = landscapeCardMetrics(PHONE.height);
        const oppHand = screen.getByTestId("zone-opponent-hand");
        expect(oppHand.dataset.cardW).toBe(String(expected.cardWidth));
        expect(oppHand.dataset.cardH).toBe(String(expected.cardHeight));
    });

    it("keeps the geometry constant as the hand fills up", () => {
        renderBoard(0);
        const empty = {
            bf: slotOf("zone-player-battlefield").className,
            hand: slotOf("zone-player-hand").className,
            w: screen.getByTestId("zone-player-hand").dataset.cardW,
        };
        cleanup();
        renderBoard(7);
        expect(slotOf("zone-player-battlefield").className).toBe(empty.bf);
        expect(slotOf("zone-player-hand").className).toBe(empty.hand);
        expect(screen.getByTestId("zone-player-hand").dataset.cardW).toBe(
            empty.w
        );
    });

    it("re-derives the shared footprint on a shorter viewport", () => {
        window.innerHeight = 320;
        renderBoard(7);
        const expected = landscapeCardMetrics(320);
        expect(screen.getByTestId("zone-player-hand").dataset.cardW).toBe(
            String(expected.cardWidth)
        );
        expect(
            screen.getByTestId("zone-player-battlefield").dataset.cardW
        ).toBe(String(expected.cardWidth));
    });
});

describe("landscape-compact seat chrome + pile rail (#1768)", () => {
    it("moves both nameplates into the left rail, off the cards", () => {
        renderBoard(7);
        const seats = document.querySelectorAll("[data-arrow-anchor-player]");
        expect(seats).toHaveLength(2);
        const anchors = Array.from(seats).map(
            (n) =>
                (n.closest("[class*='landscape-midline']") as HTMLElement)
                    ?.className
        );
        expect(anchors).toContain(
            `absolute z-10 ${LANDSCAPE_OPPONENT_SEAT_ANCHOR}`
        );
        expect(anchors).toContain(
            `absolute z-10 ${LANDSCAPE_VIEWER_SEAT_ANCHOR}`
        );
        // Never on the board's own centre line, where the hand strips are.
        for (const a of anchors) expect(a).not.toContain("play-area-center-x");
    });

    it("docks the piles beside the control strip as a compact column", () => {
        renderBoard();
        for (const id of ["piles-opponent", "piles-player"]) {
            const rail = screen.getByTestId(id);
            expect(rail.className).toContain(BESIDE_CONTROLLER_STRIP);
            expect(rail.className).toContain("flex-col");
            expect(rail.className).not.toContain("right-3");
            // A column is unbounded by default, and the tile count is not fixed
            // at three (companion / emblems / monarch / city's blessing are
            // conditional): capped at the seat's own half of the board, extra
            // tiles scroll INSIDE the column instead of crossing the midline
            // onto the other seat's tiles.
            expect(rail.className).toContain(
                `max-h-[calc(${
                    id === "piles-opponent" ? "" : "100%-"
                }var(${LANDSCAPE_MIDLINE_VAR})-1rem)]`
            );
            expect(rail.className).toContain("overflow-y-auto");
            // Tiles shrink together off the shared scale.
            expect(rail.style.getPropertyValue("--card-w-sm")).toBe(
                `var(${LANDSCAPE_PILE_TILE_VAR})`
            );
        }
    });

    it("gives the empty-zone placeholder the SAME box as a populated tile", () => {
        // The audit's ratio mismatch: the placeholder is an in-flow box while
        // the stacked cards are absolute, so its trailing margin was live
        // geometry the cards' identical margin never had. Both spell the box
        // once now, via PILE_TILE_BOX.
        renderBoard(0, 2);
        const emptyExile = screen.getAllByLabelText("Exile")[0]
            .parentElement as HTMLElement;
        expect(emptyExile.className).toContain(PILE_TILE_BOX);
        expect(emptyExile.className).not.toMatch(/\bmb-\d/);

        const populated = document.querySelector(
            "[data-flight-id]"
        ) as HTMLElement;
        expect(populated).not.toBeNull();
        expect(populated.className).toContain(PILE_TILE_BOX);
        expect(populated.className).not.toMatch(/\bmb-\d/);
    });
});

describe("desktop and portrait are untouched by #1768", () => {
    it("keeps the desktop bands byte-identical", () => {
        ho.mode = "desktop";
        renderBoard(7);
        expect(slotOf("zone-opponent-hand").className).toBe(
            "absolute left-0 right-[var(--right-piles-w)] top-0 h-[18%]"
        );
        expect(slotOf("zone-opponent-battlefield").className).toBe(
            "absolute left-0 right-0 top-[18%] h-[32%]"
        );
        expect(slotOf("zone-player-battlefield").className).toBe(
            "absolute left-0 right-0 top-1/2 h-[32%]"
        );
        expect(slotOf("zone-player-hand").className).toBe(
            "absolute left-0 right-[var(--right-piles-w)] bottom-0 h-[18%]"
        );
        // No landscape footprint is forced on the desktop zones.
        expect(
            screen.getByTestId("zone-player-hand").dataset.cardW
        ).toBeUndefined();
        expect(
            screen.getByTestId("zone-player-battlefield").dataset.cardW
        ).toBeUndefined();
        expect(screen.getByTestId("piles-player").className).toBe(
            "absolute right-3 bottom-3 z-30 flex flex-row-reverse items-start gap-2"
        );
    });

    it("keeps the portrait bands byte-identical", () => {
        ho.mode = "portrait";
        renderBoard(7);
        expect(slotOf("zone-opponent-hand").className).toBe(
            PORTRAIT_OPPONENT_HAND_BAND
        );
        expect(slotOf("zone-opponent-battlefield").className).toBe(
            PORTRAIT_OPPONENT_BATTLEFIELD_BAND
        );
        expect(slotOf("zone-player-battlefield").className).toBe(
            PORTRAIT_VIEWER_BATTLEFIELD_BAND
        );
        expect(slotOf("zone-player-hand").className).toBe(
            PORTRAIT_VIEWER_HAND_BAND
        );
    });
});
