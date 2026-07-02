// Catalogue-wide Effect Script sweep (ADR 0045 / ADR 0046, issue #800).
// Runs `validateEffectScript` over EVERY registered CardDefinition so a
// schema violation, an invented Op name, a mixed authoring mode or a
// non-JSON value in any set module fails CI before a game ever loads the
// card. The JSON-purity round-trip is asserted explicitly as well: every
// DSL-only card is a DB row waiting to happen (ADR 0046).

import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import {
    validateAbilityEffectScript,
    validateEffectScript,
} from "../../gre/effects/validate";
import { getAbilityEffectFn, getResolveFn } from "../effectRegistry";
import type { CardDefinition } from "../types";

/** Every ability site (activated + triggered) on a card that can carry an
 *  Effect Script, tagged with the owning card's label (ADR 0045, issue #803).
 *  Modes carry their own per-mode resolution site; those are spell-site scripts
 *  validated by `validateEffectScript`, so they are not re-walked here. */
function abilitySites(
    card: CardDefinition
): { ability: { id: string; effects?: unknown }; label: string }[] {
    const label = `${card.name} (${card.id})`;
    return [
        ...(card.activatedAbilities ?? []),
        ...(card.grantTemplates ?? []),
        ...(card.triggeredAbilities ?? []),
        ...(card.triggeredGrantTemplates ?? []),
    ].map((ability) => ({ ability, label }));
}

describe("Effect Script catalogue sweep (ADR 0045)", () => {
    const cards = getAllCards();
    const dslCards = cards.filter((c) => c.effects !== undefined);
    const abilityDslSites = cards
        .flatMap(abilitySites)
        .filter((s) => s.ability.effects !== undefined);

    it("every CardDefinition passes validateEffectScript (schema + vocabulary + exclusivity)", () => {
        const errors = cards.flatMap((card) => validateEffectScript(card));
        expect(errors).toEqual([]);
    });

    it("every ability-site Effect Script passes validation (schema + vocabulary + exclusivity + $source)", () => {
        const errors = cards.flatMap((card) =>
            abilitySites(card).flatMap((s) =>
                validateAbilityEffectScript(s.ability, s.label)
            )
        );
        expect(errors).toEqual([]);
    });

    it("every effects[] survives a JSON.stringify round-trip unchanged (ADR 0046 purity)", () => {
        for (const card of dslCards) {
            expect(
                JSON.parse(JSON.stringify(card.effects)),
                `${card.name} (${card.id})`
            ).toEqual(card.effects);
        }
        for (const { ability, label } of abilityDslSites) {
            expect(
                JSON.parse(JSON.stringify(ability.effects)),
                `${label} ability "${ability.id}"`
            ).toEqual(ability.effects);
        }
    });

    it("every DSL-only card compiles to a resolve closure through the single dispatch seam", () => {
        for (const card of dslCards) {
            expect(typeof getResolveFn(card), `${card.name} (${card.id})`).toBe(
                "function"
            );
        }
    });

    it("every ability-site Effect Script compiles through the shared getAbilityEffectFn seam", () => {
        for (const { ability, label } of abilityDslSites) {
            expect(
                typeof getAbilityEffectFn(
                    ability as Parameters<typeof getAbilityEffectFn>[0]
                ),
                `${label} ability "${ability.id}"`
            ).toBe("function");
        }
    });

    it("the sweep is not vacuous — at least one DSL-only card at each site is in the catalogue", () => {
        expect(dslCards.length).toBeGreaterThanOrEqual(1);
        expect(dslCards.map((c) => c.name)).toContain("Lava Spike");
        // Ability sites (issue #803): a triggered and an activated DSL card.
        expect(abilityDslSites.length).toBeGreaterThanOrEqual(2);
        const owners = cards
            .filter((c) => abilitySites(c).some((s) => s.ability.effects))
            .map((c) => c.name);
        expect(owners).toContain("Honden of Seeing Winds");
        expect(owners).toContain("Prodigal Pyromancer");
    });
});
