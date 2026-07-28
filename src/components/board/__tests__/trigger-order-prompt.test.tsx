// Issue #1765 — TriggerOrderPrompt's simultaneous-trigger (CR 603.3b) ordering
// strip shares its responsive tile-width fit with LibraryOrderPicker
// (`fitTileWidth`, `~/lib/reorder-strip-width`). No prior test file rendered
// this component; these cases cover the acceptance criteria that apply here —
// the strip shrinks to fit a mobile viewport, and drag-to-reorder still works
// at the reduced size.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import type { PendingChoice, StackItem } from "~/types/game";
import {
    fitTileWidth,
    MODAL_CHROME_PADDING_X,
} from "~/lib/reorder-strip-width";
import TriggerOrderPrompt from "../trigger-order-prompt";

vi.mock("@convex/_generated/api", () => ({
    api: { game: { submitResolutionChoice: "submitResolutionChoice" } },
}));

const submitCalls: unknown[] = [];
vi.mock("convex/react", () => ({
    useMutation: () => (args: unknown) => {
        submitCalls.push(args);
        return Promise.resolve(null);
    },
}));

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

function stackItem(id: string, delayedText: string): StackItem {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: "me",
        ownerId: "me",
        zone: "stack",
        isTapped: false,
        castById: "me",
        // Inline delayed-trigger text (ADR 0048) resolves without needing a
        // real CardDefinition lookup — the simplest ability-tile fixture.
        delayedTriggerId: `delayed-${id}`,
        delayedOracleText: delayedText,
    } as unknown as StackItem;
}

function makeChoice(candidateIds: string[]): PendingChoice {
    return {
        stackItemId: "trigger-batch",
        step: 0,
        choiceId: "me",
        playerId: "me",
        kind: "trigger-order",
        count: candidateIds.length,
        prompt: "Order these triggers",
        candidateIds,
    } as unknown as PendingChoice;
}

function renderPrompt(candidateIds: string[], batch: StackItem[]) {
    const gameCtx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: batch.length,
        pendingTriggerBatch: batch,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={gameCtx}>
            <MinimizedChoiceContext value={noopMinimized}>
                <TriggerOrderPrompt
                    choice={makeChoice(candidateIds)}
                    gameId={"game-id" as never}
                />
            </MinimizedChoiceContext>
        </GameContext>
    );
}

const setInnerWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: w,
    });
};

describe("TriggerOrderPrompt", () => {
    const originalInnerWidth = window.innerWidth;
    afterEach(() => {
        setInnerWidth(originalInnerWidth);
        submitCalls.length = 0;
    });

    it("confirming without dragging submits the candidate order reversed (rightmost = top of stack)", async () => {
        setInnerWidth(1024);
        const ids = ["a", "b", "c"];
        const batch = ids.map((id) => stackItem(id, `Trigger ${id}`));
        const { getByText } = renderPrompt(ids, batch);
        await act(async () => {
            fireEvent.click(getByText("Done"));
            await Promise.resolve();
        });
        expect(submitCalls).toHaveLength(1);
        expect(
            (submitCalls[0] as { cardInstanceIds: string[] }).cardInstanceIds
        ).toEqual(["c", "b", "a"]);
    });

    // Issue #1765 acceptance: a 5-tile strip at the natural width overflows a
    // 390px phone viewport. The fit is mirrored here (not hardcoded) so this
    // test tracks the real component math.
    it("shrinks the tile width to fit a 5-trigger strip at a 390px mobile viewport", () => {
        setInnerWidth(390);
        const ids = ["a", "b", "c", "d", "e"];
        const batch = ids.map((id) => stackItem(id, `Trigger ${id}`));
        const { baseElement } = renderPrompt(ids, batch);

        const GAP = 20;
        const NATURAL_TILE_W = 152;
        const MIN_TILE_W = 96;
        const expectedTileW = fitTileWidth({
            stripWidthAt: (w) => ids.length * (w + GAP) - GAP,
            naturalTileW: NATURAL_TILE_W,
            minTileW: MIN_TILE_W,
            availableWidth: 390 - MODAL_CHROME_PADDING_X,
        });
        expect(expectedTileW).toBeLessThan(NATURAL_TILE_W);

        const tiles = baseElement.querySelectorAll(".cursor-grab");
        expect(tiles.length).toBe(5);
        for (const tile of tiles) {
            expect((tile as HTMLElement).style.width).toBe(
                `${expectedTileW}px`
            );
        }

        // Horizontal-scroll fallback stays available regardless of the fit.
        expect(baseElement.querySelector(".overflow-x-auto")).not.toBeNull();
    });

    // Mirrors LibraryOrderPicker's own touch-capture regression (issue
    // #1772/#1765): the card→container implicit-capture transfer must not
    // kill an active drag, at the RESPONSIVE (shrunk) tile size.
    it("drag-to-reorder still works at a reduced tile size on touch (390px viewport)", async () => {
        setInnerWidth(390);
        const proto = Element.prototype as Element & {
            setPointerCapture: unknown;
            releasePointerCapture: unknown;
            hasPointerCapture: unknown;
        };
        const originalSetPointerCapture = proto.setPointerCapture;
        const originalReleasePointerCapture = proto.releasePointerCapture;
        const originalHasPointerCapture = proto.hasPointerCapture;
        proto.setPointerCapture = vi.fn();
        proto.releasePointerCapture = vi.fn();
        proto.hasPointerCapture = vi.fn(() => true);

        try {
            const ids = ["a", "b", "c"];
            const batch = ids.map((id) => stackItem(id, `Trigger ${id}`));
            const { getByText, baseElement } = renderPrompt(ids, batch);

            // Unlike LibraryOrderPicker (which reverses its DOM-vs-visual
            // order), TriggerOrderPrompt renders `order` LEFT→RIGHT directly:
            // DOM index i IS slot i, so the LAST tile ("c") is rightmost = top
            // of stack. Dragging it to the far left must reorder.
            const tiles = baseElement.querySelectorAll(".cursor-grab");
            expect(tiles.length).toBe(3);
            const rightmost = tiles[tiles.length - 1] as HTMLElement;
            const strip = rightmost.parentElement as HTMLElement;

            fireEvent.pointerDown(rightmost, {
                pointerId: 1,
                button: 0,
                clientX: 300,
                clientY: 50,
            });
            fireEvent.pointerMove(strip, {
                pointerId: 1,
                clientX: 280,
                clientY: 50,
            });
            // Implicit-capture transfer fires lostpointercapture ON THE TILE
            // (target ≠ strip) — must not commit the drag.
            fireEvent.lostPointerCapture(rightmost, { pointerId: 1 });
            fireEvent.pointerMove(strip, {
                pointerId: 1,
                clientX: 0,
                clientY: 50,
            });
            fireEvent.pointerUp(strip, {
                pointerId: 1,
                clientX: 0,
                clientY: 50,
            });

            await act(async () => {
                fireEvent.click(getByText("Done"));
                await Promise.resolve();
            });
            expect(submitCalls).toHaveLength(1);
            const submittedOrder = (
                submitCalls[0] as { cardInstanceIds: string[] }
            ).cardInstanceIds;
            expect(submittedOrder).not.toEqual(["c", "b", "a"]);
            expect([...submittedOrder].sort()).toEqual(["a", "b", "c"]);
        } finally {
            proto.setPointerCapture = originalSetPointerCapture;
            proto.releasePointerCapture = originalReleasePointerCapture;
            proto.hasPointerCapture = originalHasPointerCapture;
        }
    });
});
