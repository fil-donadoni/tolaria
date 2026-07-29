import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PILE_GRID_TILE_PX,
    PILE_GRID_GAP_PX,
    PILE_GRID_TILE_W,
} from "~/lib/card-layout";
import CardsPile from "../cards-pile";

// Isolate CardsPile's ring/click-gating logic from real card art rendering
// (CardImage hits the card registry + image loader) — stub with a marker div
// carrying the instance id so assertions can target a specific card. Also
// surfaces `sizes`/`includeThumb` as data attributes (issue #1817 round 2) so
// the responsive image-sizing tests below can assert on them without
// rendering real Scryfall URLs.
vi.mock("../../cards/card-image", () => ({
    default: ({
        card,
        sizes,
        includeThumb,
    }: {
        card: { id: string };
        sizes?: string;
        includeThumb?: boolean;
    }) => (
        <div
            data-testid={`card-image-${card.id}`}
            data-sizes={sizes}
            data-thumb={String(includeThumb)}
        />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));
// The fan layout's drag-to-pan ref isn't exercised here.
vi.mock("~/hooks/useInertialScroll", () => ({
    useInertialScroll: () => ({ current: null }),
}));

/** jsdom's CSS engine doesn't support `:has()` — the stubbed card-image
 *  marker is always a direct child of its ring/dim wrapper (button or plain
 *  div), so grab the wrapper via `parentElement` instead. */
function findCardWrapper(
    container: HTMLElement,
    id: string
): HTMLElement | null {
    const marker = container.querySelector(`[data-testid="card-image-${id}"]`);
    // Pile cards are wrapped in CardTilt3D (the same hover tilt/glare board
    // cards use), so walk past its two layers to the INTERACTION wrapper —
    // the clickable <button>, the dimmed ineligible <div>, or the slot.
    let el = (marker?.parentElement as HTMLElement | null) ?? null;
    while (
        el &&
        (el.hasAttribute("data-card-tilt") ||
            el.hasAttribute("data-card-tilt-root"))
    ) {
        el = el.parentElement;
    }
    return el;
}

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "library",
        isTapped: false,
    };
}

describe("CardsPile — collapsed stack is open-only (no play-on-open)", () => {
    // Regression: an impulse-exiled card (Headliner Scarlett) whose exile
    // projection carries legalActions used to render as a `SelectableCard` in
    // the COLLAPSED stack, so a single pile click both played the card and
    // opened the reveal dialog. The collapsed stack must be a plain,
    // non-interactive image — the Play/Cast affordance lives in the dialog.
    it("renders a plain card image (not SelectableCard) for a playable pile card", () => {
        const card = makeCard("exiled-1");
        card.zone = "exile";
        card.legalActions = ["cast"];
        const { baseElement } = render(
            <CardsPile cards={[card]} isFaceDown={false} title="Exile" />
        );

        // Collapsed stack (dialog is closed) shows the image marker, never the
        // action-firing SelectableCard.
        expect(
            baseElement.querySelector('[data-testid="card-image-exiled-1"]')
        ).not.toBeNull();
        expect(
            baseElement.querySelector('[data-testid="selectable-card"]')
        ).toBeNull();
    });
});

