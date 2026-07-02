// Catalogue-wide Effect Script sweep (ADR 0045 / ADR 0046, issue #800).
// Runs `validateEffectScript` over EVERY registered CardDefinition so a
// schema violation, an invented Op name, a mixed authoring mode or a
// non-JSON value in any set module fails CI before a game ever loads the
// card. The JSON-purity round-trip is asserted explicitly as well: every
// DSL-only card is a DB row waiting to happen (ADR 0046).

import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import { validateEffectScript } from "../../gre/effects/validate";
import { getResolveFn } from "../effectRegistry";

describe("Effect Script catalogue sweep (ADR 0045)", () => {
    const cards = getAllCards();
    const dslCards = cards.filter((c) => c.effects !== undefined);

    it("every CardDefinition passes validateEffectScript (schema + vocabulary + exclusivity)", () => {
        const errors = cards.flatMap((card) => validateEffectScript(card));
        expect(errors).toEqual([]);
    });

    it("every effects[] survives a JSON.stringify round-trip unchanged (ADR 0046 purity)", () => {
        for (const card of dslCards) {
            expect(
                JSON.parse(JSON.stringify(card.effects)),
                `${card.name} (${card.id})`
            ).toEqual(card.effects);
        }
    });

    it("every DSL-only card compiles to a resolve closure through the single dispatch seam", () => {
        for (const card of dslCards) {
            expect(typeof getResolveFn(card), `${card.name} (${card.id})`).toBe(
                "function"
            );
        }
    });

    it("the sweep is not vacuous — at least one DSL-only card is in the catalogue", () => {
        expect(dslCards.length).toBeGreaterThanOrEqual(1);
        expect(dslCards.map((c) => c.name)).toContain("Lava Spike");
    });
});
