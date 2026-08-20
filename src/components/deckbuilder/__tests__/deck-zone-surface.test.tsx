// THE shared deckbuilder zone surface (issue #1622). One component renders the
// Maindeck and the Sideboard of BOTH builders, so this file carries what used
// to be split across `deck-pile-area.test.tsx` (Constructed: count suffix,
// over-limit warning, empty message, remove-on-click, Featured Card) and
// `deckGrouping.test.ts` (the grouping itself, now the Column Layout engine's
// job — asserted here THROUGH the real component rather than against a helper).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import {
    addManualColumn,
    createColumnLayout,
    pinCardToColumn,
    setGrouping,
    makeColumnId,
} from "@convex/deckLayout";
import { makeDeckCardShapeResolver, deckCardLookup } from "~/lib/deckCardShape";
import type { DeckCard } from "~/types/game";
import DeckZoneSurface, {
    type DeckZoneSurfaceProps,
} from "../deck-zone-surface";

// Real registry ids — the engine resolves each card through the card registry.
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1
const SERRA = {
    cardId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    cardName: "Serra Angel",
}; // MV 5
const PLAINS = {
    cardId: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    cardName: "Plains",
}; // land
const MOX = {
    cardId: "8ebe4be7-e12a-4596-a899-fbd5b152e879",
    cardName: "Mox Pearl",
}; // MV 0

// useDroppable/useDraggable require a DragDropProvider in context.
function renderZone(props: Partial<DeckZoneSurfaceProps> = {}) {
    const base: DeckZoneSurfaceProps = {
        zone: "maindeck",
        title: "Maindeck",
        cards: [],
        layout: createColumnLayout(),
        onGroupingChange: () => {},
        onOrderingChange: () => {},
        dropModel: "columns",
        onCardClick: () => {},
        cardTitle: (card) => `Remove ${card.cardName} (drag to move zone)`,
        emptyMessage: "empty",
    };
    return render(
        <DragDropProvider>
            <DeckZoneSurface {...base} {...props} />
        </DragDropProvider>
    );
}

/** Column labels in render order, read off the real DOM. */
function columnLabels(container: HTMLElement): string[] {
    return [...container.querySelectorAll("[data-column]")].map(
        (el) => el.querySelector("span")!.textContent!
    );
}

/** The card names in the column whose Column id is `columnId`. */
function cardsIn(container: HTMLElement, columnId: string): string[] {
    const column = container.querySelector(`[data-column="${columnId}"]`)!;
    return [...column.querySelectorAll("[role=button][title]")].map((el) =>
        el
            .getAttribute("title")!
            .replace(/^Remove /, "")
            .replace(/ \(.*$/, "")
    );
}

describe("DeckZoneSurface — the Maindeck drop model (issue #1622)", () => {
    it("renders the FULL fixed ladder, every column a drop target, even for an empty deck", () => {
        const { container } = renderZone({ cards: [] });
        expect(columnLabels(container)).toEqual([
            "Lands",
            "MV 0",
            "MV 1",
            "MV 2",
            "MV 3",
            "MV 4",
            "MV 5",
            "MV 6",
            "MV 7+",
            // Always last (issue #1633 AC: "the Catch-All is always shown"),
            // regardless of emptiness — the guaranteed narrow-screen landing
            // spot the CSS-hide of every OTHER empty column below `md` relies
            // on existing.
            "Catch-All",
        ]);
    });

    it("buckets each card by its own Mana Value, lands first", () => {
        const { container } = renderZone({
            cards: [BOLT, SERRA, PLAINS, MOX],
        });
        expect(cardsIn(container, "mv:lands")).toEqual(["Plains"]);
        expect(cardsIn(container, "mv:0")).toEqual(["Mox Pearl"]);
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]);
    });

    it("a Card Pin moves a card out of its auto column", () => {
        const { container } = renderZone({
            cards: [BOLT],
            layout: pinCardToColumn(
                createColumnLayout(),
                BOLT.cardId,
                makeColumnId("mv", "6")
            ),
        });
        expect(cardsIn(container, "mv:1")).toEqual([]);
        expect(cardsIn(container, "mv:6")).toEqual(["Lightning Bolt"]);
    });

    it("a Pin into Lands holds a non-Land card there (issue #1573 parity)", () => {
        const { container } = renderZone({
            cards: [BOLT],
            layout: pinCardToColumn(
                createColumnLayout(),
                BOLT.cardId,
                makeColumnId("mv", "lands")
            ),
        });
        expect(cardsIn(container, "mv:lands")).toEqual(["Lightning Bolt"]);
    });

    it("shows the empty hint while STILL rendering the columns as drop targets", () => {
        const { getByText, container } = renderZone({
            cards: [],
            emptyMessage: "Click or drag cards here to add them.",
        });
        expect(getByText("Click or drag cards here to add them.")).toBeTruthy();
        // The fixed ladder (9) plus the always-rendered Catch-All (issue
        // #1633).
        expect(columnLabels(container)).toHaveLength(10);
    });

    it("always renders the Catch-All column, even while empty (issue #1633: it always stays reachable)", () => {
        const { container } = renderZone({ cards: [BOLT] });
        expect(columnLabels(container)).toContain("Catch-All");
        const catchAll = container.querySelector('[data-column="catch-all"]')!;
        expect(catchAll).toBeTruthy();
        // Empty, and CSS-hidden below `md` is deliberately NOT applied to
        // it — no `hidden` class, unlike an empty generated Column (see the
        // "empty columns hidden below md" describe block).
        expect(catchAll.className.split(/\s+/)).not.toContain("hidden");
    });

    it("fires onCardClick with the clicked card", () => {
        const onCardClick = vi.fn();
        const { getByTitle } = renderZone({ cards: [BOLT], onCardClick });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onCardClick).toHaveBeenCalledWith(BOLT);
    });
});

