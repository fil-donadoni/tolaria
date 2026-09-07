import { describe, it, expect } from "vitest";
import { getAllCards, getAllCatalogueCards } from "../catalogue";
import {
    FACE_DOWN_CARD_ID,
    registeredDefinitions,
    tryGetDefinition,
    withTemporaryDefinition,
} from "../registry";
import { buildSearchIndex } from "../searchIndex";
import { foldAccents } from "../textNormalize";
import type { CardDefinition } from "../types";

/**
 * The deck-builder search index, derived from the runtime registry
 * (issue #3054, ADR 0113 §4).
 *
 * What this replaced was `api.cardIndex.list`, a Convex query over
 * `getAllCards()` — the HAND-WRITTEN population. `convex/cards/compiledCatalogue.ts`
 * states that exclusion outright: compiled rows go into the registry and NOT
 * into `getAllCards()`. So the index's population was the whole defect: the
 * deck builder derived a card's availability from membership in it, and every
 * compiled card read as *Unavailable* however well the engine could play it.
 *
 * Coeurl (`fin`) is the pin, and the reason it is a fair one is asserted in
 * `compiledCatalogue.test.ts`: `it("has never been hand-written", …)` reads
 * `data/card-index.json` and proves the row's `source` is `"compiled"`. A card
 * the hand-written registry would resolve anyway could not tell the two
 * populations apart.
 */
const COEURL_ID = "7604b534-5480-42fa-bc36-bbae730f8582";

describe("the search index population (issue #3054)", () => {
    it("carries the compiled cards the old `getAllCards()` query left out", () => {
        const index = buildSearchIndex();
        const handWritten = new Set(getAllCards().map((c) => c.id));
        const compiledOnly = index.filter((r) => !handWritten.has(r.cardId));

        const coeurl = index.find((r) => r.cardId === COEURL_ID);
        expect(coeurl?.name).toBe("Coeurl");
        expect(coeurl?.types).toContain("Creature");
        expect(handWritten.has(COEURL_ID)).toBe(false);
        // Not just the pin: the whole compiled population is in. The floor is
        // deliberately far below the measured 2,278 so a pool regeneration
        // moves it without moving this test.
        expect(compiledOnly.length).toBeGreaterThan(1000);
    });

    it("keeps every hand-written card the old query served", () => {
        const indexed = new Set(buildSearchIndex().map((r) => r.cardId));
        const missing = getAllCards()
            .map((c) => c.id)
            .filter((id) => !indexed.has(id));
        expect(missing).toEqual([]);
    });

    it("is the CATALOGUE, not the registry — the face-down sentinel is registered and stays out", () => {
        const index = buildSearchIndex();
        const registered = [...registeredDefinitions()];
        // The sentinel (CR 708.2) is a rules object, not a printed card. It is
        // in the lookup map and must not be in the pool.
        expect(registered.some((d) => d.id === FACE_DOWN_CARD_ID)).toBe(true);
        expect(index.some((r) => r.cardId === FACE_DOWN_CARD_ID)).toBe(false);
        expect(index).toHaveLength(getAllCatalogueCards().length);
    });

    it("ignores a token definition the engine synthesized into the registry (CR 111.1)", () => {
        // The failure this guards is invisible and order-dependent: the
        // registry is a LIVE map, and `maybeSynthesizeToken` /
        // `registerTokenDefinition` write into it on any board render that
        // resolves a token permanent. An index enumerated from the registry
        // would then offer `token:…` as an addable card — but only for a
        // session that visited a board BEFORE opening the deck builder.
        const token: CardDefinition = {
            id: "token:searchindex-probe|Creature|1|1",
            name: "Searchindex Probe",
            rarity: "common",
            manaCost: {},
            types: ["Creature"],
            power: 1,
            toughness: 1,
        };
        withTemporaryDefinition(token, () => {
            // The registry really does serve it — otherwise the assertion
            // below would pass vacuously.
            expect(tryGetDefinition(token.id)?.name).toBe("Searchindex Probe");
            expect(buildSearchIndex().some((r) => r.cardId === token.id)).toBe(
                false
            );
        });
    });

    it("folds accents on every row, so an accented name is searchable unaccented", () => {
        const wrong = buildSearchIndex().filter(
            (r) =>
                r.nameLower !== r.name.toLowerCase() ||
                r.nameFold !== foldAccents(r.name.toLowerCase()) ||
                r.oracleFold !== foldAccents(r.oracleText)
        );
        expect(wrong.map((r) => r.name)).toEqual([]);
    });

    it("puts the card's own id first in `prints`, which the edition picker relies on", () => {
        const offenders = buildSearchIndex()
            .filter((r) => r.prints[0]?.printId !== r.cardId)
            .map((r) => r.name);
        expect(offenders).toEqual([]);
    });
});
