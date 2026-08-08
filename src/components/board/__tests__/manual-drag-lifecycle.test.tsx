// The Manual Board drag's GESTURE LIFECYCLE (PRD #2162, issue #2169).
//
// `manual-drop.test.ts` covers the pure decision function; this covers the part
// that decides whether the decision is ever reached. The regression it guards is
// specific and was shipped once: `ManualBoardView`'s `<main>` always has SOME
// out-of-board release target as a DOM sibling — originally the 320px
// `ManualLog` rail `ManualBoardContainer` docked permanently, now the
// collapsed `ManualLogSurface` overlay (issue #2172,
// `manual-log-surface.tsx`) — so binding `pointermove`/`pointerup`/
// `pointercancel` on that `<main>` means a drag released anywhere outside it
// (the sibling, or off the window) never terminates — the drop is discarded,
// the fixed-position ghost stays pinned on screen, and the click-swallow stays
// armed and eats the next legitimate click on the board. The deleted
// `manual-board.tsx` avoided all of that with `setPointerCapture`
// (`manual-board.tsx:222`); `useManualDrag` now terminates the gesture on the
// WINDOW instead.
//
// Everything here drives the REAL `ManualBoardView` rather than the hook in
// isolation, so what is under test is the shipped wiring: `onPointerDown` bound
// on the board's `<main>` (the delegation scope) with move / up / cancel bound
// on `window` for the life of the press, and a synthetic sibling standing in
// for whatever out-of-board surface is mounted outside that `<main>` as the
// out-of-board release target it is — `manual-board-view.test.tsx` covers the
// REAL sibling (`ManualLogSurface`) is where production wiring actually puts
// it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import {
    manualCard,
    manualSeat,
    manualState,
} from "~/lib/__tests__/manual-test-fixtures";

// Named manual mutations, so a test can assert WHICH verb the drop dispatched.
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
    "manualDraw",
    "manualMill",
    "manualExileTop",
    "manualPeek",
    "manualShuffle",
    "manualSetNote",
    "manualEndTurn",
    "manualConcedeMatch",
];
for (const n of MANUAL_MUTATION_NAMES) MUTATIONS[n] = vi.fn();

const NOOP_MUTATION = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref?: { _name?: string }) =>
        (ref?._name ? MUTATIONS[ref._name] : undefined) ?? NOOP_MUTATION,
    useQuery: () => undefined,
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
    FACE_DOWN_CARD_ID: "__faceDownDef",
}));
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

/** The board plus a synthetic stand-in for whatever out-of-board sibling is
 *  mounted OUTSIDE the board's `<main>` — production mounts
 *  `ManualLogSurface` there (issue #2172); this test only needs SOME element
 *  outside `<main>` to release the drag over. */
function renderBoardWithLogRail() {
    const state = manualState([
        manualSeat("me", { battlefield: [manualCard("perm1")] }),
        manualSeat("opp", { hand: [null] }),
    ]);
    return render(
        <div>
            <ManualBoardView
                gameId={"game-id" as never}
                viewerId="me"
                state={state}
            />
            <div data-testid="log-rail">log</div>
        </div>
    );
}

const permanent = () =>
    document.querySelector<HTMLElement>(
        '[data-arrow-anchor-permanent="perm1"]'
    )!;
const ghost = () => document.querySelector("[data-manual-drag-ghost]");
/** The board's own `<main>` — inside the delegation scope, but not a drag
 *  source, so a press on it takes `onPointerDown`'s early return. */
const boardRoot = () =>
    document.querySelector<HTMLElement>("[data-manual-board]")!;

/** Press on the permanent and drag straight up past the combat lift, WITHOUT
 *  releasing. `pointermove` goes to the window because that is where the live
 *  gesture listens — a browser delivers it there whether or not the pointer is
 *  still over the board. */
function pressAndDragUp() {
    fireEvent.pointerDown(permanent(), {
        button: 0,
        clientX: 500,
        clientY: 500,
    });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 380 });
}

