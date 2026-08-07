// Solo Manual Game seat switch (issue #2173, PRD #2162).
//
// The acceptance criteria as data: a solo Manual Game offers "Switch seat" in
// the controller plus an `S` hotkey; switching flips the board (the
// controlled seat renders at the bottom, in `zone-player-*`) and re-queries
// `getManualState` for the new seat, so the newly-controlled hand becomes
// visible/actionable and the previously-controlled one hides; a two-player
// Manual Game offers neither the action nor the hotkey, and its viewer stays
// fixed to the caller's own seat.
//
// Rendered through the REAL `ManualBoardContainer` with only Convex's
// `useMutation`/`useQuery` mocked — `useQuery` here calls the actual
// `projectManualState` reducer (`convex/manual.ts`) against a raw
// `ManualGameState`, exactly what the server does, so "the other seat's hand
// is hidden" is proven by the real per-viewer redaction, never a hand-built
// state (`.claude/rules/gre-development.md` § Frontend wiring analysis).
//
// "Actionable" on this board means draggable: `board-card.tsx` documents
// `data-board-card` as the Manual Board's own drag-source hit-test handle,
// present only when a real (non-hidden) card is rendered — so its presence
// keyed on an instance id IS the actionable signal here.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { projectManualState } from "@convex/manual";
import type { ManualGameState } from "@convex/manual";

const rawState: ManualGameState = {
    turn: 1,
    activePlayerId: "user-p1",
    players: [
        {
            id: "user-p1",
            name: "P1",
            bgColor: "#111",
            life: 20,
            hand: [
                {
                    id: "p1-hand",
                    card: { id: "def-p1" },
                    zone: "hand",
                    controllerId: "user-p1",
                    ownerId: "user-p1",
                    isTapped: false,
                },
            ],
            library: [],
            graveyard: [],
            exile: [],
            battlefield: [],
        },
        {
            id: "user-p2",
            name: "P2",
            bgColor: "#222",
            life: 20,
            hand: [
                {
                    id: "p2-hand",
                    card: { id: "def-p2" },
                    zone: "hand",
                    controllerId: "user-p2",
                    ownerId: "user-p2",
                    isTapped: false,
                },
            ],
            library: [],
            graveyard: [],
            exile: [],
            battlefield: [],
        },
    ],
};

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    // The container's ONLY query. Runs the real per-viewer projection so
    // switching the steered seat proves itself through the actual redaction
    // rule, not a stand-in.
    useQuery: (_fn: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        const { viewerId } = args as { viewerId: string };
        return projectManualState(rawState, viewerId);
    },
    usePaginatedQuery: () => ({
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: {}, cardIndex: {}, manualLog: {} },
}));
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

const { default: ManualBoardContainer } =
    await import("../manual-board-container");

beforeEach(cleanup);

function renderContainer(solo: boolean) {
    return render(
        <ManualBoardContainer
            gameId={"game-id" as never}
            playerId="user-p1"
            solo={solo}
        />
    );
}

/** Whichever instance id currently renders as a REAL (non-hidden) card in a
 *  named zone testid, or `undefined` if the zone renders no real card. */
function realCardIdIn(zoneTestId: string): string | undefined {
    const zone = screen.getByTestId(zoneTestId);
    const el = zone.querySelector<HTMLElement>("[data-board-card]");
    return el?.getAttribute("data-board-card") ?? undefined;
}

describe("solo Manual Game seat switch (#2173)", () => {
    it("controls user-p1 initially: its hand is the visible/actionable bottom hand, the other seat's is hidden", () => {
        renderContainer(true);
        expect(realCardIdIn("zone-player-hand")).toBe("p1-hand");
        expect(realCardIdIn("zone-opponent-hand")).toBeUndefined();
    });

    it("offers Switch seat with the S hotkey hint in the controller", () => {
        renderContainer(true);
        expect(screen.getByText("Switch seat")).toBeTruthy();
        expect(screen.getByText("[S]")).toBeTruthy();
    });

    it("clicking Switch seat flips the board: the newly-controlled seat's hand becomes the visible bottom hand, the previous one hides", () => {
        renderContainer(true);
        fireEvent.click(screen.getByText("Switch seat"));

        expect(realCardIdIn("zone-player-hand")).toBe("p2-hand");
        expect(realCardIdIn("zone-opponent-hand")).toBeUndefined();
    });

    it("the S hotkey does the same as the button", () => {
        renderContainer(true);
        fireEvent.keyDown(window, { key: "s" });

        expect(realCardIdIn("zone-player-hand")).toBe("p2-hand");
    });

    it("switching twice returns to the original seat", () => {
        renderContainer(true);
        fireEvent.click(screen.getByText("Switch seat"));
        fireEvent.click(screen.getByText("Switch seat"));

        expect(realCardIdIn("zone-player-hand")).toBe("p1-hand");
    });

    it("ignores the S hotkey while the user is typing in a text field", () => {
        renderContainer(true);
        const input = document.createElement("input");
        document.body.appendChild(input);

        fireEvent.keyDown(input, { key: "s" });

        expect(realCardIdIn("zone-player-hand")).toBe("p1-hand");
        document.body.removeChild(input);
    });

    it("a two-player Manual Game offers neither the action nor the hotkey, and the viewer stays fixed", () => {
        renderContainer(false);
        expect(screen.queryByText("Switch seat")).toBeNull();

        fireEvent.keyDown(window, { key: "s" });

        // No affordance to flip it, and the S keystroke is not bound at all
        // (no `onSwitchSeat` was ever supplied to the hotkey hook) — the
        // viewer's own seat (user-p1) stays the controlled one.
        expect(realCardIdIn("zone-player-hand")).toBe("p1-hand");
    });
});
