// The setup flow's deck grid (PRD #5334 stories 29–36, issue #5341): Match
// Format admission, deck-or-card search, the Freeform Format select.
import { describe, expect, it } from "vitest";
import type { LobbyDeck } from "../deckTypes";
import {
    deckGrid,
    deckSearchHit,
    freeformFormatOptions,
    groupByLimitedOrigin,
    limitedOriginOptions,
    UNCLASSIFIED_ORIGIN_LABEL,
} from "../matchSetupDeckGrid";

const card = (cardName: string) => ({
    cardId: cardName.toLowerCase().replace(/ /g, "-"),
    cardName,
    definitionId: cardName,
});

function deck(overrides: Partial<LobbyDeck>): LobbyDeck {
    return {
        kind: "preset",
        presetId: "deck",
        name: "Deck",
        format: "premodern",
        colors: ["R"],
        cards: [],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

const burn = deck({
    presetId: "burn",
    name: "Burn",
    cards: [card("Lightning Bolt")],
    sideboard: [card("Pyroblast")],
});
const enchantress = deck({
    kind: "user",
    presetId: "ench",
    name: "Enchantress",
    cards: [card("Argothian Enchantress"), card("Solitary Confinement")],
} as Partial<LobbyDeck>);
const atog = deck({
    presetId: "atog",
    name: "Atog",
    format: "old-school",
    cards: [card("Atog")],
});
const pile = deck({ presetId: "pile", name: "Pile", format: "manual" });
const DECKS = [burn, enchantress, atog, pile];

const ids = (g: ReturnType<typeof deckGrid>) => [
    ...g.mine.map((e) => e.deck.presetId),
    ...g.presets.map((e) => e.deck.presetId),
];

describe("deckSearchHit — deck or card name, case-insensitive", () => {
    it("a deck-name hit names no card", () => {
        expect(deckSearchHit(burn, "bUR")).toEqual({ matchedCard: null });
    });

    it("a card-name hit names the card", () => {
        expect(deckSearchHit(enchantress, "SOLITARY")).toEqual({
            matchedCard: "Solitary Confinement",
        });
    });

    it("searches the sideboard too", () => {
        expect(deckSearchHit(burn, "pyrob")).toEqual({
            matchedCard: "Pyroblast",
        });
    });

    it("a miss is null; a blank query matches everything", () => {
        expect(deckSearchHit(burn, "counterspell")).toBeNull();
        expect(deckSearchHit(burn, "   ")).toEqual({ matchedCard: null });
    });
});

describe("deckGrid — what steps 4 and 5 offer", () => {
    it("offers only the decks the Match Format admits, split mine / presets", () => {
        const g = deckGrid(DECKS, "premodern", "");
        expect(g.mine.map((e) => e.deck.presetId)).toEqual(["ench"]);
        expect(g.presets.map((e) => e.deck.presetId)).toEqual(["burn"]);
    });

    it("Freeform admits every playable deck, never Manual", () => {
        expect(ids(deckGrid(DECKS, "freeform", ""))).toEqual([
            "ench",
            "burn",
            "atog",
        ]);
    });

    it("narrows by search, carrying the matched card", () => {
        const g = deckGrid(DECKS, "freeform", "bolt");
        expect(ids(g)).toEqual(["burn"]);
        expect(g.presets[0].matchedCard).toBe("Lightning Bolt");
    });

    it("the Freeform Format select narrows to one Deck Format", () => {
        expect(ids(deckGrid(DECKS, "freeform", "", "old-school"))).toEqual([
            "atog",
        ]);
    });

    it("the Format select is ignored outside Freeform", () => {
        expect(ids(deckGrid(DECKS, "premodern", "", "old-school"))).toEqual([
            "ench",
            "burn",
        ]);
    });

    it("an illegal deck is shown but not selectable", () => {
        const broken = deck({ presetId: "broken", isLegal: false });
        const g = deckGrid([broken], "premodern", "");
        expect(g.presets).toEqual([
            { deck: broken, matchedCard: null, selectable: false },
        ]);
    });
});

describe("freeformFormatOptions — the Freeform select", () => {
    it("lists the Formats of the admitted decks, in canonical order", () => {
        expect(freeformFormatOptions(DECKS)).toEqual([
            "old-school",
            "premodern",
        ]);
    });
});

describe("Limited Origin grouping (issue #5394)", () => {
    const limited = (id: string, limitedOrigin?: string) =>
        deck({
            kind: "user",
            presetId: id,
            name: id,
            format: "limited",
            limitedOrigin,
        });
    const cube = limited("cube-a", "draft:cube:vintage");
    const cube2 = limited("cube-b", "draft:cube:vintage");
    const alpha = limited("alpha-a", "sealed:lea");
    const legacy = limited("legacy");
    const all = [legacy, alpha, cube, cube2];

    it("groups by origin sorted by label, unclassified last in its own group", () => {
        const groups = groupByLimitedOrigin(deckGrid(all, "limited", "").mine);
        expect(groups.map((g) => g.label)).toEqual([
            "Limited Edition Alpha Sealed",
            "Vintage Cube Draft",
            UNCLASSIFIED_ORIGIN_LABEL,
        ]);
        expect(
            groups.map((g) => g.entries.map((e) => e.deck.presetId))
        ).toEqual([["alpha-a"], ["cube-a", "cube-b"], ["legacy"]]);
        expect(groups[2].origin).toBeNull();
    });

    it("an unparseable key reads as unclassified", () => {
        const groups = groupByLimitedOrigin(
            deckGrid([limited("odd", "garbage")], "limited", "").mine
        );
        expect(groups.map((g) => g.label)).toEqual([UNCLASSIFIED_ORIGIN_LABEL]);
    });

    it("offers one option per origin present, never one for unclassified", () => {
        expect(limitedOriginOptions(all)).toEqual([
            { key: "sealed:lea", label: "Limited Edition Alpha Sealed" },
            { key: "draft:cube:vintage", label: "Vintage Cube Draft" },
        ]);
    });

    it("the origin filter narrows Limited decks and is inert elsewhere", () => {
        const ids = (origin: string) =>
            deckGrid(all, "limited", "", "all", origin).mine.map(
                (e) => e.deck.presetId
            );
        expect(ids("draft:cube:vintage")).toEqual(["cube-a", "cube-b"]);
        expect(ids("all")).toHaveLength(4);
        expect(
            deckGrid(all, "freeform", "", "all", "sealed:lea").mine
        ).toHaveLength(4);
    });
});
