// Pump and grant: "<subject> gets +N/+N and gains <keyword> until end of turn"
// (CR 613.4c layer 7c + CR 613.1f layer 6, one duration per CR 611.2a;
// issue #8573).
//
//  1. GOLDENS — real corpus cards compiled whole: an announced target (Sure
//     Strike) and the source itself behind an activated cost (Pardic Lancer).
//     Both effects name the SAME selector: the subject is announced once.
//     Overload's `$each` body (Weapon Surge) is a `GOLDEN_FIXTURES` row,
//     compared whole by `goldenFixtures.test.ts`; here it must reach `ready`.
//  2. REFUSALS — the neighbours this rule must NOT read: a keyword LIST
//     ("flying and first strike") and a keyword CHOICE ("your choice of
//     deathtouch or lifelink"), each its own form.
//  3. GUARD A — the granted keyword is censused like a bare grant's: a
//     `planned` keyword quarantines the card instead of shipping it inert.

import { describe, expect, it } from "vitest";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome;
}

const SURE_STRIKE =
    "Target creature gets +3/+0 and gains first strike until end of turn. (It deals combat damage before creatures without first strike.)";
const PARDIC_LANCER =
    "Discard a card at random: This creature gets +1/+0 and gains first strike until end of turn.";
const WEAPON_SURGE =
    'Target creature you control gets +1/+0 and gains first strike until end of turn.\nOverload {1}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")';

describe("pump and grant — goldens (CR 613.4c, CR 613.1f, CR 611.2a)", () => {
    it("Sure Strike: the announced target is pumped and granted the keyword", () => {
        const outcome = compiled(instant("Sure Strike", "{1}{R}", SURE_STRIKE));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Sure Strike",
                types: ["Instant"],
                manaCost: { X: 1, R: 1 },
                oracleText: SURE_STRIKE,
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: 3,
                        toughness: 0,
                        duration: { phase: "end-of-turn" },
                    },
                    {
                        op: "grantAbility",
                        target: { target: 0 },
                        ability: "first strike",
                        duration: { phase: "end-of-turn" },
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("Pardic Lancer: the source pumps itself and gains the keyword", () => {
        const outcome = compiled(
            oracleCard({
                name: "Pardic Lancer",
                manaCost: "{4}{R}",
                typeLine: "Creature — Human Barbarian",
                oracleText: PARDIC_LANCER,
                power: "3",
                toughness: "2",
            })
        );
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Pardic Lancer",
                types: ["Creature"],
                subtypes: ["Human", "Barbarian"],
                manaCost: { X: 4, R: 1 },
                power: 3,
                toughness: 2,
                oracleText: PARDIC_LANCER,
                activatedAbilities: [
                    {
                        id: "pardic-lancer-ability",
                        oracleText: PARDIC_LANCER,
                        cost: { discardAtRandom: 1 },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 1,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                            {
                                op: "grantAbility",
                                target: { ref: "$source" },
                                ability: "first strike",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Weapon Surge: the overload sweep reaches ready through its golden fixture", () => {
        expect(
            compiled(instant("Weapon Surge", "{R}", WEAPON_SURGE)).state
        ).toBe("ready");
    });
});

describe("pump and grant — refused neighbours (fail-closed)", () => {
    it.each([
        [
            "Daring Leap",
            "{1}{W}{U}",
            "Target creature gets +1/+1 and gains flying and first strike until end of turn.",
        ],
        [
            "Alchemist's Gift",
            "{B}",
            "Target creature gets +1/+1 and gains your choice of deathtouch or lifelink until end of turn. (Any amount of damage a creature with deathtouch deals to a creature is enough to destroy it. Damage dealt by a creature with lifelink also causes its controller to gain that much life.)",
        ],
    ])("%s is not read", (name, manaCost, oracleText) => {
        expect(compileCard(instant(name, manaCost, oracleText)).state).toBe(
            "unparsed"
        );
    });
});

describe("pump and grant — Guard A census (CR 613.1f)", () => {
    it("quarantines a pump that grants a planned keyword", () => {
        // Read from the registry, not named: whichever keyword is planned
        // today is the one the census must catch.
        const planned = MECHANICS_REGISTRY.find(
            (row) => row.kind === "keyword-ability" && row.status === "planned"
        )?.name.toLowerCase();
        expect(planned).toBeDefined();
        const outcome = compileCard(
            instant(
                "Planned Grant",
                "{R}",
                `Target creature gets +1/+0 and gains ${planned} until end of turn.`
            )
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state === "quarantine")
            expect(
                outcome.reasons.some(
                    (r) =>
                        r.kind === "planned-mechanic" &&
                        r.detail.includes(`"${planned}"`)
                )
            ).toBe(true);
    });
});
