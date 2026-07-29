// Issue #1816: on portrait, `BoardPortraitChips` mounts `GameStack` with
// `narrow` (open-by-default panel) — narrower than the desktop 384px panel,
// and clearance-bound to the midline / viewer-battlefield-bottom rather than
// the desktop's vertically-centered, vh-capped box. This file asserts the
// two width/anchor contracts directly on the real `GameStack` component (not
// the mock used by `board-portrait-chips.test.tsx`), and that the desktop
// (no `narrow`) mount is byte-for-byte unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanup } from "@testing-library/react";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PORTRAIT_STACK_CHIP_H_PX,
    PORTRAIT_STACK_PANEL_GAP_PX,
    PORTRAIT_STACK_PANEL_TOP,
    PORTRAIT_STACK_PANEL_TOP_OFFSET_PX,
    PORTRAIT_VIEWER_BATTLEFIELD_BAND,
} from "~/lib/portrait-board-bands";

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

import GameStack, { NARROW_BOTTOM_CLASS } from "../game-stack";

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

    it("narrow anchors between the (chip-cleared) midline offset and the viewer battlefield's own bottom inset — never the desktop's vertical-center + vh-cap", () => {
        // Both edges pinned (top AND bottom, no vertical-center transform):
        // the panel's height is the gap between them, so it can never grow
        // into the hand strip or the bottom bar — the exact clearance
        // guarantee `PORTRAIT_VIEWER_BF_BOTTOM_VAR` already gives the viewer
        // battlefield band itself. The top edge is `PORTRAIT_STACK_PANEL_TOP`
        // (issue #1816 review fixup finding 2), NOT the bare midline the
        // stack chip itself sits on — see the dedicated describe block below.
        const { container } = renderStack([makeStackItem("only")], {
            narrow: true,
        });
        const outer = container.firstElementChild as HTMLElement;

        expect(outer.className).toContain(PORTRAIT_STACK_PANEL_TOP);
        expect(outer.className).toContain(NARROW_BOTTOM_CLASS);
        expect(outer.className).not.toContain("top-1/2");
        // Never the bare midline on its own — that's what painted over the
        // chip's bottom half pre-fixup.
        expect(outer.className).not.toContain("top-[var(--portrait-midline)]");
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
        expect(outer.className).toContain(PORTRAIT_STACK_PANEL_TOP);
        expect(panel.className).toContain("w-72");
    });

    it("the wrapper is `h-full` (a DEFINITE height) so the Panel's `max-h-full` has something to resolve against, while the Panel itself stays content-height, not forced `h-full` (issue #1816 review fixup round 3, finding 2)", () => {
        // Round 2 gave BOTH the wrapper and the Panel `max-h-full`, reasoning
        // the wrapper "inherited" a definite height from the outer pinned
        // div. It doesn't: a percentage height only resolves against an
        // ancestor with its OWN definite (non-auto) computed height, and
        // `max-height` alone never makes a box's height definite — it only
        // caps whatever height the box would otherwise take. With neither
        // level holding an explicit `height`, the whole chain silently
        // resolved to `max-height: none` and a long stack could overrun
        // `--portrait-viewer-bf-bottom` into the hand / controller bar. The
        // fix restores `h-full` on the WRAPPER only (safe: it has no
        // background, so forcing its box to the full clearance renders
        // nothing extra) — the Panel keeps `max-h-full` (not `h-full`), so a
        // short stack still renders a small box, not an oversized one.
        const { container } = renderStack([makeStackItem("only")], {
            narrow: true,
        });
        const inner = (container.firstElementChild as HTMLElement)
            .firstElementChild as HTMLElement;
        const panel = inner.querySelector('[data-slot="panel"]') as HTMLElement;

        const innerClasses = inner.className.split(/\s+/);
        const panelClasses = panel.className.split(/\s+/);
        expect(innerClasses).toContain("h-full");
        expect(innerClasses).not.toContain("max-h-full");
        expect(panelClasses).toContain("max-h-full");
        expect(panelClasses).not.toContain("h-full");
    });

    describe("issue #1816 review fixup finding 2 — the narrow panel clears the FULL stack chip (44px touch target)", () => {
        it("the panel's top offset past the midline is at least the chip's own half-height plus a real gap", () => {
            // The stack chip straddles the midline (`-translate-y-1/2` on a
            // `top: midline` box in `board-portrait-chips.tsx`) — it occupies
            // [midline - H/2, midline + H/2]. For the panel to clear the
            // WHOLE chip (not just its top half), its top offset past the
            // midline must be >= H/2, with a strictly positive gap on top so
            // the two don't touch.
            const chipHalfHeight = PORTRAIT_STACK_CHIP_H_PX / 2;
            expect(PORTRAIT_STACK_PANEL_TOP_OFFSET_PX).toBeGreaterThan(
                chipHalfHeight
            );
            expect(PORTRAIT_STACK_PANEL_TOP_OFFSET_PX).toBe(
                chipHalfHeight + PORTRAIT_STACK_PANEL_GAP_PX
            );
            expect(PORTRAIT_STACK_PANEL_GAP_PX).toBeGreaterThan(0);
        });

        it("the published `top` class matches that offset arithmetic exactly (guards drift between the number and the literal Tailwind class)", () => {
            const expectedRem = PORTRAIT_STACK_PANEL_TOP_OFFSET_PX / 16;
            expect(PORTRAIT_STACK_PANEL_TOP).toBe(
                `top-[calc(var(--portrait-midline)+${expectedRem}rem)]`
            );
        });
    });

    describe("issue #1816 review fixup round 4 finding 1 — narrow outer div is pointer-events-transparent, Panel restores interactivity", () => {
        it("the narrow outer div carries pointer-events-none so it doesn't swallow taps on the battlefield viewer beneath it", () => {
            const { container } = renderStack([makeStackItem("only")], {
                narrow: true,
            });
            const outer = container.firstElementChild as HTMLElement;

            expect(outer.className).toContain("pointer-events-none");
        });

        it("the Panel restores pointer-events-auto, so the drag handle and stack rows (both Panel descendants) stay interactive", () => {
            const { container } = renderStack([makeStackItem("only")], {
                narrow: true,
            });
            const panel = container.querySelector(
                '[data-slot="panel"]'
            ) as HTMLElement;

            expect(panel.className).toContain("pointer-events-auto");
        });

        it("the desktop (no `narrow`) branch is unaffected — neither pointer-events class appears", () => {
            const { container } = renderStack([makeStackItem("only")]);
            const outer = container.firstElementChild as HTMLElement;
            const panel = outer.querySelector(
                '[data-slot="panel"]'
            ) as HTMLElement;

            expect(outer.className).not.toContain("pointer-events-none");
            expect(panel.className).not.toContain("pointer-events-auto");
        });
    });

    describe("issue #1816 review fixup finding 6 — NARROW_BOTTOM_CLASS is the literal, guarded against the shared constant it must match", () => {
        it("is a literal Tailwind class, not built from a template at this call site", () => {
            // The historical bug: `` `bottom-[var(${VAR})]` `` compiled only
            // because the resolved string happened to already appear,
            // spelled out, elsewhere — Tailwind's JIT scanner greps SOURCE
            // TEXT, it can't see through a `${}` interpolation. Asserting the
            // exact literal here (not re-deriving it from the var name) is
            // itself part of the guard: a future re-template-ification would
            // still pass a runtime string-equality check, so the REAL guard
            // is the substring assertion below, against the shared constant
            // that must contain this exact fragment.
            expect(NARROW_BOTTOM_CLASS).toBe(
                "bottom-[var(--portrait-viewer-bf-bottom)]"
            );
        });

        it("is a verbatim substring of PORTRAIT_VIEWER_BATTLEFIELD_BAND — a refactor of that shared fragment fails HERE instead of silently breaking this class", () => {
            expect(PORTRAIT_VIEWER_BATTLEFIELD_BAND).toContain(
                NARROW_BOTTOM_CLASS
            );
        });

        it("appears verbatim in game-stack.tsx's OWN source text, so Tailwind's scanner generates the CSS from that file alone", () => {
            // Read `game-stack.tsx`'s own source — the guard is specifically
            // that `NARROW_BOTTOM_CLASS`'s definition site no longer depends
            // on ANOTHER file (`portrait-board-bands.ts`) for scannability. A
            // regression back to template-building (`` `bottom-[var(${VAR})]` ``)
            // would still pass the runtime string-equality/substring checks
            // above, but would fail HERE: the literal would no longer appear
            // spelled out in this file's text.
            const moduleUrl = import.meta.url;
            const gameStackSrc = readFileSync(
                new URL("../game-stack.tsx", moduleUrl),
                "utf8"
            );
            expect(gameStackSrc).toContain(
                'bottom-[var(--portrait-viewer-bf-bottom)]"'
            );
        });
    });
});
