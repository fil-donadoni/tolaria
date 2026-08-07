// The swap itself (PRD #2162, issue #2169): a Manual Game mounts the SHARED
// board skeleton.
//
// Two assertions, and the negative one is the load-bearing half. The four zone
// bands and both pile rails must render for BOTH seats — that is the inherited
// surface the whole ticket is about. And the priority indicator, the stack and
// the mana pool must NOT mount: each is a GRE concept, each reads the inert
// context this container synthesises, and each would render a confident,
// meaningless cue if it slipped through.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import {
    manualCard,
    manualSeat,
    manualState,
} from "~/lib/__tests__/manual-test-fixtures";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: {}, cardIndex: {}, manualLog: {} },
}));
vi.mock("@convex/cards", () => ({
    tryGetDefinition: () => undefined,
    FACE_DOWN_CARD_ID: "__faceDownDef",
}));
// The Full Catalogue is a ~34k-row lazy asset; the row classifier's documented
// fail-safe is "unresolvable → back row", which is exactly this state.
vi.mock("~/lib/fullCatalogue", () => ({
    useFullCatalogue: () => ({ rows: undefined, error: null }),
}));
vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => false }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop",
}));
vi.mock("~/hooks/useViewportHeight", () => ({
    useViewportHeight: () => 900,
}));
vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));
vi.mock("../controller-phase-panel", () => ({ default: () => <div /> }));

const { default: ManualBoardView } = await import("../manual-board-view");

function renderBoard() {
    const state = manualState([
        manualSeat("me", {
            battlefield: [manualCard("perm1")],
            hand: [manualCard("hand1", { zone: "hand" })],
            graveyard: [manualCard("gy1", { zone: "graveyard" })],
        }),
        manualSeat("opp", { hand: [null] }),
    ]);
    return render(
        <ManualBoardView
            gameId={"game-id" as never}
            viewerId="me"
            state={state}
        />
    );
}

beforeEach(cleanup);

describe("the Manual Board on the shared board shell (#2169)", () => {
    it("renders the four zone bands and both pile rails", () => {
        renderBoard();
        for (const zone of [
            "zone-opponent-hand",
            "zone-opponent-battlefield",
            "zone-player-battlefield",
            "zone-player-hand",
        ]) {
            expect(screen.getByTestId(zone)).toBeTruthy();
        }
        expect(screen.getByTestId("piles-player")).toBeTruthy();
        expect(screen.getByTestId("piles-opponent")).toBeTruthy();
    });

    // ONE of these three clauses guards something this PR introduced; the other
    // two are INHERITED guarantees, recorded here because the criterion is
    // "these do not mount", not "these were opted out of":
    //  - priority indicator: THE load-bearing clause. It is suppressed by the
    //    new `showPriorityIndicator={false}`, and it is the only one that goes
    //    red if that opt-out is dropped. Its positive counterpart — the GRE
    //    board DOES mount it by default — is in
    //    `board-surface-gre-defaults.test.tsx`, so the pair is falsifiable from
    //    both sides.
    //  - stack: suppressed by `BoardSurface`'s PRE-EXISTING
    //    `!isPortrait && stackItems.length > 0` gate, since a Manual Game has an
    //    empty stack. It would hold with no opt-out at all.
    //  - mana pool: suppressed by `player-mana-pool.tsx`'s own `return null` on
    //    an empty pool. Also pre-existing — though live, not vacuous: removing
    //    that early return turns this clause red.
    it("does NOT mount the priority indicator, the stack or the mana pool", () => {
        renderBoard();
        expect(screen.queryByTestId("priority-indicator")).toBeNull();
        expect(screen.queryByTestId("game-stack")).toBeNull();
        expect(screen.queryByTestId("mana-pool")).toBeNull();
    });

    it("offers the manual controller descriptors and no Pass / Attack all", () => {
        renderBoard();
        expect(screen.getByText("End Turn")).toBeTruthy();
        expect(screen.getByText("Untap all")).toBeTruthy();
        expect(screen.queryByText("Pass")).toBeNull();
        expect(screen.queryByText("Attack all")).toBeNull();
    });
});