describe("CardsPile — collapsed zone reveals only the top card (ADR 0026)", () => {
    // The board library zone shows a single top-card peek: `collapsedFaceUpIds`
    // gates the collapsed stack (top card only) while the dialog keeps the full
    // `faceUpIds`. A known card no longer on top reads as a back in the zone.
    it("shows the top card face-up and deeper known cards as backs in the collapsed stack", () => {
        const cards = [makeCard("top"), makeCard("mid"), makeCard("deep")];
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown
                // Dialog would reveal both, but the collapsed zone only the top.
                faceUpIds={new Set(["top", "mid"])}
                collapsedFaceUpIds={new Set(["top"])}
                title="Library"
                topOnRight
            />
        );

        // Collapsed stack (dialog closed): only "top" renders its image; "mid"
        // and "deep" are backs.
        expect(
            baseElement.querySelector('[data-testid="card-image-top"]')
        ).not.toBeNull();
        expect(
            baseElement.querySelector('[data-testid="card-image-mid"]')
        ).toBeNull();
        expect(
            baseElement.querySelector('[data-testid="card-image-deep"]')
        ).toBeNull();
    });

    it("shows only backs when the top card is not known", () => {
        const cards = [makeCard("top"), makeCard("mid")];
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown
                faceUpIds={new Set(["mid"])}
                // Top not known → empty collapsed set → zone is all backs.
                collapsedFaceUpIds={new Set<string>()}
                title="Library"
                topOnRight
            />
        );
        expect(
            baseElement.querySelector('[data-testid="card-image-top"]')
        ).toBeNull();
        expect(
            baseElement.querySelector('[data-testid="card-image-mid"]')
        ).toBeNull();
    });
});

describe("CardsPile — filtered search eligibility (issue #933)", () => {
    it("grid layout: rings and enables clicks only on allow-listed cards", () => {
        const cards = [makeCard("artifact-1"), makeCard("creature-2")];
        const onCardClick = vi.fn();
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={onCardClick}
                eligibleIds={new Set(["artifact-1"])}
            />
        );

        const eligibleWrapper = findCardWrapper(baseElement, "artifact-1");
        expect(eligibleWrapper?.tagName).toBe("BUTTON");
        expect(eligibleWrapper?.className).toContain("ring-signal-pending");

        // Ineligible card renders dimmed and NOT as a clickable button.
        const ineligibleWrapper = findCardWrapper(baseElement, "creature-2");
        expect(ineligibleWrapper?.tagName).not.toBe("BUTTON");
        expect(ineligibleWrapper?.className).toContain("opacity-40");

        eligibleWrapper?.dispatchEvent(
            new MouseEvent("click", { bubbles: true })
        );
        expect(onCardClick).toHaveBeenCalledWith(
            expect.objectContaining({ id: "artifact-1" })
        );
    });

    it("grid layout: an unfiltered search (no eligibleIds) keeps every card selectable", () => {
        const cards = [makeCard("a"), makeCard("b")];
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
            />
        );

        for (const id of ["a", "b"]) {
            const wrapper = findCardWrapper(baseElement, id);
            expect(wrapper?.tagName).toBe("BUTTON");
            expect(wrapper?.className).toContain("ring-signal-pending");
        }
    });

    it("grid layout: a selected card keeps its self ring even under an allow-list", () => {
        const cards = [makeCard("artifact-1")];
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
                eligibleIds={new Set(["artifact-1"])}
                selectedIds={["artifact-1"]}
            />
        );
        const wrapper = findCardWrapper(baseElement, "artifact-1");
        expect(wrapper?.className).toContain("ring-signal-self");
    });

    it("fan layout: rings and enables clicks only on allow-listed cards", () => {
        const cards = [makeCard("artifact-1"), makeCard("creature-2")];
        const onCardClick = vi.fn();
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown={false}
                layout="fan"
                forceOpen
                onCardClick={onCardClick}
                eligibleIds={new Set(["artifact-1"])}
            />
        );

        const eligibleWrapper = findCardWrapper(baseElement, "artifact-1");
        expect(eligibleWrapper?.tagName).toBe("BUTTON");
        expect(eligibleWrapper?.className).toContain("ring-signal-pending");

        const ineligibleWrapper = findCardWrapper(baseElement, "creature-2");
        expect(ineligibleWrapper?.tagName).not.toBe("BUTTON");
        expect(ineligibleWrapper?.className).toContain("opacity-40");
    });
});

