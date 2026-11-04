// CR 702.73a through the two client readers that show a subtype line to a
// player: a changeling reads as one phrase, never as ~300 words.
import { describe, expect, it } from "vitest";
import { getDefinition, preloadDefinitions } from "@convex/cards";
import { formatTypeLine } from "~/lib/card-utils";
import { computeDeckStats } from "~/lib/deckStats";

const CHANGELING = "changeling-display-test-creature";
preloadDefinitions([
    {
        id: CHANGELING,
        name: "Changeling Display Test",
        rarity: "common",
        types: ["Creature"],
        subtypes: ["Shapeshifter"],
        staticAbilities: ["changeling"],
        power: 1,
        toughness: 1,
    },
]);

describe("a changeling's subtype line on the client (CR 702.73a)", () => {
    it("the type line collapses every creature type to one phrase", () => {
        const def = getDefinition(CHANGELING);
        expect(formatTypeLine(def.types, def.subtypes, undefined)).toBe(
            "Creature — Every creature type"
        );
    });

    it("deck statistics count it once, under that phrase", () => {
        const stats = computeDeckStats([
            { cardId: CHANGELING, cardName: "Changeling Display Test" },
        ]);
        expect(stats.subtypes).toEqual({ "Every creature type": 1 });
    });
});
