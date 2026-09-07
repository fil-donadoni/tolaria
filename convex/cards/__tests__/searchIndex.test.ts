import { describe, it, expect } from "vitest";
import { getAllCards } from "../catalogue";
import { FACE_DOWN_CARD_ID, registeredDefinitions } from "../registry";
import { buildSearchIndex } from "../searchIndex";
import { foldAccents } from "../textNormalize";

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

    it("is the registry minus the face-down sentinel — a rules object (CR 708.2), not a printed card", () => {
        const index = buildSearchIndex();
        const registered = [...registeredDefinitions()];
        expect(registered.some((d) => d.id === FACE_DOWN_CARD_ID)).toBe(true);
        expect(index.some((r) => r.cardId === FACE_DOWN_CARD_ID)).toBe(false);
        expect(index).toHaveLength(registered.length - 1);
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