describe("CardsPile — collapsed stack flights + depth (zone-change animations)", () => {
    // The collapsed pile participates in the board's shared-layout identity:
    // every rendered card carries a `data-flight-id` keyed by its STABLE
    // instance id (was: every card of a deep pile, keyed by array index), so
    // an arriving card flies in from its previous zone. Only the top few
    // render — deeper cards are visually identical backs / hidden in the fan.
    it("renders at most the top 3 cards of a deep pile", () => {
        const cards = ["a", "b", "c", "d", "e", "f"].map(makeCard);
        const { baseElement } = render(
            <CardsPile cards={cards} isFaceDown={false} title="Graveyard" />
        );
        const flightIds = Array.from(
            baseElement.querySelectorAll<HTMLElement>("[data-flight-id]")
        ).map((el) => el.getAttribute("data-flight-id"));
        expect(flightIds).toEqual(["d", "e", "f"]);
    });

    it("renders every card of a shallow pile", () => {
        const cards = ["a", "b"].map(makeCard);
        const { baseElement } = render(
            <CardsPile cards={cards} isFaceDown={false} title="Graveyard" />
        );
        expect(baseElement.querySelectorAll("[data-flight-id]")).toHaveLength(
            2
        );
    });

    it("plays the arrival glow on the top card only", () => {
        const cards = ["a", "b", "fresh"].map(makeCard);
        const value = {
            recentArrivals: new Set(["fresh"]),
        } as unknown as React.ContextType<typeof GameContext>;
        const { baseElement } = render(
            <GameContext value={value}>
                <CardsPile cards={cards} isFaceDown={false} title="Graveyard" />
            </GameContext>
        );
        const glowed = Array.from(
            baseElement.querySelectorAll<HTMLElement>("[data-arrival-glow]")
        ).map((el) =>
            el.closest("[data-flight-id]")?.getAttribute("data-flight-id")
        );
        expect(glowed).toEqual(["fresh"]);
    });

    it("ignores an arrival id that is buried below the top card", () => {
        const cards = ["buried", "b", "c"].map(makeCard);
        const value = {
            recentArrivals: new Set(["buried"]),
        } as unknown as React.ContextType<typeof GameContext>;
        const { baseElement } = render(
            <GameContext value={value}>
                <CardsPile cards={cards} isFaceDown={false} title="Graveyard" />
            </GameContext>
        );
        expect(
            baseElement.querySelectorAll("[data-arrival-glow]")
        ).toHaveLength(0);
    });
});