describe("DeckZoneSurface — the Sideboard drop model (issue #1622)", () => {
    it("renders ONLY the columns that hold a card — the pane is the drop target", () => {
        const { container } = renderZone({
            zone: "sideboard",
            title: "Sideboard",
            dropModel: "pane",
            cards: [BOLT, PLAINS],
        });
        expect(columnLabels(container)).toEqual(["Lands", "MV 1"]);
    });

    it("renders the count with its suffix and the over-limit warning", () => {
        const { getByText } = renderZone({
            zone: "sideboard",
            title: "Sideboard",
            dropModel: "pane",
            cards: [BOLT],
            countSuffix: "/15",
            warning: "over limit",
        });
        expect(getByText(/Sideboard 1\/15/)).toBeTruthy();
        expect(getByText("over limit")).toBeTruthy();
    });

    it("shows no warning when none is given (Limited's Sideboard is uncapped)", () => {
        const { queryByText, getByText } = renderZone({
            zone: "sideboard",
            title: "Pool (Sideboard)",
            dropModel: "pane",
            cards: [BOLT],
            warning: null,
        });
        expect(getByText(/Pool \(Sideboard\) 1$/)).toBeTruthy();
        expect(queryByText("over limit")).toBeNull();
    });

    it("renders just the empty message when the zone has no cards", () => {
        const { getByText, container } = renderZone({
            zone: "sideboard",
            dropModel: "pane",
            cards: [],
            emptyMessage: "Move cards here",
        });
        expect(getByText("Move cards here")).toBeTruthy();
        expect(columnLabels(container)).toEqual([]);
    });
});

