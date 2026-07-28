// The portrait hand strip must sit above the variant-D bottom bar (#1759) by
// the bar's MEASURED height, not a hard-coded inset. The bar's command row
// wraps, so its height is state-dependent (~106px on one line, ~150px in the
// two-line DECLARE_ATTACKERS state); the old fixed `bottom-32` (128px) put the
// grown bar back on top of the hand's bottom edge, where it swallowed taps.
//
// The bar publishes `--controller-bar-h` (see useControllerBarHeight); this
// test drives the assertion through the REAL board, so a future edit that
// re-hard-codes the inset fails here rather than on a phone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";

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

// Board chrome → inert; only the hand slot's anchoring is under test. The hand
// itself is stubbed per player so the slot it lives in can be identified.
vi.mock("../board-hand-portrait", () => ({
    default: ({ player }: { player: Player }) => (
        <div data-testid={`portrait-hand-${player.id}`} />
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
vi.mock("../board-battlefield", () => ({ default: () => null }));
vi.mock("../board-hand", () => ({ default: () => null }));
vi.mock("../board-portrait-chips", () => ({ default: () => null }));
vi.mock("../board-player", () => ({ default: () => null }));

import Board from "../board";

function makePlayer(id: string): Player {
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
    };
}

function renderBoard() {
    h.state = {
        players: [makePlayer("opp"), makePlayer("me")],
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

describe("Portrait hand strip clears the bottom bar by its measured height (#1759)", () => {
    beforeEach(() => {
        cleanup();
        ho.portrait = true;
    });

    it("anchors the viewer's hand slot to --controller-bar-h, not a fixed inset", () => {
        renderBoard();
        const slot = screen.getByTestId("portrait-hand-me")
            .parentElement as HTMLElement;
        expect(slot.className).toContain(ABOVE_CONTROLLER_BAR);
        // The regression: a constant reservation the grown bar overruns.
        expect(slot.className).not.toContain("bottom-32");
    });

    it("leaves the landscape hand on the bottom edge (no bar to clear)", () => {
        ho.portrait = false;
        renderBoard();
        // Landscape mounts BoardHand, not the portrait strip — and its slot
        // must not inherit the portrait anchoring.
        expect(screen.queryByTestId("portrait-hand-me")).toBeNull();
    });
});
