// Pure Zone build-time filter (PRD #1617, issue #1625, ADR 0075 § "Filter is
// momentary"). Real registry ids, same convention as `deck-zone-surface.test.tsx`
// — the engine (here, `getCardColorIdentity`/`def.types`) resolves each card
// for real rather than through a hand-built fixture.
import { describe, it, expect } from "vitest";
import { getDefinition } from "@convex/cards";
import {
    DEFAULT_ZONE_FILTER,
    filterZoneCards,
    isZoneFilterActive,
    matchesZoneFilter,
    toggleZoneFilterColor,
    zoneFilterSummary,
    type ZoneFilter,
} from "../deckZoneFilter";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt, R instant
const SERRA_ID = "f8ac5006-91bd-4803-93da-f87cf196dd2f"; // Serra Angel, W creature
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains, W-identity land
const MOX_ID = "8ebe4be7-e12a-4596-a899-fbd5b152e879"; // Mox Pearl, colourless artifact

const BOLT = getDefinition(BOLT_ID);
const SERRA = getDefinition(SERRA_ID);
const PLAINS = getDefinition(PLAINS_ID);
const MOX = getDefinition(MOX_ID);

describe("isZoneFilterActive", () => {
    it("is false for the default (no-op) filter", () => {
        expect(isZoneFilterActive(DEFAULT_ZONE_FILTER)).toBe(false);
    });

    it("is true once the creature segment leaves 'all'", () => {
        expect(
            isZoneFilterActive({ creature: "creatures", colors: new Set() })
        ).toBe(true);
    });

    it("is true once any colour is toggled on", () => {
        expect(
            isZoneFilterActive({ creature: "all", colors: new Set(["R"]) })
        ).toBe(true);
    });
});

describe("matchesZoneFilter — creature segment", () => {
    it("'all' matches everything", () => {
        const filter: ZoneFilter = { creature: "all", colors: new Set() };
        expect(matchesZoneFilter(BOLT, filter)).toBe(true);
        expect(matchesZoneFilter(SERRA, filter)).toBe(true);
    });

    it("'creatures' keeps a Creature and drops a non-Creature", () => {
        const filter: ZoneFilter = { creature: "creatures", colors: new Set() };
        expect(matchesZoneFilter(SERRA, filter)).toBe(true);
        expect(matchesZoneFilter(BOLT, filter)).toBe(false);
        expect(matchesZoneFilter(PLAINS, filter)).toBe(false);
    });

    it("'non-creatures' keeps everything but a Creature", () => {
        const filter: ZoneFilter = {
            creature: "non-creatures",
            colors: new Set(),
        };
        expect(matchesZoneFilter(BOLT, filter)).toBe(true);
        expect(matchesZoneFilter(PLAINS, filter)).toBe(true);
        expect(matchesZoneFilter(SERRA, filter)).toBe(false);
    });
});

describe("matchesZoneFilter — colour toggles", () => {
    it("an empty colour set applies no colour filter", () => {
        const filter: ZoneFilter = { creature: "all", colors: new Set() };
        expect(matchesZoneFilter(BOLT, filter)).toBe(true);
        expect(matchesZoneFilter(MOX, filter)).toBe(true);
    });

    it("keeps only cards whose identity intersects the selected colours", () => {
        const filter: ZoneFilter = { creature: "all", colors: new Set(["R"]) };
        expect(matchesZoneFilter(BOLT, filter)).toBe(true);
        expect(matchesZoneFilter(SERRA, filter)).toBe(false);
    });

    it("a land's identity is its produced mana — Plains matches W, not C", () => {
        const wFilter: ZoneFilter = { creature: "all", colors: new Set(["W"]) };
        const cFilter: ZoneFilter = { creature: "all", colors: new Set(["C"]) };
        expect(matchesZoneFilter(PLAINS, wFilter)).toBe(true);
        expect(matchesZoneFilter(PLAINS, cFilter)).toBe(false);
    });

    it("the colourless toggle keeps a genuinely colourless card", () => {
        const filter: ZoneFilter = { creature: "all", colors: new Set(["C"]) };
        expect(matchesZoneFilter(MOX, filter)).toBe(true);
        expect(matchesZoneFilter(BOLT, filter)).toBe(false);
    });
});