// Issue #2584 removed BOTH per-card overlay buttons from the shared tile — the
// Featured picker and the "move to…" menu. Their capabilities did not go away:
// they became CTAs of the Peek Panel / Inspect Overlay, which the pair parent
// owns (`deck-zones-surface.tsx`, `deck-zone-peek.tsx`), so they are asserted
// through THAT surface in `deck-phone-panes.test.tsx`. What is asserted here is
// the removal itself — an AC in its own right ("per-card overlay buttons are
// gone at every viewport") — plus the one thing that stayed: the Featured
// INDICATOR, which is a ring, not a button.
describe("DeckZoneSurface — no per-card overlay buttons (issue #2584)", () => {
    it("renders no button inside a card tile — not the Featured picker, not `move to…`", () => {
        const { getAllByTitle } = renderZone({
            cards: [BOLT, BOLT],
            featuredCardId: BOLT.cardId,
            onPin: () => {},
        });
        for (const tile of getAllByTitle(/Remove Lightning Bolt/)) {
            expect(tile.querySelectorAll("button")).toHaveLength(0);
            expect(tile.querySelectorAll("[role=button]")).toHaveLength(0);
        }
    });

    it("still marks the currently-featured card with its indicator ring", () => {
        const { getByTitle } = renderZone({
            cards: [BOLT, PLAINS],
            featuredCardId: BOLT.cardId,
        });
        const bolt = getByTitle(/Remove Lightning Bolt/);
        const plains = getByTitle(/Remove Plains/);
        expect(bolt.querySelectorAll(".ring-accent")).toHaveLength(1);
        expect(plains.querySelectorAll(".ring-accent")).toHaveLength(0);
    });

    it("a right click hands the host the same SELECTION a tap does — the pointer path that replaced the overlay buttons", () => {
        const onCardInspect = vi.fn();
        const { getByTitle } = renderZone({
            cards: [BOLT],
            onCardInspect,
            onPin: () => {},
        });
        fireEvent.contextMenu(getByTitle(/Remove Lightning Bolt/));
        // Not the bare card: the Inspect Overlay's CTA row ("→ Side",
        // "★ Featured") is built from this record, and building it from the
        // touch-only selection instead is what left Featured unreachable at
        // every pointer viewport (PR #2641 review, blocker 2).
        const inspected = onCardInspect.mock.calls[0][0];
        expect(inspected.zone).toBe("maindeck");
        expect(inspected.cardId).toBe(BOLT.cardId);
        expect(inspected.pinKey).toBe(BOLT.cardId);
        expect(
            inspected.columns.map((c: { label: string }) => c.label)
        ).toContain("MV 1");
    });

    it("a click SELECTS instead of moving once the host supplies onCardSelect (the touch path)", () => {
        const onCardClick = vi.fn();
        const onCardSelect = vi.fn();
        const { getByTitle } = renderZone({
            cards: [BOLT],
            onCardClick,
            onCardSelect,
            onPin: () => {},
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onCardClick).not.toHaveBeenCalled();
        expect(onCardSelect).toHaveBeenCalledTimes(1);
        const selection = onCardSelect.mock.calls[0][0];
        expect(selection.zone).toBe("maindeck");
        expect(selection.cardId).toBe(BOLT.cardId);
        expect(selection.pinKey).toBe(BOLT.cardId);
        expect(selection.tileKey).toBe(`mv:1:${BOLT.cardId}:0`);
    });

    // The three guards below are the per-tile `"move to…"` menu's guards
    // (issue #1633, PR #2333 review B1), re-targeted onto the record that
    // REPLACED that menu: `DeckZoneSelection.columns` is what the Peek Panel's
    // "Move to…" sheet lists, so this is the same contract at its new site.
    // The rewrite in PR #2641 had dropped them for `not.toContain("Other")` —
    // a label this surface never produces, so deleting the pin-target filter
    // outright left the suite green (PR #2641 review, blocker 4).
    it("offers EXACTLY the resolved Columns that are PIN TARGETS — generated and manual, EXCLUDING the Catch-All", () => {
        const onCardSelect = vi.fn();
        const layout = addManualColumn(createColumnLayout(), {
            id: "custom:removal",
            label: "Removal",
        });
        const { getByTitle } = renderZone({
            cards: [BOLT],
            layout,
            onCardSelect,
            onPin: () => {},
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));

        const labels = onCardSelect.mock.calls[0][0].columns.map(
            (c: { label: string }) => c.label
        );
        // The full ladder this Zone resolves (`renderZone`'s default `layout`
        // is Grouping `mv`) plus the manual Column — but NOT the Catch-All,
        // which IS rendered on the board (see the "renders the FULL fixed
        // ladder…" test above) and is never offered here: `pinCardToColumn`
        // returns the layout UNCHANGED for its unnamespaced id, so listing it
        // would be an entry that silently does nothing.
        expect(labels).toEqual([
            "Lands",
            "MV 0",
            "MV 1",
            "MV 2",
            "MV 3",
            "MV 4",
            "MV 5",
            "MV 6",
            "MV 7+",
            "Removal",
        ]);
        expect(labels).not.toContain("Catch-All");
    });

    it("under Grouping `none` it offers NO Columns — its single Column is not a pin target either", () => {
        // Grouping `none` resolves to one whole-Zone Column (`all`) plus the
        // Catch-All, and NEITHER is a pin target (`pinNamespaceForGrouping`
        // returns `null` for `none`; the Catch-All is never one). Before the
        // B1 fixup this was the shape where the ENTIRE menu was dead: two
        // entries, both no-ops.
        const onCardSelect = vi.fn();
        const { getByTitle } = renderZone({
            cards: [BOLT],
            layout: setGrouping(createColumnLayout(), "none"),
            onCardSelect,
            onPin: () => {},
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onCardSelect.mock.calls[0][0].columns).toEqual([]);
    });

    it("every offered Column actually changes the layout when pinned — no entry is a reference-identical no-op", () => {
        // Guards exactly the defect B1 found: an entry whose
        // `onPin` -> `pinCardToColumn` round-trip returns the SAME layout
        // reference. Folded through the real engine primitive rather than
        // trusted from the label alone.
        const onCardSelect = vi.fn();
        const layout = addManualColumn(createColumnLayout(), {
            id: "custom:removal",
            label: "Removal",
        });
        const { getByTitle } = renderZone({
            cards: [BOLT],
            layout,
            onCardSelect,
            onPin: () => {},
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));

        const selection = onCardSelect.mock.calls[0][0];
        expect(selection.columns.length).toBeGreaterThan(0);
        for (const column of selection.columns as { id: string }[]) {
            const next = pinCardToColumn(layout, selection.pinKey, column.id);
            expect(next).not.toBe(layout);
            expect(next.pins[selection.pinKey]).toBeDefined();
        }
    });

    it("offers NO Columns on the `pane` drop model — the Sideboard has none to pin into", () => {
        const onCardSelect = vi.fn();
        const { getByTitle } = renderZone({
            cards: [BOLT],
            dropModel: "pane",
            onCardSelect,
            onPin: () => {},
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onCardSelect.mock.calls[0][0].columns).toEqual([]);
    });
});

// A Tabletop (`manual`) deck's pool is the whole Full Catalogue (ADR 0080), so
// its cards are NOT guaranteed to be in the registry. Ported from the retired
// `deckGrouping.test.ts`, now asserted through the engine's `lookup` seam.
describe("DeckZoneSurface — catalogue-only cards (Tabletop, ADR 0080)", () => {
    const CREATURE: DeckCard = {
        cardId: "0d16e8e0-31b2-4389-afd6-783c501f6fa0",
        cardName: "Unimplemented Creature",
    };
    const LAND: DeckCard = {
        cardId: "11111111-2222-3333-4444-555555555555",
        cardName: "Unimplemented Land",
    };

    const catalogueLookup = deckCardLookup(
        makeDeckCardShapeResolver([
            {
                name: CREATURE.cardName,
                printId: CREATURE.cardId,
                typeLine: "Legendary Creature — Elder Dragon",
                manaCost: "{3}{U}{B}{R}",
                cmc: 6,
                colourIdentity: "UBR",
                set: "leg",
                rarity: "rare",
                nameFold: "unimplemented creature",
                available: false,
            },
            {
                name: LAND.cardName,
                printId: LAND.cardId,
                typeLine: "Land — Desert",
                manaCost: "",
                cmc: 0,
                colourIdentity: "",
                set: "arn",
                rarity: "uncommon",
                nameFold: "unimplemented land",
                available: false,
            },
        ]),
        (id) => (id === CREATURE.cardId ? CREATURE.cardName : LAND.cardName)
    );

    it("does not throw on a card the registry has never heard of", () => {
        expect(() => renderZone({ cards: [CREATURE] })).not.toThrow();
    });

    it("buckets a catalogue-only card by its printed mana value", () => {
        const { container } = renderZone({
            cards: [BOLT, CREATURE],
            lookup: catalogueLookup,
        });
        expect(cardsIn(container, "mv:6")).toEqual(["Unimplemented Creature"]);
    });

    it("puts a catalogue-only land in the Lands column", () => {
        const { container } = renderZone({
            cards: [LAND, BOLT],
            lookup: catalogueLookup,
        });
        expect(cardsIn(container, "mv:lands")).toEqual(["Unimplemented Land"]);
    });

    it("collects a card NOTHING can describe into the Catch-All (the old trailing Unknown pile)", () => {
        // No catalogue loaded yet: the registry can't resolve it either.
        const { container } = renderZone({ cards: [BOLT, LAND] });
        expect(columnLabels(container)).toContain("Catch-All");
        expect(cardsIn(container, "catch-all")).toEqual(["Unimplemented Land"]);
    });
});

// Zone build-time filter (PRD #1617, issue #1625, ADR 0075 § "Filter is
// momentary"). BOLT is a Red instant (non-Creature); SERRA is a White
// Creature; PLAINS' colour IDENTITY is White (its produced mana, not its own
// colourless card colour — `getCardColorIdentity`); MOX is a colourless
// artifact.
describe("DeckZoneSurface — Zone build-time filter (issue #1625)", () => {
    it("the creature segment hides non-matching cards WITHOUT moving the remaining siblings' columns", () => {
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA, PLAINS],
        });
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]);

        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );

        // The non-Creature cards vanish from their columns…
        expect(cardsIn(container, "mv:1")).toEqual([]);
        expect(cardsIn(container, "mv:lands")).toEqual([]);
        // …and Serra Angel is still in exactly the column it was already in.
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]);
    });

    it("the non-creatures segment keeps everything but Creatures", () => {
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA, PLAINS],
        });
        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Non-creatures"
            )
        );
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:lands")).toEqual(["Plains"]);
        expect(cardsIn(container, "mv:5")).toEqual([]);
    });

    it("a colour toggle hides a card whose identity doesn't include it", () => {
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA],
        });
        fireEvent.click(getByLabelText("Maindeck colour R"));
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:5")).toEqual([]);
    });

    it("colour toggles combine with the creature segment by AND (issue #1625 AC)", () => {
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA, PLAINS],
        });
        // Creatures ∩ White — Serra Angel qualifies, Plains (White identity,
        // but not a Creature) does not.
        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );
        fireEvent.click(getByLabelText("Maindeck colour W"));
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]);
        expect(cardsIn(container, "mv:lands")).toEqual([]);
    });

    it("shows `<shown> of <total>` while the filter is active, and the plain total once cleared", () => {
        const { getByText, getByLabelText } = renderZone({
            cards: [BOLT, SERRA, PLAINS],
        });
        expect(getByText("Maindeck 3")).toBeTruthy();

        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );
        expect(getByText("Maindeck 1 of 3")).toBeTruthy();

        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText("All")
        );
        expect(getByText("Maindeck 3")).toBeTruthy();
    });

    it("renders a clearable chip only while the filter is active, and clears it in one click", () => {
        const { queryByLabelText, getByLabelText, getByText } = renderZone({
            cards: [BOLT, SERRA],
        });
        expect(queryByLabelText(/Clear Maindeck filter/)).toBeNull();

        fireEvent.click(getByLabelText("Maindeck colour R"));
        expect(getByText("Maindeck 1 of 2")).toBeTruthy();
        const chip = getByLabelText("Clear Maindeck filter: R");
        expect(chip).toBeTruthy();

        fireEvent.click(chip);
        expect(getByText("Maindeck 2")).toBeTruthy();
        expect(queryByLabelText(/Clear Maindeck filter/)).toBeNull();
    });

    it("a card the catalogue cannot classify is never hidden by the filter", () => {
        // No `lookup` supplied and the id is unregistered — the engine already
        // routes it to the Catch-All; the filter must not ALSO make it vanish.
        const UNKNOWN = { cardId: "does-not-exist", cardName: "Mystery Card" };
        const { container, getByLabelText } = renderZone({
            cards: [UNKNOWN],
        });
        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );
        expect(cardsIn(container, "catch-all")).toEqual(["Mystery Card"]);
    });

    it("filtering one Zone never affects the other — independent React state per instance", () => {
        const { container: main } = renderZone({
            zone: "maindeck",
            title: "Maindeck",
            cards: [BOLT, SERRA],
        });
        const { container: side } = renderZone({
            zone: "sideboard",
            title: "Sideboard",
            dropModel: "pane",
            cards: [BOLT, SERRA],
        });

        fireEvent.click(
            within(
                main.querySelector('[aria-label="Maindeck creature filter"]')!
            ).getByText("Creatures")
        );

        expect(cardsIn(main, "mv:1")).toEqual([]); // Maindeck filtered
        expect(cardsIn(side, "mv:1")).toEqual(["Lightning Bolt"]); // Sideboard untouched
    });

    it("never changes the deck's own data: the caller's `cards` prop is untouched by filtering", () => {
        const cards = [BOLT, SERRA, PLAINS];
        const { getByLabelText } = renderZone({ cards });
        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );
        // The prop array itself — what a caller's save/legality logic reads —
        // is the same reference with the same three cards, unfiltered.
        expect(cards).toHaveLength(3);
        expect(cards.map((c) => c.cardName)).toEqual([
            "Lightning Bolt",
            "Serra Angel",
            "Plains",
        ]);
    });

    it("the filter resets on remount — reopening the deckbuilder always shows everything (issue #1625 AC)", () => {
        const props = { cards: [BOLT, SERRA] };
        const first = renderZone(props);
        fireEvent.click(
            within(first.getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );
        expect(first.getByText("Maindeck 1 of 2")).toBeTruthy();
        first.unmount();

        // A fresh mount — the only way this component is ever "reopened" — has
        // no memory of the previous instance's filter, because the filter was
        // never written anywhere outside this component's own React state.
        const second = renderZone(props);
        expect(second.getByText("Maindeck 2")).toBeTruthy();
        expect(second.queryByText(/of 2/)).toBeNull();
    });
});

