// "Counter up to one target activated or triggered ability. If an ability of
// an artifact, creature, or planeswalker is countered this way, that permanent
// loses all abilities for as long as this creature remains on the battlefield"
// (CR 701.6a, CR 113.7a, CR 613.1f, CR 611.2b) — Tishana's Tidebinder.
//
//  1. GOLDEN — the real card compiles to its full Compiled Definition.
//  2. REFUSALS — neighbours the rule must not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const RIDER =
    "If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield.";
const COUNTER = "counter up to one target activated or triggered ability.";

function tidebinder(oracleText: string) {
    return oracleCard({
        name: "Test Binder",
        manaCost: "{2}{U}",
        typeLine: "Creature — Merfolk Wizard",
        power: "3",
        toughness: "2",
        oracleText,
    });
}

describe("ability-loss counter rider — golden (CR 613.1f, CR 611.2b)", () => {
    it("Tishana's Tidebinder compiles to counter + loseAllAbilitiesWhileSourceRemains", () => {
        const outcome = compileCard(
            tidebinder(`When this creature enters, ${COUNTER} ${RIDER}`)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        const trigger = outcome.definition.compiledTriggeredAbilities![0]!;
        expect(sortKeys(trigger.targetRequirement)).toEqual(
            sortKeys({
                type: "spell",
                count: { min: 0, max: 1 },
                spellStackKind: "ability",
            })
        );
        expect(sortKeys(trigger.effects)).toEqual(
            sortKeys([
                { op: "counter", target: { target: 0 } },
                {
                    op: "loseAllAbilitiesWhileSourceRemains",
                    target: { target: 0 },
                    filter: { type: ["Artifact", "Creature", "Planeswalker"] },
                },
            ])
        );
    });
});

describe("ability-loss counter rider — refusals (fail-closed)", () => {
    const refused = (text: string) =>
        expect(compileCard(tidebinder(text)).state).toBe("unparsed");

    it("a rider behind a counter that names no ability is not read", () => {
        refused(`When this creature enters, counter target spell. ${RIDER}`);
    });
    it("a rider with no counter in front of it is not read", () => {
        refused(`When this creature enters, ${RIDER}`);
    });
    it("a different duration is not read", () => {
        refused(
            `When this creature enters, ${COUNTER} ${RIDER.replace("for as long as this creature remains on the battlefield", "until end of turn")}`
        );
    });
    it("a different type list is not read", () => {
        refused(
            `When this creature enters, ${COUNTER} ${RIDER.replace("artifact, creature, or planeswalker", "creature or land")}`
        );
    });
});
