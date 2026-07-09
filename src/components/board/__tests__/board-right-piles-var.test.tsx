// In-game dialogs center on the play area, not the full viewport (excluding
// the right pile-column strip). The board publishes `--right-piles-w` to
// `document.documentElement` while mounted so portal'd dialogs (rendered to
// document.body, outside `data-board-root`) can read it and offset their
// centering by half the strip. On unmount (e.g. back to the lobby) the var is
// removed so the dialog's `var(..., 0px)` fallback restores full-viewport
// centering. In portrait the piles collapse, so the strip is `0px`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";

// Orientation is the only signal that flips the strip width; default landscape.
const ho = vi.hoisted(() => ({ portrait: false }));
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => ho.portrait,
}));

vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 1000, height: 300 },
    }),
}));

const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", () => ({
    useQuery: () => h.state,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

// Board chrome → inert; only the root effect is under test.
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
vi.mock("../board-hand-portrait", () => ({ default: () => null }));
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

function setState() {
    h.state = {
        players: [makePlayer("opp"), makePlayer("me")],
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stack: [],
    };
}

function boardEl() {
    return (
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

const VAR = "--right-piles-w";

describe("Board publishes --right-piles-w to documentElement (in-game dialog centering)", () => {
    beforeEach(() => {
        cleanup();
        ho.portrait = false;
        document.documentElement.style.removeProperty(VAR);
    });

    it("sets the strip width on documentElement while mounted (landscape)", () => {
        setState();
        render(boardEl());
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe(
            "calc(1.75rem + 3 * var(--card-w-sm))"
        );
    });

    it("publishes 0px in portrait (piles collapse to bottom chips)", () => {
        ho.portrait = true;
        setState();
        render(boardEl());
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe(
            "0px"
        );
    });

    it("removes the var on unmount so the lobby falls back to full-viewport centering", () => {
        setState();
        const { unmount } = render(boardEl());
        expect(document.documentElement.style.getPropertyValue(VAR)).not.toBe(
            ""
        );
        unmount();
        expect(document.documentElement.style.getPropertyValue(VAR)).toBe("");
    });
});
