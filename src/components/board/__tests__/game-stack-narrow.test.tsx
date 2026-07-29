// Issue #1816: on portrait, `BoardPortraitChips` mounts `GameStack` with
// `narrow` (open-by-default panel) — narrower than the desktop 384px panel,
// and clearance-bound to the midline / viewer-battlefield-bottom rather than
// the desktop's vertically-centered, vh-capped box. This file asserts the
// two width/anchor contracts directly on the real `GameStack` component (not
// the mock used by `board-portrait-chips.test.tsx`), and that the desktop
// (no `narrow`) mount is byte-for-byte unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

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
    props: { elevated?: boolean; narrow?: boolean } = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: stack.length,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={stack} {...props} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("GameStack narrow/portrait variant (issue #1816)", () => {
    it("desktop (no `narrow`) keeps the 384px vertically-centered panel unchanged", () => {
        const { container } = renderStack([makeStackItem("only")]);
        const outer = container.firstElementChild as HTMLElement;
        const panel = outer.querySelector('[data-slot="panel"]') as HTMLElement;

        expect(outer.className).toContain("top-1/2");
        expect(outer.style.transform).toContain("calc(-50% + 0px)");
        expect(panel.className).toContain("w-96");
        expect(panel.className).toContain("max-h-[80vh]");
        expect(panel.className).not.toContain("w-72");
    });

    it("narrow (portrait, #1816) renders a panel NARROWER than the desktop 384px width", () => {
        const { container } = renderStack([makeStackItem("only")], {
            narrow: true,
        });
        const panel = container.querySelector(
            '[data-slot="panel"]'
        ) as HTMLElement;

        expect(panel.className).toContain("w-72");
        expect(panel.className).not.toContain("w-96");
    });

    it("narrow anchors between the midline and the viewer battlefield's own bottom inset — never the desktop's vertical-center + vh-cap", () => {
        // Both edges pinned (top AND bottom, no vertical-center transform):
        // the panel's height is the gap between them, so it can never grow
        // into the hand strip or the bottom bar — the exact clearance
        // guarantee `PORTRAIT_VIEWER_BF_BOTTOM_VAR` already gives the viewer
        // battlefield band itself.
        const { container } = renderStack([makeStackItem("only")], {
            narrow: true,
        });
        const outer = container.firstElementChild as HTMLElement;

        expect(outer.className).toContain("top-[var(--portrait-midline)]");
        expect(outer.className).toContain(
            "bottom-[var(--portrait-viewer-bf-bottom)]"
        );
        expect(outer.className).not.toContain("top-1/2");
        // No `-50%` vertical-center term — the panel is bound by its two
        // pinned edges, not centered-then-capped.
        expect(outer.style.transform).not.toContain("-50%");
    });

    it("`elevated` and `narrow` compose independently — portrait always passes both, but they gate different things", () => {
        const { container } = renderStack([makeStackItem("only")], {
            elevated: true,
            narrow: true,
        });
        const outer = container.firstElementChild as HTMLElement;
        const panel = outer.querySelector('[data-slot="panel"]') as HTMLElement;

        expect(outer.className).toContain("z-chip");
        expect(outer.className).toContain("top-[var(--portrait-midline)]");
        expect(panel.className).toContain("w-72");
    });
});
