// Building a Preset Deck payload from a canonical Tier 1 list (issue #3168).
//
// The point of these is the REFUSALS. A seeder that quietly ships a preset the
// Format rejects has not saved anyone typing — the deck reaches the lobby and
// dies at the game-start gate (ADR 0036), where the player discovers it rather
// than the maintainer.

import { describe, it, expect } from "vitest";
import { buildPresetPayload, deckColors } from "../lib/preset-deck-seed";
import { readTier1Decks, type Tier1Deck } from "../lib/tier1-decks";
import { tryGetCardByName } from "../../convex/cards";
import { validateDeck } from "../../convex/formats";
import { primaryCheckout } from "../lib/primary-checkout";

const resolve = (name: string) => tryGetCardByName(name);
const SUPPLIED = "2026-08-23";

function oathPonza(): Tier1Deck {
    const file = readTier1Decks(primaryCheckout());
    const deck = file.decks.find((d) => d.slug === "oath-ponza");
    if (!deck) throw new Error("oath-ponza missing from the canonical lists");
    return deck;
}

describe("buildPresetPayload — the real Oath Ponza list (issue #3168)", () => {
    it("builds a 60 + 15 payload every card of which resolves", () => {
        const { payload, problems } = buildPresetPayload(
            oathPonza(),
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(problems).toEqual([]);
        expect(payload!.cards).toHaveLength(60);
        expect(payload!.sideboard).toHaveLength(15);
        // Every entry carries a real registry id, not a name echoed back.
        for (const c of [...payload!.cards, ...payload!.sideboard]) {
            expect(resolve(c.cardName)?.id).toBe(c.cardId);
        }
    });

    it("the built payload is legal Premodern through the real validator", () => {
        const { payload } = buildPresetPayload(
            oathPonza(),
            "premodern",
            SUPPLIED,
            resolve
        );
        const legality = validateDeck(
            { cards: payload!.cards, sideboard: payload!.sideboard },
            "premodern"
        );
        expect(legality.reasons).toEqual([]);
        expect(legality.isLegal).toBe(true);
    });

    it("derives the colours from colour identity, WUBRG-ordered", () => {
        const { payload } = buildPresetPayload(
            oathPonza(),
            "premodern",
            SUPPLIED,
            resolve
        );
        // Oath Ponza is RG: Terravore / Sylvan Library / Oath of Druids green,
        // Pyroclasm / Earthquake / Pyroblast red. Ordered R before G.
        expect(payload!.colors).toEqual(["R", "G"]);
        expect(payload!.description).toContain(SUPPLIED);
        expect(payload!.name).toBe("Oath Ponza");
    });
});

describe("buildPresetPayload — refusals (issue #3168)", () => {
    it("refuses an unresolved card name, and names every one of them", () => {
        const deck = oathPonza();
        const broken: Tier1Deck = {
            ...deck,
            main: [
                { count: 4, name: "Nonesuch Bauble" },
                ...deck.main.slice(1),
            ],
            sideboard: [
                { count: 2, name: "Second Nonesuch" },
                ...deck.sideboard.slice(1),
            ],
        };
        const { payload, problems } = buildPresetPayload(
            broken,
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(payload).toBeUndefined();
        // ONE run names both, so a maintainer fixes the list in one pass.
        expect(problems[0]).toContain("Nonesuch Bauble");
        expect(problems[0]).toContain("Second Nonesuch");
    });

    it("refuses a deck the Format rejects, carrying the validator's reasons", () => {
        const deck = oathPonza();
        // Drop a maindeck entry: 56 cards is not a legal Premodern deck.
        const short: Tier1Deck = { ...deck, main: deck.main.slice(1) };
        const { payload, problems } = buildPresetPayload(
            short,
            "premodern",
            SUPPLIED,
            resolve
        );
        expect(payload).toBeUndefined();
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join(" ")).toMatch(/not legal in premodern/);
    });
});

describe("deckColors (CR 202.2 colour identity)", () => {
    it("unions identities and orders them WUBRG", () => {
        const defs = [
            "Pyroblast", // R
            "Sylvan Library", // G
            "Counterspell", // U
        ]
            .map(resolve)
            .filter((d): d is NonNullable<typeof d> => d !== null);
        expect(defs).toHaveLength(3);
        expect(deckColors(defs)).toEqual(["U", "R", "G"]);
    });

    it("a colourless deck has no colours", () => {
        const defs = ["Mishra's Factory", "Wasteland"]
            .map(resolve)
            .filter((d): d is NonNullable<typeof d> => d !== null);
        expect(defs).toHaveLength(2);
        expect(deckColors(defs)).toEqual([]);
    });
});
