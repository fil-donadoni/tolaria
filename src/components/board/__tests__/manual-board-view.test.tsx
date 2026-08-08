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
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import {
    manualCard,
    manualSeat,
    manualState,
} from "~/lib/__tests__/manual-test-fixtures";

// Named manual mutations (mirrors `manual-drag-lifecycle.test.tsx`), so a
// test can assert WHICH manual verb a click/drag dispatched — issue #2347's
// hand verb menu needs this to prove `Play to battlefield` et al. reach
// `manualMoveCard` and never a GRE mutation.
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {};
const MANUAL_MUTATION_NAMES = [
    "manualMoveCard",
    "manualSetTapped",
    "manualUntapAll",
    "manualAdjustLife",
    "manualAdjustCounter",
    "manualSetFaceDown",
    "manualSetLane",
    "manualAttach",
    "manualSetArrow",
    "manualClearArrow",
    "manualDraw",
    "manualMill",
    "manualExileTop",
    "manualPeek",
    "manualShuffle",
    "manualSetNote",
    "manualEndTurn",
    "manualConcede",
];
for (const n of MANUAL_MUTATION_NAMES) MUTATIONS[n] = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (ref?: { _name?: string }) =>
        (ref?._name ? MUTATIONS[ref._name] : undefined) ?? vi.fn(),
    useQuery: () => undefined,
    // `ManualLogSurface` mounts `ManualLog`'s `usePaginatedQuery` subscription
    // once opened (issue #2172) — a bare object with no `manualLog` methods
    // isn't a paginated query result, so this stands in for it.
    usePaginatedQuery: () => ({
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    }),
}));
vi.mock("@convex/_generated/api", () => {
    const game: Record<string, { _name: string }> = {};
    for (const n of MANUAL_MUTATION_NAMES) game[n] = { _name: n };
    return { api: { game, cardIndex: {}, manualLog: {} } };
});
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    tryGetDefinition: () => undefined,
    // Issue #2347: `handInteractive={true}` now mounts the real
    // `BoardHandCard` for the manual hand, whose unconditional
    // `useHandCardCommit` call reads a definition even though the manual
    // branch never wires its returned overlays to the DOM. A vanilla stub (no
    // modes/X/kicker) is enough — this suite never exercises the cast path.
    getDefinition: () => ({ name: "Manual Test Card" }),
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
beforeEach(() => {
    for (const m of Object.values(MUTATIONS)) m.mockClear();
});

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

    // Issue #2172 — the log used to be a `w-80` rail sibling of the board's
    // own flex row, subtracting its width permanently. It is now collapsed by
    // default (nothing rendered at all — see `manual-log-surface.test.tsx`
    // for that half) and opens as an overlay SIBLING of `<main>`, never a
    // descendant: `useManualDrag`'s `isOverBoard` check walks
    // `.closest("[data-manual-board]")`, so nesting the surface inside `main`
    // would make a drop released on the log itself misread as "over the
    // board". Proof-of-failure: nesting `<ManualLogSurface>` inside `<main>`
    // in `manual-board-view.tsx` turns this red (`board().contains(...)`
    // flips to `true`) — confirmed and reverted for the PR.
    it("opens the log as a sibling overlay, never nested inside the board, and never touches the board's own layout classes (#2172)", () => {
        renderBoard();
        const board = () =>
            document.querySelector<HTMLElement>("[data-manual-board]")!;
        const classNameBefore = board().className;
        expect(document.querySelector("[data-manual-log-surface]")).toBeNull();

        fireEvent.click(screen.getByText("Log"));

        const logSurface = document.querySelector("[data-manual-log-surface]");
        expect(logSurface).not.toBeNull();
        expect(board().contains(logSurface)).toBe(false);
        // Opening the log never mutates the board's own class list — the
        // board is full width whether the log is open or closed (AC2).
        expect(board().className).toBe(classNameBefore);
    });
});

// Issue #2347 — the hand card verb menu, end to end through the real board:
// GRE `handInteractive` used to be one flag for two opt-outs ("no cast
// dispatch" and "no ability menu"); the manual board now flips it to `true`
// but injects `ManualHandInteractionProvider` so `BoardHandCard` shows ONLY
// the manual verb menu, never the GRE cast pipeline that flag used to guard.
describe("hand card manual verb menu (issue #2347)", () => {
    function handCardEl() {
        return document.querySelector<HTMLElement>(
            '[data-board-hand-card="hand1"]'
        )!;
    }

    it("a left click on the viewer's own hand card opens the verb menu, Play to battlefield first", () => {
        renderBoard();
        fireEvent.click(handCardEl());
        expect(screen.getByText("Play to battlefield")).toBeTruthy();
        expect(screen.getByText("Move to graveyard")).toBeTruthy();
        expect(screen.getByText("Move to exile")).toBeTruthy();
        expect(screen.getByText("Move to library (top)")).toBeTruthy();
        expect(screen.getByText("Turn face down")).toBeTruthy();
        expect(screen.getByText("Set note…")).toBeTruthy();
    });

    it("Play to battlefield dispatches manualMoveCard to the battlefield zone — never a GRE cast/play mutation", () => {
        renderBoard();
        fireEvent.click(handCardEl());
        fireEvent.click(screen.getByText("Play to battlefield"));
        expect(MUTATIONS.manualMoveCard).toHaveBeenCalledWith({
            gameId: "game-id",
            instanceId: "hand1",
            toZone: "battlefield",
        });
    });

    it("Turn face down dispatches manualSetFaceDown — a second verb, proving the whole list is wired, not just the first", () => {
        renderBoard();
        fireEvent.click(handCardEl());
        fireEvent.click(screen.getByText("Turn face down"));
        expect(MUTATIONS.manualSetFaceDown).toHaveBeenCalledWith({
            gameId: "game-id",
            instanceId: "hand1",
            faceDown: true,
        });
    });

    it("the opponent's hidden hand slot exposes no menu (projects as null — no card object to open a menu on)", () => {
        renderBoard();
        const oppHand = screen.getByTestId("zone-opponent-hand");
        expect(oppHand.querySelector("[data-board-hand-card]")).toBeNull();
    });

    it("dragging the hand card still resolves the zone-move drop, unchanged — never BoardHandCard's own drag-to-cast", () => {
        renderBoard();
        const target = handCardEl();
        const battlefieldBand = () =>
            document.querySelector<HTMLElement>(
                '[data-zone-drop="battlefield"][data-zone-owner="me"]'
            );
        (
            document as unknown as {
                elementFromPoint: (x: number, y: number) => Element | null;
            }
        ).elementFromPoint = () => battlefieldBand();

        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 600,
        });
        fireEvent.pointerMove(window, { clientX: 100, clientY: 400 });
        fireEvent.pointerUp(window, { clientX: 100, clientY: 400 });

        expect(MUTATIONS.manualMoveCard).toHaveBeenCalledWith({
            gameId: "game-id",
            instanceId: "hand1",
            toZone: "battlefield",
        });
    });
});
