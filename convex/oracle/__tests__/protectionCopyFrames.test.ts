// Two verb frames (CR 702.16i, CR 707.2; issue #4533):
//
//  1. GOLDEN fixtures — real corpus cards compiled whole: "You gain protection
//     from everything until your next turn." (The Stasis Coffin →
//     `setProtectionFromEverything`) and "Create a token that's a copy of this
//     creature." on an activated and a triggered site (Myr Propagator, Giant
//     Adephage → `createTokenCopy` on `$source`).
//  2. REFUSALS — the neighbours the frames do not read: another duration, an
//     announced or anaphoric copy source, the sweep copy.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

const COFFIN_TEXT =
    "{2}, {T}, Exile The Stasis Coffin: You gain protection from everything until your next turn.";
const PROPAGATOR_TEXT =
    "{3}, {T}: Create a token that's a copy of this creature.";
const ADEPHAGE_TRIGGER =
    "Whenever this creature deals combat damage to a player, create a token that's a copy of this creature.";

describe("protection from everything frame — golden (CR 702.16i)", () => {
    it("activated slot: The Stasis Coffin", () => {
        const card = oracleCard({
            name: "The Stasis Coffin",
            manaCost: "{3}",
            typeLine: "Legendary Artifact",
            oracleText: COFFIN_TEXT,
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "The Stasis Coffin",
                types: ["Artifact"],
                supertypes: ["Legendary"],
                manaCost: { X: 3 },
                oracleText: COFFIN_TEXT,
                activatedAbilities: [
                    {
                        id: "the-stasis-coffin-ability",
                        oracleText:
                            "{2}, {T}, Exile {self}: You gain protection from everything until your next turn.",
                        cost: { mana: { X: 2 }, tap: true, exileThis: true },
                        useStack: true,
                        effects: [
                            {
                                op: "setProtectionFromEverything",
                                player: "controller",
                            },
                        ],
                    },
                ],
            })
        );
        expect(compileCard(card).state).toBe("ready");
    });

    it("refuses another duration (the Op's span is fixed)", () => {
        const card = oracleCard({
            name: "Test Coffin",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText:
                "{2}, {T}: You gain protection from everything until end of turn.",
            power: undefined,
            toughness: undefined,
        });
        expect(compileCard(card).state).toBe("unparsed");
    });

    it("refuses a recipient other than you (Vexilus Praetor's commanders)", () => {
        const card = oracleCard({
            name: "Test Coffin",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText:
                "{2}, {T}: Target player gains protection from everything until your next turn.",
            power: undefined,
            toughness: undefined,
        });
        expect(compileCard(card).state).toBe("unparsed");
    });
});

describe("token copy frame — golden (CR 707.2, CR 111.1)", () => {
    it("activated slot: Myr Propagator", () => {
        expect(
            sortKeys(
                compiledDefinition(
                    oracleCard({
                        name: "Myr Propagator",
                        manaCost: "{3}",
                        typeLine: "Artifact Creature — Myr",
                        oracleText: PROPAGATOR_TEXT,
                        power: "1",
                        toughness: "1",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Myr Propagator",
                types: ["Artifact", "Creature"],
                subtypes: ["Myr"],
                manaCost: { X: 3 },
                power: 1,
                toughness: 1,
                oracleText: PROPAGATOR_TEXT,
                activatedAbilities: [
                    {
                        id: "myr-propagator-ability",
                        oracleText: PROPAGATOR_TEXT,
                        cost: { mana: { X: 3 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "createTokenCopy",
                                source: { ref: "$source" },
                                controller: "controller",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("triggered slot: Giant Adephage", () => {
        const definition = compiledDefinition(
            oracleCard({
                name: "Giant Adephage",
                manaCost: "{5}{G}{G}",
                typeLine: "Creature — Insect",
                oracleText: `Trample\n${ADEPHAGE_TRIGGER}`,
                power: "7",
                toughness: "7",
            })
        );
        expect(sortKeys(definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "giant-adephage-trigger",
                    oracleText: ADEPHAGE_TRIGGER,
                    head: { kind: "combat-damage-to-player" },
                    effects: [
                        {
                            op: "createTokenCopy",
                            source: { ref: "$source" },
                            controller: "controller",
                        },
                    ],
                },
            ])
        );
    });

    const refused = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Test Copier",
                manaCost: "{3}",
                typeLine: "Artifact",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        ).state;

    it("refuses an announced copy source", () => {
        expect(
            refused("{7}: Create a token that's a copy of target artifact.")
        ).toBe("unparsed");
    });

    it("refuses the site's anaphora (that creature)", () => {
        expect(
            refused(
                "Whenever a nontoken Zombie you control enters, create a token that's a copy of that creature."
            )
        ).toBe("unparsed");
    });

    it("refuses the populate sweep", () => {
        expect(
            refused(
                "{2}: Create a token that's a copy of a creature token you control."
            )
        ).toBe("unparsed");
    });
});