// PR #2313 review, F1: the filtered `items` used to feed
// `resolveColumnLayout` directly, so under Grouping `type` — the one
// Grouping whose Column SET depends on which types are PRESENT
// (`generateColumns`, `convex/deckLayout.ts`) — a filter silently changed
// which Columns exist, moving a Card Pin's target out from under it even
// though the pinned card still matched the filter. `mv`/`color` generate a
// fixed ladder regardless of the cards present, so they were never exposed
// to this; these tests exercise `type` (where the bug lived) and `color`
// (to prove the fixed-ladder Groupings stay correct with a Pin in play too,
// per the review's N3 finding that filter coverage was `mv`-only).
describe("DeckZoneSurface — filter narrows CONTENTS, never the Column SET (issue #2313 review, F1)", () => {
    it("Grouping `type`: the Column SET survives a filter that empties one of them", () => {
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA, PLAINS],
            layout: setGrouping(createColumnLayout(), "type"),
        });
        expect(columnLabels(container)).toEqual([
            "Lands",
            "Creature",
            "Instant",
            "Catch-All",
        ]);

        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );

        // Bolt (Instant) is hidden by the filter — but the Instant Column
        // itself must still render as an empty drop target, not disappear.
        expect(columnLabels(container)).toEqual([
            "Lands",
            "Creature",
            "Instant",
            "Catch-All",
        ]);
        expect(cardsIn(container, "type:instant")).toEqual([]);
        expect(cardsIn(container, "type:creature")).toEqual(["Serra Angel"]);
    });

    it("Grouping `type`: a Card Pin naming a Column the filter would otherwise eliminate still applies", () => {
        // Serra Angel (a Creature) is pinned into the Instant Column — as if
        // dragged there. It still MATCHES a Creature filter, so it must stay
        // exactly where it's pinned; it must not fall through to its
        // predicate Column (Creature) just because Bolt, the only OTHER
        // Instant, gets hidden by the same filter.
        const layout = pinCardToColumn(
            setGrouping(createColumnLayout(), "type"),
            SERRA.cardId,
            makeColumnId("type", "instant")
        );
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA, PLAINS],
            layout,
        });
        // Unfiltered: Bolt lands in Instant on its OWN predicate; Serra sits
        // there too, but via its Pin rather than its (Creature) predicate.
        expect(cardsIn(container, "type:instant")).toEqual([
            "Lightning Bolt",
            "Serra Angel",
        ]);

        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );

        expect(columnLabels(container)).toContain("Instant");
        expect(cardsIn(container, "type:instant")).toEqual(["Serra Angel"]);
        // Serra did NOT fall through to the Catch-All (which always renders,
        // issue #1633, but must hold nothing here) or to its predicate Column
        // (Creature) — the Pin still names a Column that exists.
        expect(cardsIn(container, "type:creature")).toEqual([]);
        expect(cardsIn(container, "catch-all")).toEqual([]);
    });

    it("Grouping `color`: a fixed-ladder Grouping stays correct under a filter, with a Pin in play", () => {
        // Serra Angel (mono-White) pinned into the Multicolour Column,
        // despite not matching its predicate — proves a Pin still overrides
        // the predicate once a filter is active, for a Grouping whose ladder
        // is not cards-dependent (control case for the `type` fix above).
        const layout = pinCardToColumn(
            setGrouping(createColumnLayout(), "color"),
            SERRA.cardId,
            makeColumnId("color", "multicolor")
        );
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA],
            layout,
        });
        expect(cardsIn(container, "color:multicolor")).toEqual(["Serra Angel"]);

        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );

        // Bolt (Red, non-Creature) is hidden; the Red Column stays rendered
        // but empty, and Serra's Pin still holds.
        expect(columnLabels(container)).toContain("Red");
        expect(cardsIn(container, "color:R")).toEqual([]);
        expect(cardsIn(container, "color:multicolor")).toEqual(["Serra Angel"]);
    });
});

