// Catalogue-wide Effect Script sweep (ADR 0045 / ADR 0046, issue #800).
// Runs `validateEffectScript` over EVERY registered CardDefinition so a
// schema violation, an invented Op name, a mixed authoring mode or a
// non-JSON value in any set module fails CI before a game ever loads the
// card. The JSON-purity round-trip is asserted explicitly as well: every
// DSL-only card is a DB row waiting to happen (ADR 0046).

import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import {
    validateAbilityAiEffectsScript,
    validateAbilityEffectScript,
    validateAiEffectsScript,
    validateEffectScript,
} from "../../gre/effects/validate";
import { getAbilityEffectFn, getResolveFn } from "../effectRegistry";
import type { CardDefinition } from "../types";

/** Every ability site (activated + triggered) on a card that can carry an
 *  Effect Script, tagged with the owning card's label (ADR 0045, issue #803).
 *  Modes carry their own per-mode resolution site; those are spell-site scripts
 *  swept separately by `modeSites` below (a mode's script lives on
 *  `mode.effects`, NOT on `card.effects`, so the card-level
 *  `validateEffectScript` pass returns early and never reaches them). */
function abilitySites(card: CardDefinition): {
    ability: { id: string; effects?: unknown };
    label: string;
    triggerEventType?: string;
}[] {
    const label = `${card.name} (${card.id})`;
    // Activated abilities have no firing event ($event illegal); triggered
    // abilities carry `event`, threaded so the trigger-site $event scope
    // (ADR 0049, issue #865) is validated with the right event type.
    const activated = [
        ...(card.activatedAbilities ?? []),
        ...(card.grantTemplates ?? []),
    ].map((ability) => ({ ability, label }));
    const triggered = [
        ...(card.triggeredAbilities ?? []),
        ...(card.triggeredGrantTemplates ?? []),
    ].map((ability) => ({
        ability,
        label,
        // A single-event trigger pins one event type for `$event.<field>`
        // static validation (ADR 0049); an array-`event` (multi-event, CR
        // 603.2) has no single firing type — leave it undefined, which is
        // sound since an Effect Script cannot read `$event` anyway.
        triggerEventType: Array.isArray(
            (ability as { event?: string | string[] }).event
        )
            ? undefined
            : (ability as { event?: string }).event,
    }));
    return [...activated, ...triggered];
}

/** Every cast-time MODE site (CR 700.2 / 601.2c `modes[]`) on a card that
 *  carries an Effect Script, wrapped as a synthetic spell-site host so
 *  `validateEffectScript` walks it: a mode resolves like a spell (no
 *  `$source` permanent, no firing `$event`), and its `effects` are mutually
 *  exclusive with the mode's own `resolve` — exactly the spell-site rules. */
function modeSites(card: CardDefinition): {
    host: CardDefinition;
    label: string;
    effects: unknown;
}[] {
    return (card.modes ?? [])
        .filter((mode) => mode.effects !== undefined)
        .map((mode) => ({
            host: {
                ...card,
                id: `${card.id}#${mode.id}`,
                name: `${card.name} mode "${mode.id}"`,
                effects: mode.effects,
                // The card-level authoring fields belong to the CARD, not to
                // this mode — only the mode's own `resolve` would conflict.
                resolve: mode.resolve,
                resolveSteps: undefined,
                effect: undefined,
                modes: undefined,
            } as CardDefinition,
            label: `${card.name} (${card.id}) mode "${mode.id}"`,
            effects: mode.effects,
        }));
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
                validateAbilityEffectScript(
                    s.ability,
                    s.label,
                    s.triggerEventType
                )
            )
        );
        expect(errors).toEqual([]);
    });

    it("every cast-time mode-site Effect Script passes validation (CR 700.2 modes[], issue #1274)", () => {
        const errors = cards.flatMap((card) =>
            modeSites(card).flatMap(({ host }) => validateEffectScript(host))
        );
        expect(errors).toEqual([]);
    });

    // aiEffects shadow scripts (PRD #1423, issue #1431) — never executed,
    // only walked by OP_VALUERS for AI valuation. Before this guard (issue
    // #1514) they had NO static validation at all: an unregistered Op, a
    // dangling ref, or a non-JSON value silently valuated to the walker's
    // defensive zero rather than failing CI — the exact silent-AI-blindness
    // class the shadow-script mechanism (#1431) exists to close. Zero cards
    // in the catalogue carry `aiEffects` today (the backfill is issue #1436),
    // so this sweep is currently vacuous over real cards — it exists so a
    // malformed shadow script fails CI the moment the backfill lands, rather
    // than only once the valuer's defensive default is diagnosed as the
    // actual bug. Direct fixture coverage (a typo'd Op failing, a valid
    // shadow script coexisting with `resolve()` passing) lives in
    // `convex/gre/effects/__tests__/validate.test.ts`.
    it("every CardDefinition's aiEffects shadow script passes the same checks as effects[] (issue #1514)", () => {
        const errors = cards.flatMap((card) => validateAiEffectsScript(card));
        expect(errors).toEqual([]);
    });

    it("every ability-site aiEffects shadow script passes validation (issue #1514)", () => {
        const errors = cards.flatMap((card) =>
            abilitySites(card).flatMap((s) =>
                validateAbilityAiEffectsScript(
                    s.ability,
                    s.label,
                    s.triggerEventType
                )
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
        const modeDslOwners = cards
            .filter((c) => modeSites(c).length > 0)
            .map((c) => c.name);
        expect(modeDslOwners).toContain("Sheoldred's Edict");
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
