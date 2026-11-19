// Auto-Build's client half (issue #9976): the suggestion re-attached to
// physical Pool copies, and the "not built yet" flag on a raw-Pool Maindeck.
import { describe, expect, it } from "vitest";
import {
    autoBuiltWorkingDeck,
    unbuiltPoolDeckReason,
} from "../autoBuiltPoolDeck";
import type { WorkingDeck } from "../deckBuilderVariant";

const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: BOLT_ID, cardName: "Lightning Bolt" },
];

const entries = (n: number, cardId = BOLT_ID) =>
    Array.from({ length: n }, () => ({ cardId, cardName: "X" }));

describe("unbuiltPoolDeckReason", () => {
    it("flags a Maindeck over 40 cards with no basic land (the raw 45-card Pool)", () => {
        expect(unbuiltPoolDeckReason(entries(45))?.code).toBe("pool-not-built");
    });
    it("is silent once a basic is in, or at/below the 40-card floor", () => {
        expect(
            unbuiltPoolDeckReason([...entries(44), ...entries(1, PLAINS_ID)])
        ).toBeNull();
        expect(unbuiltPoolDeckReason(entries(40))).toBeNull();
    });
});

describe("autoBuiltWorkingDeck", () => {
    it("re-attaches Pool cards to their copies and keeps the player's name and layout; basics carry no poolIndex", () => {
        const current: WorkingDeck = {
            name: "Mine",
            format: "limited",
            cards: [],
            sideboard: [],
            layout: { manual: [] } as never,
        };
        const next = autoBuiltWorkingDeck(current, POOL, [], {
            cards: [
                { cardId: BOLT_ID, cardName: "Lightning Bolt" },
                { cardId: PLAINS_ID, cardName: "Plains" },
            ],
            sideboard: [{ cardId: BOLT_ID, cardName: "Lightning Bolt" }],
        });
        expect(next.name).toBe("Mine");
        expect(next.layout).toBe(current.layout);
        expect(next.cards.map((c) => c.pinKey)).toEqual(["0", undefined]);
        expect(next.sideboard.map((c) => c.pinKey)).toEqual(["1"]);
    });
});
