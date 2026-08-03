// Slice #255 (PRD #249): the stack renders as an ordered spatial element
// showing resolution order — LIFO, the last-cast item resolves first and reads
// first (leftmost). This test asserts the external DOM order against the
// stack's logical order, so the "top resolves first" read survives refactors of
// the tile internals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { MONARCH_DESIGNATION } from "@convex/cards/designations";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("~/hooks/use-leader-lines", () => ({
    repositionLeaderLines: () => {},
}));
vi.mock("../drag-handle", () => ({ default: () => null }));
vi.mock("../../cards/color-overlay-card-image", () => ({
    default: ({ card }: { card: StackItem }) => (
        <div data-testid="stack-card" data-card-id={card.id} />
    ),
}));

import GameStack from "../game-stack";

function makeStackItem(id: string): StackItem {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "stack",
        isTapped: false,
    } as StackItem;
}

function renderStack(
    stack: StackItem[],
    allPlayers: NonNullable<
        React.ContextType<typeof GameContext>
    >["allPlayers"] = []
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: stack.length,
        stackItems: [],
        allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={stack} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("GameStack resolution order (slice #255)", () => {
    it("renders the stack in LIFO order — top of stack (last cast) first", () => {
        // Logical stack order is bottom → top: 'bottom' was cast first,
        // 'top' last. The top resolves first, so it must render first/leftmost.
        const stack = [
            makeStackItem("bottom"),
            makeStackItem("middle"),
            makeStackItem("top"),
        ];
        const { container } = renderStack(stack);

        const order = Array.from(
            container.querySelectorAll<HTMLElement>("[data-arrow-anchor-stack]")
        ).map((el) => el.getAttribute("data-arrow-anchor-stack"));

        expect(order).toEqual(["top", "middle", "bottom"]);
    });
});

describe("GameStack ability-kind detection (#935)", () => {
    it("renders a delayed triggered ability as an ability tile, not card art", () => {
        // Mishra's Bauble's "Draw a card at the beginning of the next turn's
        // upkeep" delayed trigger (CR 603.7a) must render via StackAbilityTile
        // (a third ability kind alongside activated/triggered), not fall
        // through to the source card image.
        const item = {
            ...makeStackItem("delayed-1"),
            card: { id: "8a720448-017f-4f4a-9501-678245eaed17" }, // Mishra's Bauble
            delayedTriggerId: "next-upkeep-cantrip",
        } as StackItem;
        const { container, queryByTestId } = renderStack([item]);

        expect(
            container.querySelector('[data-arrow-anchor-stack="delayed-1"]')
        ).not.toBeNull();
        // The ability-tile path renders — not the source card image mock.
        expect(queryByTestId("stack-card")).toBeNull();
        expect(container.textContent).toContain(
            "Draw a card at the beginning of the next turn's upkeep."
        );
    });

    it("renders the Monarch end-step draw as a marker-art triggered ability (CR 725, #1305)", () => {
        // The source-less inherent designation trigger carries `designationId`
        // but no card (`card.id` is ""). It must render with the Monarch marker
        // ART + name, labelled a plain "Triggered ability" — not the empty
        // "Token" placeholder a card-less inline trigger would otherwise show.
        const item = {
            ...makeStackItem("monarch-draw"),
            card: { id: "" },
            delayedTriggerId: "$inline-effects",
            delayedOracleText:
                "At the beginning of the monarch's end step, that player draws a card.",
            designationId: MONARCH_DESIGNATION.id,
        } as StackItem;
        const { container, queryByTestId } = renderStack([item]);

        // Ability-tile path (not the source card image mock).
        expect(queryByTestId("stack-card")).toBeNull();
        // Marker art rendered from the designation's print id.
        const img = container.querySelector("img");
        expect(img?.getAttribute("src")).toContain(
            MONARCH_DESIGNATION.imagePrintId
        );
        // Marker name + triggered-ability label, not "Token"/"Delayed trigger".
        expect(container.textContent).toContain(MONARCH_DESIGNATION.name);
        expect(container.textContent).toContain("Triggered ability");
        expect(container.textContent).not.toContain("Token");
    });

    it("themes the Monarch tile to the per-source printing when present (CR 725, #1305)", () => {
        // When the crowning card supplies a themed marker printing
        // (`designationImagePrintId`), the tile renders THAT print — not the
        // designation's global `imagePrintId` — so the art matches the card.
        const themed = "63455c28-3e53-45b1-8d0b-a5045dab1fb9"; // Forth's LTR print
        const item = {
            ...makeStackItem("monarch-themed"),
            card: { id: "" },
            delayedTriggerId: "$inline-effects",
            delayedOracleText:
                "At the beginning of the monarch's end step, that player draws a card.",
            designationId: MONARCH_DESIGNATION.id,
            designationImagePrintId: themed,
        } as StackItem;
        const { container } = renderStack([item]);

        const img = container.querySelector("img");
        expect(img?.getAttribute("src")).toContain(themed);
        // Not the global fallback printing.
        expect(img?.getAttribute("src")).not.toContain(
            MONARCH_DESIGNATION.imagePrintId
        );
    });
});

describe("GameStack targets are arrows, not text chips (QA)", () => {
    it("renders no target-name chip for a targeted stack item", () => {
        // The board-crossing SVG arrows (`board-arrows.tsx`) are the single
        // representation of "what this targets". A duplicate name chip in the
        // row said WHAT but never WHERE, so it was dropped — the row must not
        // print the target's name at all.
        const item = {
            ...makeStackItem("bolt"),
            castById: "me",
            targets: [{ type: "player" as const, id: "opp" }],
        } as StackItem;
        const { container } = renderStack([item], [
            {
                id: "opp",
                name: "Rival",
                battlefield: [],
                graveyard: [],
            },
        ] as never);

        expect(container.textContent).not.toContain("Rival");
        expect(container.textContent).not.toContain("→");
    });
});

describe("GameStack viewport anchor (QA)", () => {
    it("anchors to the viewport right edge so it clears centered dialogs", () => {
        // It used to anchor to the play area's right edge
        // (`--right-piles-w`), which pushed the 384px panel far enough left to
        // overlap every play-area-centered dialog (card placement, pickers).
        const { container } = renderStack([makeStackItem("only")]);
        const panel = container.firstElementChild as HTMLElement;
        expect(panel.style.right).toBe("0.5rem");
        expect(panel.style.right).not.toContain("--right-piles-w");
    });
});