// Column math (issue #1817, opus review ROUND 2 — round 1's version of this
// comment omitted the Panel's `border` utility, which IS box-sizing content
// width, so its "1.6px to spare" claim at 360px was actually a ~0.4px
// SHORTFALL; that shape shipped a 64px tile that did not reliably reach 4-per
// -row at 360px). Verified against the real classes read off
// GameDialog/Panel at the time of writing, and asserted executably below
// (not just in prose):
//   dialog width    = min(100vw - 32px, 90vw)                    → 90vw binds above ~320px
//   Panel border    = `border` (1px each side)                     = 2px total
//   Panel padding   = density="compact-mobile" → `p-3` below 420px = 24px total
//   reveal wrapper  = game-dialog.tsx "p-[0.2rem]"                 = 6.4px total
//   grid padding    = PILE_GRID_H_PADDING ("px-0 …")                = 0px below 420px
//   grid gap        = PILE_GRID_ROW_CLASS ("gap-1 …")               = PILE_GRID_GAP_PX (4px) per gap below 420px
// available = dialogWidth - 2 - 24 - 6.4 - gridPadding
//   390px viewport: dialogWidth = 0.9*390 = 351   → available = 318.6px
//   360px viewport: dialogWidth = 0.9*360 = 324   → available = 291.6px
// 4 tiles @ PILE_GRID_TILE_PX (68px) + 3 gaps @ PILE_GRID_GAP_PX (4px)
//   = 272 + 12 = 284px
//   390px: 284 <= 318.6  (34.6px to spare)
//   360px: 284 <= 291.6  (7.6px to spare — the binding case)
// This is only reachable because `GameDialog`'s `density="compact-mobile"`
// (opt-in on CardsPile's own dialog only) shrinks the Panel padding from
// `p-6` (48px total) to `p-3` (24px total) below the SAME 420px breakpoint —
// see PANEL_PADDING_BELOW_420_PX below. A 96px (w-24, pre-#1817) tile does
// NOT fit 4-per-row even with that shrunk padding (4*96+3*4=396, far over
// 291.6px at 360px), and 64px (w-16, round 1's tile) does not clear the
// available width once the border is correctly counted alongside the
// UNSHRUNK p-6 padding round 1 shipped with (4*64+3*4=268 > 267.6 at 360px —
// short by 0.4px). Both problems are what this round fixes: a smaller
// mobile-only Panel padding (density) AND a tile chosen against the
// corrected (border-inclusive) arithmetic.
describe("CardsPile — grid layout mobile density (issue #1817, round 2)", () => {
    it("grid tile: shrinks the mobile width, keeps min-[420px]:w-24 / sm:w-28 unchanged", () => {
        const card = makeCard("card-1");
        const { baseElement } = render(
            <CardsPile
                cards={[card]}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
            />
        );
        const wrapper = findCardWrapper(baseElement, "card-1");
        // wrapper = the clickable/dimmed node inside "relative w-full
        // aspect-5/7"; its grandparent is the tile root carrying the width
        // classes (GridCard's outer `flex ${PILE_GRID_TILE_W} ...` div).
        const tileRoot = wrapper?.parentElement?.parentElement;
        // Compare against the REAL imported constant (not a hand-copied
        // literal) so this test fails loudly if the tile root ever drifts
        // from the shared constant it's supposed to render. (A raw
        // `.not.toContain("w-24 sm:w-28")` isn't useful here — the mobile
        // -compact value legitimately ends in that exact substring, just
        // gated behind `min-[420px]:`, so a substring check can't tell a
        // gated `w-24` from an ungated one; the positive match against the
        // full constant above is the meaningful assertion.)
        expect(tileRoot?.className).toContain(PILE_GRID_TILE_W);
    });

    it("grid row: shrinks the mobile gap/padding, restores today's spacing at min-[420px]:", () => {
        const cards = [makeCard("a"), makeCard("b")];
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
            />
        );
        const wrapper = findCardWrapper(baseElement, "a");
        // wrapper -> "relative w-full aspect-5/7" -> tile root
        // -> the row div (PILE_GRID_ROW_CLASS + PILE_GRID_H_PADDING).
        const rowDiv = wrapper?.parentElement?.parentElement?.parentElement;
        expect(rowDiv?.className).toContain("gap-1");
        expect(rowDiv?.className).toContain("min-[420px]:gap-2");
        expect(rowDiv?.className).toContain("px-0");
        expect(rowDiv?.className).toContain("min-[420px]:px-2");
    });

    it("categorized sections reuse the identical tile class as the flat grid AND cover the categorized layout's OWN PILE_GRID_H_PADDING call site (shared constant, not a per-variant copy)", () => {
        const cards = [makeCard("keeper"), makeCard("other")];
        const categories = [{ label: "Creatures", cardIds: ["keeper"] }];
        const { baseElement } = render(
            <CardsPile
                cards={cards}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
                categories={categories}
            />
        );

        const keeperWrapper = findCardWrapper(baseElement, "keeper");
        const keeperTile = keeperWrapper?.parentElement?.parentElement;
        const keeperRow = keeperTile?.parentElement;
        expect(keeperTile?.className).toContain(PILE_GRID_TILE_W);
        expect(keeperRow?.className).toContain("gap-1");
        expect(keeperRow?.className).toContain("min-[420px]:gap-2");

        // The categorized layout has a SECOND call site of
        // PILE_GRID_H_PADDING — the OUTER `flex flex-col gap-3 py-4
        // {PILE_GRID_H_PADDING}` wrapper, one level further up than the row
        // (categorized rows themselves carry only PILE_GRID_ROW_CLASS, no
        // padding — the padding lives on the wrapper around every section).
        // The flat-grid path folds ROW_CLASS + H_PADDING onto ONE div (see
        // the "grid row" test above), so this second call site is otherwise
        // untested (opus review round 2 finding).
        const categorySectionWrapper = keeperRow?.parentElement; // "flex flex-col gap-1.5" per-section div
        const outerCategorizedWrapper = categorySectionWrapper?.parentElement;
        expect(outerCategorizedWrapper?.className).toContain("px-0");
        expect(outerCategorizedWrapper?.className).toContain(
            "min-[420px]:px-2"
        );

        // "other" matches no category → falls into the trailing "Not
        // keepable" section, same shared row class AND the same outer
        // PILE_GRID_H_PADDING wrapper as "keeper"'s section.
        const otherWrapper = findCardWrapper(baseElement, "other");
        const otherTile = otherWrapper?.parentElement?.parentElement;
        const otherRow = otherTile?.parentElement;
        expect(otherTile?.className).toContain(PILE_GRID_TILE_W);
        expect(otherRow?.className).toContain("gap-1");
        expect(otherRow?.className).toContain("min-[420px]:gap-2");
        expect(otherRow?.parentElement?.parentElement).toBe(
            outerCategorizedWrapper
        );
    });
});