describe("matchesZoneFilter — both axes combine by AND", () => {
    it("a card must satisfy the creature segment AND the colour toggles", () => {
        // Serra Angel: Creature, White.
        const creatureAndWhite: ZoneFilter = {
            creature: "creatures",
            colors: new Set<"W">(["W"]),
        };
        expect(matchesZoneFilter(SERRA, creatureAndWhite)).toBe(true);

        // Right colour, wrong creature segment.
        const nonCreatureAndWhite: ZoneFilter = {
            creature: "non-creatures",
            colors: new Set<"W">(["W"]),
        };
        expect(matchesZoneFilter(SERRA, nonCreatureAndWhite)).toBe(false);

        // Right creature segment, wrong colour.
        const creatureAndRed: ZoneFilter = {
            creature: "creatures",
            colors: new Set<"R">(["R"]),
        };
        expect(matchesZoneFilter(SERRA, creatureAndRed)).toBe(false);
    });
});

describe("matchesZoneFilter — an unresolvable card is never hidden", () => {
    it("always matches when the definition is undefined", () => {
        const filter: ZoneFilter = {
            creature: "creatures",
            colors: new Set<"R">(["R"]),
        };
        expect(matchesZoneFilter(undefined, filter)).toBe(true);
    });
});

describe("filterZoneCards", () => {
    const items = [
        { cardId: BOLT_ID, cardName: "Lightning Bolt" },
        { cardId: SERRA_ID, cardName: "Serra Angel" },
        { cardId: PLAINS_ID, cardName: "Plains" },
    ];

    it("returns every item, unfiltered, when the filter is inactive", () => {
        expect(
            filterZoneCards(items, DEFAULT_ZONE_FILTER, (c) => c.cardId)
        ).toEqual(items);
    });

    it("returns a NEW array even when the filter is inactive (never the same reference)", () => {
        const result = filterZoneCards(
            items,
            DEFAULT_ZONE_FILTER,
            (c) => c.cardId
        );
        expect(result).not.toBe(items);
    });

    it("drops non-matching items and keeps the matching ones, in order", () => {
        const filter: ZoneFilter = { creature: "creatures", colors: new Set() };
        expect(
            filterZoneCards(items, filter, (c) => c.cardId).map(
                (c) => c.cardName
            )
        ).toEqual(["Serra Angel"]);
    });
});

describe("toggleZoneFilterColor", () => {
    it("adds an absent colour and removes a present one, without mutating the input", () => {
        const original: ZoneFilter = { creature: "all", colors: new Set() };
        const added = toggleZoneFilterColor(original, "R");
        expect(added.colors.has("R")).toBe(true);
        expect(original.colors.has("R")).toBe(false); // input untouched

        const removed = toggleZoneFilterColor(added, "R");
        expect(removed.colors.has("R")).toBe(false);
        expect(added.colors.has("R")).toBe(true); // input untouched
    });
});

describe("zoneFilterSummary", () => {
    it("is empty for the default filter", () => {
        expect(zoneFilterSummary(DEFAULT_ZONE_FILTER)).toBe("");
    });

    it("names the creature segment alone", () => {
        expect(
            zoneFilterSummary({ creature: "creatures", colors: new Set() })
        ).toBe("Creatures");
    });

    it("names colours in WUBRG+C order regardless of toggle order", () => {
        expect(
            zoneFilterSummary({
                creature: "all",
                colors: new Set<"R" | "W">(["R", "W"]),
            })
        ).toBe("W/R");
    });

    it("combines both axes", () => {
        expect(
            zoneFilterSummary({
                creature: "non-creatures",
                colors: new Set<"U">(["U"]),
            })
        ).toBe("Non-creatures · U");
    });
});