// PR #2313 review, N1: `${visible} of ${total}${countSuffix}` reads as
// `"1 of 2/15"` on the Constructed Sideboard — the `of`-counter runs
// straight into the `x/15` legality cap with no separator between them.
describe("DeckZoneSurface — header count text with a countSuffix + active filter (issue #2313 review, N1)", () => {
    it("spells out shown/total instead of concatenating the filtered count onto the cap", () => {
        const { getByText, queryByText, getByLabelText } = renderZone({
            zone: "sideboard",
            title: "Sideboard",
            dropModel: "pane",
            cards: [BOLT, SERRA],
            countSuffix: "/15",
        });

        fireEvent.click(getByLabelText("Sideboard colour R"));

        expect(getByText("Sideboard 1 shown, 2/15 total")).toBeTruthy();
        // The old, collision-prone rendering must be gone.
        expect(queryByText(/1 of 2\/15/)).toBeNull();
    });
});

describe("DeckZoneSurface — column management (ADR 0075 §2, issue #1626)", () => {
    it("offers no add/rename/delete affordance at all when the host declares none", () => {
        // The reduced draft-time bar (ADR 0075 §6) and the Sideboard both take
        // this path: column management is a workbench gesture, not a
        // timed-draft one, and a manual Column in a whole-pane drop zone could
        // never receive a card.
        const { queryByLabelText } = renderZone({ cards: [BOLT] });
        expect(queryByLabelText("Add Maindeck column")).toBeNull();
        expect(queryByLabelText(/Delete column/)).toBeNull();
    });

    it("a card that would have matched a DELETED column falls to the Catch-All when it arrives later", () => {
        // PRD #1617 story 22, at the surface: the Column is deleted while
        // EMPTY, and the 5-drop only shows up afterwards — the case the
        // empty-only rule leaves open, and the Catch-All answers.
        const layout = { ...createColumnLayout(), removedColumnIds: ["mv:5"] };
        const { container, rerender } = render(
            <DragDropProvider>
                <DeckZoneSurface
                    zone="maindeck"
                    title="Maindeck"
                    cards={[BOLT]}
                    layout={layout}
                    onGroupingChange={() => {}}
                    onOrderingChange={() => {}}
                    dropModel="columns"
                    onCardClick={() => {}}
                    cardTitle={(card) => `Remove ${card.cardName}`}
                    emptyMessage="empty"
                />
            </DragDropProvider>
        );
        expect(columnLabels(container)).not.toContain("MV 5");
        // The Catch-All itself always renders (issue #1633), holding nothing
        // yet.
        expect(cardsIn(container, "catch-all")).toEqual([]);

        rerender(
            <DragDropProvider>
                <DeckZoneSurface
                    zone="maindeck"
                    title="Maindeck"
                    cards={[BOLT, SERRA]}
                    layout={layout}
                    onGroupingChange={() => {}}
                    onOrderingChange={() => {}}
                    dropModel="columns"
                    onCardClick={() => {}}
                    cardTitle={(card) => `Remove ${card.cardName}`}
                    emptyMessage="empty"
                />
            </DragDropProvider>
        );
        expect(cardsIn(container, "catch-all")).toEqual(["Serra Angel"]);
        expect(columnLabels(container).at(-1)).toBe("Catch-All");
    });

    // The one place the filter and the delete rule meet. A filter HIDES cards
    // without emptying a Column, so judging deletability on what is currently
    // VISIBLE would let a filter authorise a deletion that displaces the very
    // cards it is hiding — and "deleting can never lose a card" (ADR 0075
    // rationale §2) is the entire justification for the empty-only rule.
    it("an active filter can NEVER make a non-empty column deletable", () => {
        const { container, getByLabelText } = renderZone({
            cards: [BOLT, SERRA],
            onAddColumn: () => {},
            onRenameColumn: () => {},
            onDeleteColumn: () => {},
        });
        expect(
            (getByLabelText(/^Delete column MV 3$/) as HTMLButtonElement)
                .disabled
        ).toBe(false);
        expect(
            (getByLabelText(/Cannot delete column MV 1/) as HTMLButtonElement)
                .disabled
        ).toBe(true);

        // Hide the Instant. Its column now LOOKS empty…
        fireEvent.click(
            within(getByLabelText("Maindeck creature filter")).getByText(
                "Creatures"
            )
        );
        expect(cardsIn(container, "mv:1")).toEqual([]);
        // …and is still not deletable, because the card is only hidden.
        expect(
            (getByLabelText(/Cannot delete column MV 1/) as HTMLButtonElement)
                .disabled
        ).toBe(true);
    });

    it("pins a card into a manual column per COPY when the entries carry a pin key", () => {
        // The Limited identity model (ADR 0075 §4): two physical copies of one
        // card, filed in two different Columns. A `cardId`-keyed surface
        // cannot express this at all — both copies would follow one Pin.
        let layout = createColumnLayout({
            manualColumns: [{ id: "custom:removal", label: "Removal" }],
        });
        layout = pinCardToColumn(layout, "1", "custom:removal");
        const { container } = renderZone({
            // The per-copy key travels ON THE ENTRY, exactly as the Limited
            // builder's `String(poolIndex)` does (issue #1626).
            cards: [
                { ...BOLT, pinKey: "0" },
                { ...BOLT, pinKey: "1" },
            ],
            layout,
        });
        expect(cardsIn(container, "custom:removal")).toEqual([
            "Lightning Bolt",
        ]);
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
    });
});

