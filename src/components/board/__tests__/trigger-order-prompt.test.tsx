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
import { fitTileWidth, modalChromePaddingX } from "~/lib/reorder-strip-width";
import TriggerOrderPrompt, {
    NATURAL_TILE_W,
    MIN_TILE_W,
    GAP,
} from "../trigger-order-prompt";

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
        engineTurn: 1,
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

        const expectedTileW = fitTileWidth({
            stripWidthAt: (w) => ids.length * (w + GAP) - GAP,
            naturalTileW: NATURAL_TILE_W,
            minTileW: MIN_TILE_W,
            availableWidth: 390 - modalChromePaddingX(390),
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
    //
    // Review fix: the original version of this test dropped at `clientX: 0`,
    // which lands at drop index 0 at ANY tile width (jsdom zeroes every
    // element's bounding rect) — it could never have caught a regression back
    // to a hardcoded NATURAL_TILE_W in the gesture math. `clientX: 70` is a
    // real mid-strip position where the FITTED tile width and the NATURAL
    // width resolve to DIFFERENT drop indices (worked out below), and the
    // expected submitted order is derived by mirroring the component's own
    // `center`/clamp-round math at the fitted width — not hardcoded.
    it("drag-to-reorder computes the drop index from the actual (fitted) tile width, not a hardcoded one", async () => {
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

            const pointerDownX = 300;
            const finalX = 70;

            fireEvent.pointerDown(rightmost, {
                pointerId: 1,
                button: 0,
                clientX: pointerDownX,
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
                clientX: finalX,
                clientY: 50,
            });
            fireEvent.pointerUp(strip, {
                pointerId: 1,
                clientX: finalX,
                clientY: 50,
            });

            await act(async () => {
                fireEvent.click(getByText("Done"));
                await Promise.resolve();
            });
            expect(submitCalls).toHaveLength(1);

            // Mirrors the component's own fit + drop-resolution math exactly:
            // `tileW`/`slot`/`center` (trigger-order-prompt.tsx) at the FITTED
            // width, `grabOffsetX` captured at the ORIGINAL press position
            // (before "c" is removed from `order`), then the same
            // clamp(round(...)) the `view` memo uses.
            const fittedTileW = fitTileWidth({
                stripWidthAt: (w) => ids.length * (w + GAP) - GAP,
                naturalTileW: NATURAL_TILE_W,
                minTileW: MIN_TILE_W,
                availableWidth: 390 - modalChromePaddingX(390),
            });
            expect(fittedTileW).toBeLessThan(NATURAL_TILE_W);
            const slot = fittedTileW + GAP;
            const center = (i: number) => i * slot + fittedTileW / 2;
            const draggedIdx = ids.indexOf("c");
            const grabOffsetX = pointerDownX - center(draggedIdx);
            const rest = ids.filter((id) => id !== "c");
            const draggedCenter = finalX - grabOffsetX;
            const expectedDropIndex = Math.min(
                rest.length,
                Math.max(
                    0,
                    Math.round((draggedCenter - fittedTileW / 2) / slot)
                )
            );
            const nextOrder = [...rest];
            nextOrder.splice(expectedDropIndex, 0, "c");
            const expectedSubmittedOrder = [...nextOrder].reverse();

            const submittedOrder = (
                submitCalls[0] as { cardInstanceIds: string[] }
            ).cardInstanceIds;
            expect(submittedOrder).toEqual(expectedSubmittedOrder);
        } finally {
            proto.setPointerCapture = originalSetPointerCapture;
            proto.releasePointerCapture = originalReleasePointerCapture;
            proto.hasPointerCapture = originalHasPointerCapture;
        }
    });

    // #1770 mobile QA sweep touch-target audit: the minimize button rendered
    // at `h-8 w-8` (32px) — under the 44px floor, and safe to grow here since
    // it owns its own row.
    it("sizes the minimize button to the 44px touch-target floor", () => {
        const { getByLabelText } = renderPrompt(
            ["a", "b"],
            [stackItem("a", "text a"), stackItem("b", "text b")]
        );
        const btn = getByLabelText("Minimize choice dialog");
        expect(btn.className).toContain("h-11");
        expect(btn.className).toContain("w-11");
    });
});