beforeEach(() => {
    cleanup();
    for (const m of Object.values(MUTATIONS)) m.mockClear();
    // jsdom has no `elementFromPoint`; the drop probe calls it. Resolving to
    // nothing is the honest model of "released over the log rail" — no
    // `data-zone-drop` band is under that point.
    (
        document as unknown as {
            elementFromPoint: (x: number, y: number) => Element | null;
        }
    ).elementFromPoint = () => null;
});

describe("Manual Board drag gesture lifecycle (#2169)", () => {
    it("a pointerup OUTSIDE the board still resolves the drop and clears the ghost", () => {
        renderBoardWithLogRail();
        pressAndDragUp();
        expect(ghost()).not.toBeNull();

        // Release over the log rail — a sibling of the board's <main>.
        fireEvent.pointerUp(screen.getByTestId("log-rail"), {
            clientX: 500,
            clientY: 380,
        });

        // The drop resolved (vertical drag off the battlefield, nothing under
        // the release point → combat lane) instead of being discarded...
        expect(MUTATIONS.manualSetLane).toHaveBeenCalledWith({
            gameId: "game-id",
            instanceId: "perm1",
            lane: "combat",
        });
        // ...and nothing of the gesture is left on screen.
        expect(ghost()).toBeNull();
    });

    it("after an outside release, the next click on the board is NOT swallowed", () => {
        renderBoardWithLogRail();
        pressAndDragUp();
        fireEvent.pointerUp(screen.getByTestId("log-rail"), {
            clientX: 500,
            clientY: 380,
        });

        // A fresh, legitimate tap on the permanent: press, release, click.
        fireEvent.pointerDown(permanent(), {
            button: 0,
            clientX: 500,
            clientY: 500,
        });
        fireEvent.pointerUp(permanent(), { clientX: 500, clientY: 500 });
        fireEvent.click(permanent());

        expect(MUTATIONS.manualSetTapped).toHaveBeenCalledWith({
            gameId: "game-id",
            instanceId: "perm1",
            tapped: true,
        });
    });

    it("a press ends a gesture whose pointerup AND pointercancel were both lost", () => {
        renderBoardWithLogRail();
        pressAndDragUp();
        expect(ghost()).not.toBeNull();

        // Window blur / OS interruption mid-drag: neither `pointerup` nor
        // `pointercancel` ever arrives, so nothing on the gesture's own path
        // runs. The next press is the only remaining boundary — and it lands on
        // the board but NOT on a drag source, i.e. it takes `onPointerDown`'s
        // early return, so the cleanup has to happen ahead of that return.
        fireEvent.pointerDown(boardRoot(), {
            button: 0,
            clientX: 10,
            clientY: 10,
        });

        // The stranded ghost is gone...
        expect(ghost()).toBeNull();
        // ...and so are the dead gesture's window listeners: a stray
        // `pointerup` no longer resolves a drop for the abandoned card.
        fireEvent.pointerUp(window, { clientX: 500, clientY: 380 });
        expect(MUTATIONS.manualSetLane).not.toHaveBeenCalled();
        expect(MUTATIONS.manualMoveCard).not.toHaveBeenCalled();
    });

    it("a pointercancel anywhere abandons the drag with no ghost and no dispatch", () => {
        renderBoardWithLogRail();
        pressAndDragUp();
        expect(ghost()).not.toBeNull();

        fireEvent.pointerCancel(window);

        expect(ghost()).toBeNull();
        expect(MUTATIONS.manualSetLane).not.toHaveBeenCalled();
        expect(MUTATIONS.manualMoveCard).not.toHaveBeenCalled();

        // And the cancelled gesture leaves the click path clean.
        fireEvent.pointerDown(permanent(), {
            button: 0,
            clientX: 500,
            clientY: 500,
        });
        fireEvent.pointerUp(permanent(), { clientX: 500, clientY: 500 });
        fireEvent.click(permanent());
        expect(MUTATIONS.manualSetTapped).toHaveBeenCalled();
    });
});
