// Issue #2589: landscape-compact gets its own chip-triggered right panel
// (ADR 0101 §8 — "the stack ... reproduces the desktop rows ... as a bottom
// sheet from the Stack chip in portrait and a right panel in landscape"),
// toggled from `ControllerLandscapeStrip`. This asserts the `landscape`
// variant's width/anchor contract directly on the real `GameStack` (mirroring
// `game-stack-narrow.test.tsx`'s pattern for `narrow`), and that neither the
// desktop nor the narrow/portrait mount is disturbed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    BESIDE_CONTROLLER_STRIP,
    CONTROLLER_STRIP_CLEARANCE_EXPR,
} from "~/lib/controller-bar-metrics";

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
    props: {
        elevated?: boolean;
        narrow?: boolean;
        landscape?: boolean;
        landscapePileClearancePx?: number;
    } = {}
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

describe("GameStack landscape variant (issue #2589)", () => {
    it("renders a panel NARROWER than the desktop 384px width, same as narrow", () => {
        const { container } = renderStack([makeStackItem("only")], {
            landscape: true,
        });
        const panel = container.querySelector(
            '[data-slot="panel"]'
        ) as HTMLElement;

        expect(panel.className).toContain("w-72");
        expect(panel.className).not.toContain("w-96");
    });

    it("keeps the desktop's vertical-center + vh-cap shape, never the narrow edge-pinned box", () => {
        const { container } = renderStack([makeStackItem("only")], {
            landscape: true,
        });
        const outer = container.firstElementChild as HTMLElement;
        const panel = outer.querySelector('[data-slot="panel"]') as HTMLElement;

        expect(outer.className).toContain("top-1/2");
        expect(outer.style.transform).toContain("calc(-50% + 0px)");
        expect(panel.className).toContain("max-h-[80vh]");
        // Never the narrow-only pinned-edge classes.
        expect(outer.className).not.toContain("pointer-events-none");
        expect(panel.className).not.toContain("max-h-full");
        expect(panel.className).not.toContain("pointer-events-auto");
    });

    it("anchors BESIDE the control strip via the measured-width seam, not the desktop's fixed right inset", () => {
        const { container } = renderStack([makeStackItem("only")], {
            landscape: true,
        });
        const outer = container.firstElementChild as HTMLElement;

        expect(outer.className).toContain(BESIDE_CONTROLLER_STRIP);
        // The inline `right: 0.5rem` desktop/narrow both carry is OMITTED —
        // BESIDE_CONTROLLER_STRIP's class supplies `right` instead, and an
        // inline style would win the cascade over it.
        expect(outer.style.right).toBe("");
    });

    it("clears the pile column when landscapePileClearancePx is given (round-2 review finding 6)", () => {
        // Without this, the panel anchors at the SAME `BESIDE_CONTROLLER_STRIP`
        // seam the pile column docks at, and — being wider and higher
        // z-index — paints directly over graveyard/library/exile, making
        // them unclickable for as long as anything sits on the stack.
        const { container } = renderStack([makeStackItem("only")], {
            landscape: true,
            landscapePileClearancePx: 36,
        });
        const outer = container.firstElementChild as HTMLElement;

        // The inline style now WINS the cascade over BESIDE_CONTROLLER_STRIP's
        // class-supplied `right` — the class stays present (harmless, just
        // overridden), but the computed offset includes the extra 36px.
        expect(outer.className).toContain(BESIDE_CONTROLLER_STRIP);
        expect(outer.style.right).toBe(
            `calc(${CONTROLLER_STRIP_CLEARANCE_EXPR} + 36px)`
        );
    });

    it("`elevated` and `landscape` compose independently, same tier rule as `narrow`", () => {
        const { container } = renderStack([makeStackItem("only")], {
            elevated: true,
            landscape: true,
        });
        const outer = container.firstElementChild as HTMLElement;

        expect(outer.className).toContain("z-stack");
        expect(outer.className).not.toContain("z-chip");
        expect(outer.className).not.toMatch(/\bz-modal\b/);
    });

    it("the desktop (no `narrow`, no `landscape`) mount is unaffected", () => {
        const { container } = renderStack([makeStackItem("only")]);
        const outer = container.firstElementChild as HTMLElement;
        const panel = outer.querySelector('[data-slot="panel"]') as HTMLElement;

        expect(outer.className).not.toContain(BESIDE_CONTROLLER_STRIP);
        expect(outer.style.right).toBe("0.5rem");
        expect(panel.className).toContain("w-96");
    });
});
