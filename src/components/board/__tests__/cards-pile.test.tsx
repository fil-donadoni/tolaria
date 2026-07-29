import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import CardsPile from "../cards-pile";

// Isolate CardsPile's ring/click-gating logic from real card art rendering
// (CardImage hits the card registry + image loader) — stub with a marker div
// carrying the instance id so assertions can target a specific card.
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid={`card-image-${card.id}`} />
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

// Column math (issue #1817), verified against the real classes read off
// GameDialog/Panel at the time of writing:
//   dialog width  = min(100vw - 32px, 90vw)              → 90vw binds above ~320px
//   Panel padding  = p-6 (24px each side)                  = 48px total
//   reveal wrapper = game-dialog.tsx "p-[0.2rem]"          = 6.4px total
//   grid padding   = PILE_GRID_H_PADDING ("px-0 sm:px-2")  = 0px on mobile
//   grid gap       = PILE_GRID_ROW_CLASS ("gap-1 sm:gap-2")= 4px per gap on mobile
// available = dialogWidth - 48 - 6.4 - gridPadding
//   390px viewport: dialogWidth = 0.9*390 = 351   → available = 296.6px
//   360px viewport: dialogWidth = 0.9*360 = 324   → available = 269.6px
// 4 tiles @ 64px (w-16) + 3 gaps @ 4px = 256 + 12 = 268px
//   390px: 268 <= 296.6  (28.6px to spare)
//   360px: 268 <= 269.6  (1.6px to spare — the binding case)
// A 96px (w-24, pre-#1817) or 80px (w-20) tile does NOT fit 4-per-row within
// this same chrome (4*96+3*8=336, 4*80+3*8=344, both far over 269.6px at
// 360px) without also shrinking the shared Panel/GameDialog padding used by
// ~10 other "wide" dialogs — out of scope for this issue's target file
// (cards-pile.tsx only), so 64px (w-16) is the largest tile that reliably
// gets a REAL (not just visually-implied) 4-per-row at both widths.
describe("CardsPile — grid layout mobile density (issue #1817)", () => {
    it("grid tile: shrinks the mobile width (w-16), keeps sm:w-28 unchanged", () => {
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
        // classes (GridCard's outer `flex w-16 sm:w-28 ...` div).
        const tileRoot = wrapper?.parentElement?.parentElement;
        expect(tileRoot?.className).toContain("w-16");
        expect(tileRoot?.className).toContain("sm:w-28");
        expect(tileRoot?.className).not.toContain("w-24");
    });

    it("grid row: shrinks the mobile gap/padding, restores today's spacing at sm:", () => {
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
        // wrapper -> "relative w-full aspect-5/7" -> tile root (w-16 sm:w-28)
        // -> the row div (PILE_GRID_ROW_CLASS + PILE_GRID_H_PADDING).
        const rowDiv = wrapper?.parentElement?.parentElement?.parentElement;
        expect(rowDiv?.className).toContain("gap-1");
        expect(rowDiv?.className).toContain("sm:gap-2");
        expect(rowDiv?.className).toContain("px-0");
        expect(rowDiv?.className).toContain("sm:px-2");
    });

    it("categorized sections reuse the identical row/tile classes as the flat grid (shared constant, not a per-variant copy)", () => {
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
        expect(keeperTile?.className).toContain("w-16");
        expect(keeperTile?.className).toContain("sm:w-28");
        expect(keeperRow?.className).toContain("gap-1");
        expect(keeperRow?.className).toContain("sm:gap-2");

        // "other" matches no category → falls into the trailing "Not
        // keepable" section, same shared row class.
        const otherWrapper = findCardWrapper(baseElement, "other");
        const otherTile = otherWrapper?.parentElement?.parentElement;
        const otherRow = otherTile?.parentElement;
        expect(otherTile?.className).toContain("w-16");
        expect(otherRow?.className).toContain("gap-1");
        expect(otherRow?.className).toContain("sm:gap-2");
    });
});
