// THE shared deckbuilder zone surface (issue #1622). One component renders the
// Maindeck and the Sideboard of BOTH builders, so this file carries what used
// to be split across `deck-pile-area.test.tsx` (Constructed: count suffix,
// over-limit warning, empty message, remove-on-click, Featured Card) and
// `deckGrouping.test.ts` (the grouping itself, now the Column Layout engine's
// job — asserted here THROUGH the real component rather than against a helper).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import {
    createColumnLayout,
    pinCardToColumn,
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
        expect(columnLabels(container)).toHaveLength(9);
    });

    it("never renders an empty Catch-All column", () => {
        const { container } = renderZone({ cards: [BOLT] });
        expect(columnLabels(container)).not.toContain("Catch-All");
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

// Featured Card picker (PRD #589, issue #599) — ported verbatim in intent from
// the retired `deck-pile-area.test.tsx`, since the affordance moved onto the
// shared tile. The Constructed Maindeck wires it; nothing else does.
describe("DeckZoneSurface — Featured Card picker (issue #599)", () => {
    it("renders no featured affordance when onSetFeatured is absent", () => {
        const { queryByTitle } = renderZone({ cards: [BOLT] });
        expect(queryByTitle(/featured/i)).toBeNull();
    });

    it("fires onSetFeatured with the card id when the affordance is clicked", () => {
        const onSetFeatured = vi.fn();
        const { getByTitle } = renderZone({ cards: [BOLT], onSetFeatured });
        fireEvent.click(getByTitle("Set as featured card"));
        expect(onSetFeatured).toHaveBeenCalledWith(BOLT.cardId);
    });

    it("picking the featured card does NOT also remove a copy (stopPropagation)", () => {
        const onCardClick = vi.fn();
        const onSetFeatured = vi.fn();
        const { getByTitle } = renderZone({
            cards: [BOLT],
            onCardClick,
            onSetFeatured,
        });
        fireEvent.click(getByTitle("Set as featured card"));
        expect(onSetFeatured).toHaveBeenCalledTimes(1);
        expect(onCardClick).not.toHaveBeenCalled();
    });

    it("marks the currently-featured card (persistent indicator across reloads)", () => {
        const { getByTitle, queryByTitle } = renderZone({
            cards: [BOLT, PLAINS],
            featuredCardId: BOLT.cardId,
            onSetFeatured: vi.fn(),
        });
        expect(getByTitle("Featured card — click to clear")).toBeTruthy();
        expect(queryByTitle("Set as featured card")).toBeTruthy();
    });

    it("offers the affordance on the TOPMOST copy only", () => {
        const { getAllByTitle } = renderZone({
            cards: [BOLT, BOLT, BOLT],
            onSetFeatured: vi.fn(),
        });
        expect(getAllByTitle("Set as featured card")).toHaveLength(1);
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
