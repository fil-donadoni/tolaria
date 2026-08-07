// The Manual Board drag's GESTURE LIFECYCLE (PRD #2162, issue #2169).
//
// `manual-drop.test.ts` covers the pure decision function; this covers the part
// that decides whether the decision is ever reached. The regression it guards is
// specific and was shipped once: `ManualBoardContainer` renders the 320px
// `ManualLog` rail as a SIBLING of `ManualBoardView`'s `<main>`, so binding
// `pointermove`/`pointerup`/`pointercancel` on that `<main>` means a drag
// released anywhere outside it (the log rail, or off the window) never
// terminates — the drop is discarded, the fixed-position ghost stays pinned on
// screen, and the click-swallow stays armed and eats the next legitimate click
// on the board. The deleted `manual-board.tsx` avoided all of that with
// `setPointerCapture` (`manual-board.tsx:222`); `useManualDrag` now terminates
// the gesture on the WINDOW instead.
//
// Everything here drives the REAL `ManualBoardView` (so the `ref={drag.rootRef}`
// wiring is under test too, not just the hook in isolation), with the sibling
// log rail present as the out-of-board release target it actually is.
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
    "manualConcede",
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
vi.mock("@convex/cards", () => ({
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

/** The board plus the sibling that causes the bug: `ManualBoardContainer` puts
 *  `ManualLog` in a `w-80 shrink-0` div OUTSIDE the board's `<main>`. */
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