describe("CardsPile — grid layout mobile density arithmetic (issue #1817, round 2)", () => {
    // Layout chrome OUTSIDE this component, restated here as named constants
    // (not prose) so the fit assertion below is executable. `PILE_GRID_TILE_PX`
    // / `PILE_GRID_GAP_PX` are the REAL constants `cards-pile.tsx` renders
    // from (imported above); the Panel/GameDialog numbers below are the
    // classes those modules render (`panel.test.tsx` / `game-dialog.test.tsx`
    // cover them in isolation — see `PanelDensity`'s "compact-mobile" case
    // and `GameDialog`'s `density` passthrough).
    const DIALOG_BORDER_PX = 2; // Panel's `border` utility (1px each side, border-box)
    const PANEL_PADDING_BELOW_420_PX = 24; // `density="compact-mobile"` → `p-3` (12px each side)
    const REVEAL_WRAPPER_PADDING_PX = 6.4; // game-dialog.tsx's `p-[0.2rem]` reveal wrapper (0.2rem = 3.2px each side)
    const GRID_H_PADDING_BELOW_420_PX = 0; // PILE_GRID_H_PADDING's `px-0` branch

    function dialogWidthPx(viewportPx: number): number {
        // GameDialog "wide": w-[calc(100vw - var(--right-piles-w,0) - 2rem)],
        // capped at max-w-[90vw]. --right-piles-w resolves to 0 off-board.
        return Math.min(viewportPx - 32, viewportPx * 0.9);
    }

    function availablePx(viewportPx: number): number {
        return (
            dialogWidthPx(viewportPx) -
            DIALOG_BORDER_PX -
            PANEL_PADDING_BELOW_420_PX -
            REVEAL_WRAPPER_PADDING_PX -
            GRID_H_PADDING_BELOW_420_PX
        );
    }

    it("4 tiles + 3 gaps fit the available width at BOTH 390px and 360px viewports (executable, not prose)", () => {
        const rowPx = 4 * PILE_GRID_TILE_PX + 3 * PILE_GRID_GAP_PX;
        expect(rowPx).toBeLessThanOrEqual(availablePx(390));
        // 360px is the binding constraint — assert the actual margin stays
        // comfortably positive rather than just non-negative, so a future
        // off-by-one doesn't ship a fix that's already at the edge.
        const margin360 = availablePx(360) - rowPx;
        expect(margin360).toBeGreaterThan(0);
        expect(rowPx).toBeLessThanOrEqual(availablePx(360));
    });

    it("PILE_GRID_TILE_W's arbitrary-value literal stays in sync with PILE_GRID_TILE_PX", () => {
        // Tailwind's JIT scanner needs the literal `w-[68px]` text in source
        // (see card-layout.ts's comment) — it can't be interpolated from the
        // numeric constant. This guards against the two silently drifting
        // apart.
        expect(PILE_GRID_TILE_W).toContain(`w-[${PILE_GRID_TILE_PX}px]`);
    });
});

