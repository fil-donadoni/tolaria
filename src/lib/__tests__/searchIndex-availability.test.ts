import { describe, it, expect } from "vitest";
import { foldAccents } from "@convex/cards/textNormalize";
import { patchAvailability, type FullCatalogueRow } from "../fullCatalogue";
import { searchIndex } from "../searchIndex";

/**
 * The user-visible payoff of issue #3054, walked end to end: registry →
 * `buildSearchIndex` → `patchAvailability` → the `available` flag the deck
 * builder renders a card dimmed and unselectable on.
 *
 * The chain is the point. `patchAvailability` used to be fed by
 * `api.cardIndex.list`, whose population was `getAllCards()` — hand-written
 * only — so a compiled card the engine can play in full showed as
 * *Unavailable* in the builder. Asserting the flag against a hand-built fold
 * set would prove nothing about that; the index has to be the real one.
 */
const COEURL = "Coeurl";

function row(name: string): FullCatalogueRow {
    return {
        name,
        printId: `print-${name}`,
        typeLine: "Creature",
        manaCost: "{2}{G}",
        cmc: 3,
        colourIdentity: "G",
        set: "fin",
        rarity: "common",
        nameFold: foldAccents(name.toLowerCase()),
        available: false,
    };
}

describe("deck-builder availability spans the whole registry (issue #3054)", () => {
    const folds = new Set(searchIndex().map((r) => r.nameFold));

    it("marks a COMPILED card available — the bug this issue names", () => {
        const [patched] = patchAvailability([row(COEURL)], folds);
        expect(patched.available).toBe(true);
    });

    it("still marks a hand-written card available", () => {
        const [patched] = patchAvailability([row("Lightning Bolt")], folds);
        expect(patched.available).toBe(true);
    });

    it("leaves a card the engine has no definition for unavailable", () => {
        const [patched] = patchAvailability(
            [row("Kozilek, the Great Distortion")],
            folds
        );
        expect(patched.available).toBe(false);
    });
});
