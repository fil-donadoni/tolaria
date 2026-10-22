// Aura returning itself from the graveyard attached to the creature that
// entered (CR 303.4f, CR 113.6b): "When a creature with mana value 6 or
// greater enters, you may return this card from your graveyard to the
// battlefield attached to that creature."
//
//  1. GOLDEN — the real Dragon Breath row (the `GOLDEN_FIXTURES` entry) reaches
//     `ready` and lowers to a `moveZone` of `$source` with `attachTo` the head's
//     entering creature.
//  2. REFUSALS — neighbours the rule must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const DRAGON_BREATH = GOLDEN_FIXTURES.find(
    (fixture) => fixture.card.name === "Dragon Breath"
)!;

const aura = (trigger: string) =>
    compileCard(
        oracleCard({
            name: "Aura Probe",
            manaCost: "{1}{R}",
            typeLine: "Enchantment — Aura",
            oracleText: `Enchant creature\n${trigger}`,
        })
    );

describe("Aura return from the graveyard, attached to the entering creature", () => {
    it("Dragon Breath: compiles to the fixture and reaches ready (CR 303.4f)", () => {
        const outcome = compileCard(DRAGON_BREATH.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(DRAGON_BREATH.expected)
        );
    });

    it("lowers to moveZone of the source with attachTo the event's entering permanent", () => {
        const outcome = aura(
            "When a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature."
        );
        if (outcome.state === "unparsed") throw new Error(outcome.state);
        const trigger = outcome.definition.compiledTriggeredAbilities?.[0];
        expect(trigger?.zone).toBe("graveyard");
        expect(JSON.stringify(trigger?.effects)).toContain(
            '{"op":"moveZone","target":{"ref":"$source"},"from":"graveyard","to":"battlefield","attachTo":{"ref":"$event.instanceId"}}'
        );
    });

    it.each([
        // CR 303.4f — no host named: the Aura would need a host prompt.
        "When a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield.",
        // CR 303.4f — "that creature" needs a head that names one.
        "At the beginning of your upkeep, you may return this card from your graveyard to the battlefield attached to that creature.",
        "When this creature enters, you may return this card from your graveyard to the battlefield attached to that creature.",
        // CR 113.6b — the hand is not an attach destination.
        "When a creature with mana value 6 or greater enters, you may return this card from your graveyard to your hand attached to that creature.",
        // CR 303.4f — a different referent than the creature that entered.
        "When a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to target creature.",
    ])("refuses %s", (line) => {
        expect(aura(line).state).toBe("unparsed");
    });
});
