// The GRE half of `BoardSurface`'s two presentational opt-outs (issue #2169).
//
// `showPriorityIndicator` and `handInteractive` were added so the Manual Board
// can switch off two GRE-only affordances. The GRE board keeps them by
// OMISSION — `board.tsx` passes neither prop — so the entire GRE side of both
// seams rests on two destructuring defaults in `board-surface.tsx`
// (`showPriorityIndicator = true`, `handInteractive = true`).
//
// Nothing detected them: the review flipped both to `false` and the whole `src`
// suite stayed green, 0 failed. `manual-board-view.test.tsx` asserts only the
// NEGATIVE half (the manual board must not mount them), which passes just as
// well when the affordance is gone from both boards. These are the positive
// halves, and they are what makes that negative mean something.
//
// Both drive the REAL `Board` — the GRE mount that omits the props — with the
// real `BoardSurface`, `PriorityIndicator`, `BoardHand` and `BoardHandCard`
// underneath. Only Convex, the viewport hooks and the chrome that is irrelevant
// here are stubbed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";

vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => false }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop",
}));
vi.mock("~/hooks/useViewportHeight", () => ({
    useViewportHeight: () => 900,
}));
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 1200, height: 300 },
    }),
}));

const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", () => ({
    useQuery: () => h.state,
    useMutation: () => async () => {},
    useAction: () => async () => {},
}));
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => ({ id, name: id }),
    tryGetDefinition: (id: string) => ({ id, name: id }),
    FACE_DOWN_CARD_ID: "__faceDownDef",
}));

// Chrome with no bearing on either seam.
vi.mock("../controller", () => ({ default: () => null }));
vi.mock("../auto-pass-controller", () => ({ default: () => null }));
vi.mock("../pause-menu-dialog", () => ({ default: () => null }));
vi.mock("../error-toast", () => ({ default: () => null }));
vi.mock("../board-background", () => ({ default: () => null }));
vi.mock("../vs-ai-driver", () => ({ default: () => null }));
vi.mock("../board-arrows", () => ({ default: () => null }));
vi.mock("../board-piles", () => ({ default: () => null }));
vi.mock("../board-battlefield", () => ({ default: () => null }));
vi.mock("../../cards/card-image", () => ({ default: () => <div /> }));

import Board from "../board";

function card(id: string, ownerId: string): CardInstance {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: ownerId,
        ownerId,
        zone: "hand",
        isTapped: false,
        legalActions: ["cast"],
    } as CardInstance;
}

function makePlayer(id: string, hand: (CardInstance | null)[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand,
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as unknown as Player;
}

function renderGreBoard() {
    h.state = {
        // BOTH hands hold a real card. The opponent's is deliberately not the
        // `null` back the default projection sends: `board-hand.tsx:224`
        // branches on `interactive && card`, so a `null` slot renders the
        // presentational `BoardCard` whatever `interactive` says — the seat
        // gate below would then be untestable (a green assertion that cannot
        // fail). Under `showAllCards` / debug the opponent's hand DOES project
        // real cards, which is the shape that makes the gate observable.
        players: [
            makePlayer("opp", [card("o1", "opp")]),
            makePlayer("me", [card("h1", "me")]),
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

beforeEach(cleanup);

describe("BoardSurface's GRE defaults (#2169)", () => {
    it("the GRE board mounts the priority indicator (showPriorityIndicator defaults to true)", () => {
        renderGreBoard();
        // `board.tsx` passes no `showPriorityIndicator`; the viewer holds
        // priority, so the real `PriorityIndicator` renders its "mine" glow.
        expect(screen.getByTestId("priority-indicator")).toBeTruthy();
    });

    it("the viewer's hand renders the INTERACTIVE hand card (handInteractive defaults to true)", () => {
        renderGreBoard();
        // `data-board-hand-card` renders only on `BoardHandCard`, the
        // commit/activate-capable card. The presentational `BoardCard` the
        // opt-out branch falls back to carries `data-board-card` instead.
        const hand = screen.getByTestId("zone-player-hand");
        expect(
            hand.querySelector('[data-board-hand-card="h1"]')
        ).not.toBeNull();
    });

    it("the OPPONENT's hand stays presentational (the seat gate, not the seam)", () => {
        // Guards the reading of the previous assertion: `handInteractive` is
        // ANDed with `player.id === viewerId`, so an interactive opponent hand
        // would mean the seam was wired to the wrong condition. The fixture
        // hands the opponent a REAL card so this depends on the seat gate and
        // nothing else — delete either `&& opponent.id === viewerId` in
        // `board-surface.tsx` and it goes red.
        renderGreBoard();
        const oppHand = screen.getByTestId("zone-opponent-hand");
        expect(oppHand.querySelector('[data-board-card="o1"]')).not.toBeNull();
        expect(oppHand.querySelector("[data-board-hand-card]")).toBeNull();
    });
});
