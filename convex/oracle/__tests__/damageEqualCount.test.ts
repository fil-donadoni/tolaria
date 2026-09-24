// Damage equal to a counted set — "{self} deals damage to target creature
// equal to the number of Mountains you control" (issue #4314, CR 107.1 /
// 119.3 / 120.1).
//
//  1. GOLDEN — Seismic Strike's real Oracle row, compiled whole.
//  2. REFUSALS — neighbours the grammar must NOT read: a singular noun, another
//     controller, a clause the count cannot express, a dealer that is not the
//     source.
//  3. BEHAVIOUR — the compiled script runs through the real interpreter, so a
//     count dropped between grammar and resolution is wrong damage here.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

function spell(name: string, manaCost: string, typeLine: string, text: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText: text,
        typeLine,
        power: undefined,
        toughness: undefined,
    });
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

describe("damage equal to the number of <permanents> you control", () => {
    it("Seismic Strike compiles whole", () => {
        const outcome = compileCard(
            spell(
                "Seismic Strike",
                "{2}{R}",
                "Instant",
                "Seismic Strike deals damage to target creature equal to the number of Mountains you control."
            )
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                {
                    op: "dealDamage",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { subtype: "Mountain" },
                        },
                    },
                    to: { target: 0 },
                },
            ])
        );
    });

    it("refuses a singular noun", () => {
        expect(
            refused(
                spell(
                    "Wrapper",
                    "{R}",
                    "Sorcery",
                    "Wrapper deals damage to target creature equal to the number of Mountain you control."
                )
            )
        ).toBe(true);
    });

    it("refuses a set the controller does not own", () => {
        expect(
            refused(
                spell(
                    "Wrapper",
                    "{R}",
                    "Sorcery",
                    "Wrapper deals damage to target creature equal to the number of Mountains your opponents control."
                )
            )
        ).toBe(true);
    });

    it("refuses a dealer that is not the source", () => {
        expect(
            refused(
                spell(
                    "Wrapper",
                    "{R}",
                    "Sorcery",
                    "Target creature deals damage to target creature equal to the number of Mountains you control."
                )
            )
        ).toBe(true);
    });

    it("refuses a count clause the engine's count cannot express", () => {
        expect(
            refused(
                spell(
                    "Wrapper",
                    "{R}",
                    "Sorcery",
                    "Wrapper deals damage to target creature equal to the number of tapped Mountains you control."
                )
            )
        ).toBe(true);
    });
});

describe("damage equal to the number of <permanents> you control — behaviour (issue #4314)", () => {
    it("marks one damage per Mountain the CASTER controls, ignoring other lands and the opponent's", () => {
        const card = spell(
            "Damage Count Probe",
            "{R}",
            "Sorcery",
            "Damage Count Probe deals damage to target creature equal to the number of Mountains you control."
        );
        const id = "test-4314-probe";
        const definition = {
            ...compiledDefinition(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        withTemporaryDefinition(definition, () => {
            const victim = makeInstance(getCardByName("Serra Angel").id, {
                id: "victim",
                controllerId: "p2",
                ownerId: "p2",
            });
            const own = (name: string, key: string) =>
                makeInstance(getCardByName(name).id, { id: key });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            own("Mountain", "m1"),
                            own("Mountain", "m2"),
                            own("Mountain", "m3"),
                            own("Forest", "f1"),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            victim,
                            makeInstance(getCardByName("Mountain").id, {
                                id: "theirs",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                        ],
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "permanent", id: "victim" }]);
            resolveTopOfStack(state);
            expect(victim.damageMarked).toBe(3);
        });
    });
});