describe("DeckZoneSurface — narrow-screen refinements (issue #1633)", () => {
    it("CSS-hides an empty Column below `md`, but never a non-empty one or the Catch-All", () => {
        // MV 1 holds Bolt (non-empty); MV 0 holds nothing (empty); the
        // Catch-All holds nothing too, but is exempt.
        const { container } = renderZone({ cards: [BOLT] });
        const emptyGenerated = container.querySelector('[data-column="mv:0"]')!;
        const nonEmpty = container.querySelector('[data-column="mv:1"]')!;
        const catchAll = container.querySelector('[data-column="catch-all"]')!;

        expect(emptyGenerated.className.split(/\s+/)).toEqual(
            expect.arrayContaining(["hidden", "md:flex"])
        );
        expect(nonEmpty.className.split(/\s+/)).not.toContain("hidden");
        expect(catchAll.className.split(/\s+/)).not.toContain("hidden");
    });

    it("the `pane` drop model (Sideboard) never emits the hide class — an empty column there is simply not mounted", () => {
        const { container } = renderZone({ cards: [BOLT], dropModel: "pane" });
        // `mv:0` never mounts at all under `pane` (unchanged pre-#1633
        // behaviour) — nothing to CSS-hide.
        expect(container.querySelector('[data-column="mv:0"]')).toBeNull();
        const nonEmpty = container.querySelector('[data-column="mv:1"]')!;
        expect(nonEmpty.className.split(/\s+/)).not.toContain("hidden");
    });

    it("the scroll strip and every Column carry the scroll-snap classes, scoped to BELOW `md` (AC 1) — desktop stays unsnapped (AC 3)", () => {
        const { container } = renderZone({ cards: [BOLT] });
        const strip = container.querySelector(
            '[data-column="mv:1"]'
        )!.parentElement!;
        // Snap is armed below `md`...
        expect(strip.className.split(/\s+/)).toEqual(
            expect.arrayContaining(["snap-x", "snap-mandatory"])
        );
        // ...and explicitly disarmed AT `md` and above — desktop must not
        // pick up a scroll-snap behaviour nobody asked for (PR #2333 review,
        // B2), and it must not fight dnd-kit's own auto-scroll on the same
        // container during a drag.
        expect(strip.className.split(/\s+/)).toContain("md:snap-none");
        const column = container.querySelector('[data-column="mv:1"]')!;
        expect(column.className.split(/\s+/)).toContain("snap-start");
        expect(column.className.split(/\s+/)).toContain("md:snap-align-none");
    });

    it("a card tile allows native horizontal panning — a quick swipe must still scroll the strip (issue #1633 bundled finding, ADR 0009)", () => {
        // `touch-none` on the tile would block the browser from ever
        // recognising a touch starting on a card as a scroll, regardless of
        // the drag sensor's own 250ms Delay constraint (PR #2333 review,
        // bundled finding 1) — the same class of bug `board-hand-card.tsx`'s
        // `allowHorizontalPan` fixes for the portrait hand (issue #1994).
        const { getByTitle } = renderZone({ cards: [BOLT] });
        const tile = getByTitle(/Remove Lightning Bolt/);
        const classes = tile.className.split(/\s+/);
        expect(classes).toContain("touch-pan-x");
        expect(classes).not.toContain("touch-none");
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The REDUCED bar (ADR 0075 §6, issue #1632). The draft-time Pool mounts this
// same component and differs only in what it declines to offer, so the
// "absent ⇒ no affordance" contract is asserted here, once, rather than only
// through the draft that relies on it.
// ────────────────────────────────────────────────────────────────────────────
describe("DeckZoneSurface — reduced bar (ADR 0075 §6, issue #1632)", () => {
    it("renders the Grouping/Ordering controls when the handlers are supplied", () => {
        const { getByLabelText } = renderZone();
        expect(getByLabelText("Maindeck grouping")).toBeTruthy();
        expect(getByLabelText("Maindeck ordering")).toBeTruthy();
    });

    it("renders NO Grouping/Ordering control when the handlers are absent", () => {
        const { queryByLabelText } = renderZone({
            onGroupingChange: undefined,
            onOrderingChange: undefined,
        });
        expect(queryByLabelText("Maindeck grouping")).toBeNull();
        expect(queryByLabelText("Maindeck ordering")).toBeNull();
    });

    it("renders the filter affordances by default", () => {
        const { getByLabelText } = renderZone();
        expect(getByLabelText("Maindeck creature filter")).toBeTruthy();
        expect(getByLabelText("Maindeck colour filter")).toBeTruthy();
    });

    it("`filterable={false}` removes every filter affordance and keeps the plain count", () => {
        const { queryByLabelText, getByText } = renderZone({
            filterable: false,
            cards: [BOLT, SERRA],
        });
        expect(queryByLabelText("Maindeck creature filter")).toBeNull();
        expect(queryByLabelText("Maindeck colour filter")).toBeNull();
        // No filter can be active, so the header never shows an "N of M"
        // subset count or a clear-chip.
        expect(getByText(/^Maindeck 2$/)).toBeTruthy();
    });

    it("`filterable={false}` still renders every card — nothing is hidden", () => {
        const { container } = renderZone({
            filterable: false,
            cards: [BOLT, SERRA, PLAINS],
        });
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]);
        expect(cardsIn(container, "mv:lands")).toEqual(["Plains"]);
    });
});

// Issue #2056: `Pool (Sideboard) N` wrapped to 3 lines / 72px in an 82px pane
// at the 852x303 baseline — the pane's own header alone consumed 88% of the
// available height. Guarded on `PoolSideboardPile` until issue #1632 retired
// that component; the behaviour still ships, here, so the test moved with it.
describe("DeckZoneSurface — title truncation (issue #2056)", () => {
    it("the title span truncates to one line instead of wrapping", () => {
        const { getByText } = renderZone({
            title: "Pool (Sideboard)",
            dropModel: "pane",
        });
        const titleSpan = getByText(/^Pool \(Sideboard\) 0/);
        expect(titleSpan.className.split(/\s+/)).toContain("truncate");
        // `truncate` only takes effect on a shrinkable flex item — the header
        // row itself must allow the title to shrink below its content width
        // (min-w-0), or the class is a no-op.
        const headerRow = titleSpan.parentElement as HTMLElement;
        expect(headerRow.className.split(/\s+/)).toContain("min-w-0");
    });
});