describe("CardsPile — grid tile responsive image sizing (issue #1817, round 2)", () => {
    afterEach(() => {
        window.innerWidth = 1024;
    });

    it("mobile-compact viewport (< 420px): includeThumb flips to true, sizes matches the compact tile", () => {
        window.innerWidth = 390;
        const card = makeCard("card-1");
        const { baseElement } = render(
            <CardsPile
                cards={[card]}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
            />
        );
        const marker = baseElement.querySelector(
            '[data-testid="card-image-card-1"]'
        )!;
        expect(marker.getAttribute("data-thumb")).toBe("true");
        expect(marker.getAttribute("data-sizes")).toBe(
            `${PILE_GRID_TILE_PX}px`
        );
    });

    it("360px viewport: same compact-mobile branch as 390px", () => {
        window.innerWidth = 360;
        const card = makeCard("card-1");
        const { baseElement } = render(
            <CardsPile
                cards={[card]}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
            />
        );
        const marker = baseElement.querySelector(
            '[data-testid="card-image-card-1"]'
        )!;
        expect(marker.getAttribute("data-thumb")).toBe("true");
    });

    it("desktop viewport (>= 640px): includeThumb stays false, sizes matches the sm: tile — unchanged MID-slot behavior", () => {
        window.innerWidth = 800;
        const card = makeCard("card-1");
        const { baseElement } = render(
            <CardsPile
                cards={[card]}
                isFaceDown={false}
                layout="grid"
                forceOpen
                onCardClick={vi.fn()}
            />
        );
        const marker = baseElement.querySelector(
            '[data-testid="card-image-card-1"]'
        )!;
        expect(marker.getAttribute("data-thumb")).toBe("false");
        expect(marker.getAttribute("data-sizes")).toBe("112px");
    });
});

describe("CardsPile — sibling cost/target-picker dialogs share the tile constant, not a hardcoded copy (issue #1817, round 2)", () => {
    // Static source guard (finding: the previous "shared constant" test only
    // asserted that THIS file's two grid modes render matching classNames —
    // true even if both hardcoded an identical independent literal. This
    // proves the 5 SIBLING dialogs actually import the real constant instead
    // of re-typing "w-24 sm:w-28", which is what let the pile browser and the
    // graveyard-target picker drift to different tile sizes on the same
    // phone in the first place.
    const SIBLING_FILES = [
        "../cast-exile-cost-dialog.tsx",
        "../cast-alternative-hand-cost-dialog.tsx",
        "../discard-cost-dialog.tsx",
        "../convoke-creature-dialog.tsx",
        "../graveyard-card-picker.tsx",
    ];

    function readSiblingSource(relativePath: string): string {
        const here = path.dirname(fileURLToPath(import.meta.url));
        return readFileSync(path.join(here, relativePath), "utf8");
    }

    it.each(SIBLING_FILES)(
        "%s imports PILE_GRID_TILE_W from ~/lib/card-layout and no longer hardcodes the literal",
        (relativePath) => {
            const source = readSiblingSource(relativePath);
            expect(source).toMatch(
                /import\s*\{\s*PILE_GRID_TILE_W\s*\}\s*from\s*["']~\/lib\/card-layout["']/
            );
            expect(source).not.toContain("w-24 sm:w-28");
        }
    );
});
