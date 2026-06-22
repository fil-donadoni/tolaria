import { describe, expect, it } from "vitest";
import { getAllCards, getCardById } from "../index";
import { lightningBoltLeb, volcanicIsland } from "../sets/leb";
import { badlands } from "../sets/lea";
import type { Rarity } from "../types";

// Per-card Rarity (CR 206) was added to the card model in issue #511 and
// backfilled across the catalogue from MTGJSON. These tests pin a few known
// rarities and guard that every definition/print carries one of the three
// modelled values, so a future card that forgets its rarity is caught.

// Scryfall ids of cards with well-known rarities (from data/json/*.json).
const LIGHTNING_BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const MOX_SAPPHIRE_LEA = "82da0972-b17b-4600-9efd-e9430a0db04b";
const BLACK_LOTUS_LEA = "b0faa7f2-b547-42c4-a810-839da50dadfe";
const FOREST_LEA = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

const VALID_RARITIES: ReadonlySet<Rarity> = new Set([
    "common",
    "uncommon",
    "rare",
]);

describe("per-card rarity (CR 206, issue #511)", () => {
    it("a common spell is common (Lightning Bolt)", () => {
        expect(getCardById(LIGHTNING_BOLT_LEA).rarity).toBe("common");
    });

    it("a Power Nine artifact is rare (Mox Sapphire, Black Lotus)", () => {
        expect(getCardById(MOX_SAPPHIRE_LEA).rarity).toBe("rare");
        expect(getCardById(BLACK_LOTUS_LEA).rarity).toBe("rare");
    });

    it("a basic land carries a rarity (informational — gated by Basic)", () => {
        // Forest is a Basic land; rarity is informational for it but still
        // present and valid (it is a printed common in Alpha).
        expect(getCardById(FOREST_LEA).rarity).toBe("common");
    });

    it("definitions built via a factory carry their rarity (duals are rare)", () => {
        // Volcanic Island (Beta-original dual) and the Alpha duals are rare;
        // verifies the factory-forwarded path, not just plain literals.
        expect(getCardById(volcanicIsland.id).rarity).toBe("rare");
        expect(getCardById(badlands.id).rarity).toBe("rare");
    });

    it("every card definition in the pool declares a valid rarity", () => {
        const offenders = getAllCards().filter(
            (c) => !VALID_RARITIES.has(c.rarity)
        );
        expect(offenders.map((c) => c.name)).toEqual([]);
    });

    it("a CardPrint carries its own rarity (Lightning Bolt's Beta reprint)", () => {
        // Rarity is per-printing: the print declares it independently of the
        // home-set definition (here they happen to agree at "common").
        expect(lightningBoltLeb.rarity).toBe("common");
        expect(VALID_RARITIES.has(lightningBoltLeb.rarity)).toBe(true);
    });
});
