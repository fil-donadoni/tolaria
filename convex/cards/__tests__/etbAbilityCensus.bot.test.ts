// ETB Ability census (issue #4758, PRD #4754). An **ETB Ability** (GLOSSARY.md,
// CR 603.6a "When [this object] enters, …") is SPENT on entering: the Bot's
// value model counts it in the card's latent Card Value and never in its
// realized one (`gre/ai/cardScriptValue.ts`). Which triggers ARE one is data —
// `TriggeredAbility.etbAbility`, stamped by `enteredTrigger` from its scope and
// set by hand on the few triggers written on `PERMANENT_ENTERED` without it.
//
// Absent reads as realized, which is the fail-closed direction for the ENGINE
// but the silent one for the Bot: a new self-ETB card written by hand would
// keep its spent ETB on the battlefield and the Bot would cast it into nothing
// again. So every trigger on the entering event must say which it is, and a
// mixed-event one ("enters or attacks") can never be an ETB Ability — it fires
// again after entering.
//
// Same shape as `aiEffectsGuard.bot.test.ts`: a catalogue-wide sweep over
// `getAllCards()`, no baseline — the whole residue was classified when the
// census shipped.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import type { CardDefinition, TriggeredAbility } from "../types";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";

function eventsOf(t: TriggeredAbility): readonly string[] {
    return Array.isArray(t.event) ? t.event : [t.event];
}

function entersTriggers(
    def: CardDefinition
): { def: CardDefinition; trigger: TriggeredAbility }[] {
    return (def.triggeredAbilities ?? [])
        .filter((t) => eventsOf(t).includes("PERMANENT_ENTERED"))
        .map((trigger) => ({ def, trigger }));
}

const ENTERS = getAllCards().flatMap(entersTriggers);

describe("ETB Ability census (issue #4758)", () => {
    it("the catalogue has triggers on the entering event to classify", () => {
        expect(ENTERS.length).toBeGreaterThan(100);
    });

    it("every trigger on PERMANENT_ENTERED says whether it is an ETB Ability", () => {
        const unclassified = ENTERS.filter(
            ({ trigger }) => typeof trigger.etbAbility !== "boolean"
        ).map(({ def, trigger }) => `${def.name} :: ${trigger.id}`);
        expect(
            unclassified,
            "set `etbAbility` on these triggers (true = fired by its OWN permanent entering and nothing else, CR 603.6a; false otherwise), or author them through `enteredTrigger`"
        ).toEqual([]);
    });

    it("a trigger on a mixed event list is never an ETB Ability", () => {
        const mixed = ENTERS.filter(
            ({ trigger }) =>
                eventsOf(trigger).length > 1 && trigger.etbAbility === true
        ).map(({ def, trigger }) => `${def.name} :: ${trigger.id}`);
        expect(mixed).toEqual([]);
    });

    it("the factory stamps a self-scoped trigger as an ETB Ability and every other scope as not", () => {
        const build = (scope: "self" | "another-yours" | "yours" | "any") =>
            enteredTrigger({
                id: `census-${scope}`,
                oracleText: "",
                scope,
                effects: [],
            }).etbAbility;
        expect(build("self")).toBe(true);
        expect(build("another-yours")).toBe(false);
        expect(build("yours")).toBe(false);
        expect(build("any")).toBe(false);
    });
});
