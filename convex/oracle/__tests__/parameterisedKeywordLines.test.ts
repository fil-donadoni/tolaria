// Parameterised keyword lines on implemented keywords (issue #7214):
// Equip (CR 702.6a), Crew (CR 702.122a), Ninjutsu (CR 702.49a), Offspring
// (CR 702.175a).
//
// Three layers, each watching a different way a parameterised keyword goes
// wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition: the parameter lands in the ability the
//     catalogue's own factory builds (`equipAbility`, `crewAbility`,
//     `ninjutsuAbility`, `offspringTriggerParts`), never dropped.
//  2. REFUSALS — the neighbours the rules must NOT read: a restricted equip
//     (CR 702.6c), a cost the payment path cannot pay, crew off a Vehicle,
//     commander ninjutsu, a second declaration — and Ward, which has no JSON
//     trigger shape yet. Fail-closed is pinned, not assumed (ADR 0105 § 2).
//  3. The compiled-trigger TWIN link (CR 702.175b): a descriptor's
//     `additionalCostTwin` is stamped only onto a trigger gated on that same
//     cost.

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function readLine(line: string) {
    return keywordLineSlot.run(line, parseContext());
}

const ARADARA_EXPRESS_TEXT =
    "Menace\nCrew 4 (Tap any number of creatures you control with total power 4 or more: This Vehicle becomes an artifact creature until end of turn.)";

const NINJA_TEXT =
    "Ninjutsu {1}{U} ({1}{U}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nWhenever this creature deals combat damage to a player, you may draw a card.";

const THUNDERTRAP_TEXT =
    "Offspring {4} (You may pay an additional {4} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nWhen this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";

describe("Equip [cost] (CR 702.6a)", () => {
    // No corpus Equipment compiles whole yet (every one prints an equipped-
    // creature line this grammar does not read), so the golden is a real
    // Equip line on its own card's type line, as `kickerLine.test.ts` does
    // for a kicker line.
    it("Bonesplitter's Equip {1}: the catalogue's own `equipAbility`, generic as `generic`", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Bonesplitter",
                    manaCost: "{1}",
                    typeLine: "Artifact — Equipment",
                    power: undefined,
                    toughness: undefined,
                    oracleText: "Equip {1}",
                })
            )
        ).toEqual({
            name: "Bonesplitter",
            types: ["Artifact"],
            subtypes: ["Equipment"],
            manaCost: { X: 1 },
            oracleText: "Equip {1}",
            activatedAbilities: [
                {
                    id: "bonesplitter-equip",
                    oracleText: "Equip {1}",
                    cost: { mana: { generic: 1 } },
                    sorcerySpeedOnly: true,
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "you",
                    },
                    useStack: true,
                    effects: [{ op: "attach", target: { target: 0 } }],
                },
            ],
        });
    });

    it("a coloured equip cost keeps its pips beside the generic", () => {
        const def = compiled(
            oracleCard({
                name: "Strata Scythe",
                manaCost: "{3}",
                typeLine: "Artifact — Equipment",
                power: undefined,
                toughness: undefined,
                oracleText: "Equip {1}{R}",
            })
        );
        expect(def.activatedAbilities?.[0]?.cost).toEqual({
            mana: { generic: 1, R: 1 },
        });
    });

    it.each([
        ["a restricted equip (CR 702.6c)", "Equip legendary creature {3}"],
        ["equip planeswalker (CR 702.6e)", "Equip planeswalker {1}"],
        ["a non-mana cost", "Equip—Pay 3 life."],
        ["a Phyrexian pip", "Equip {B/P}{B/P}"],
        ["a variable cost", "Equip {X}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES equip on a card that is not an Equipment (CR 702.6a)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Not An Equipment",
                typeLine: "Artifact",
                power: undefined,
                toughness: undefined,
                oracleText: "Equip {2}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Crew N (CR 702.122a)", () => {
    it("Aradara Express: the catalogue's `crewAbility` at the printed P/T, plus the keyword", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Aradara Express",
                    manaCost: "{5}",
                    typeLine: "Artifact — Vehicle",
                    power: "8",
                    toughness: "6",
                    oracleText: ARADARA_EXPRESS_TEXT,
                })
            )
        ).toEqual({
            name: "Aradara Express",
            types: ["Artifact"],
            subtypes: ["Vehicle"],
            manaCost: { X: 5 },
            oracleText: ARADARA_EXPRESS_TEXT,
            staticAbilities: ["menace", "crew 4"],
            activatedAbilities: [
                {
                    id: "aradara-express-crew",
                    oracleText:
                        "Crew 4 (Tap any number of creatures you control with total power 4 or more: This Vehicle becomes an artifact creature until end of turn.)",
                    cost: {
                        tapOtherFilter: {
                            filter: {
                                types: "Creature",
                                controllerRelation: "you",
                            },
                            totalPower: 4,
                        },
                    },
                    useStack: true,
                    animatesSelf: true,
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 8,
                            toughness: 6,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
            power: 8,
            toughness: 6,
        });
    });

    it.each([
        ["Crew 0", "Crew 0"],
        ["a variable crew", "Crew X"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it.each([
        ["a non-Vehicle artifact", "Artifact", "3", "3"],
        ["a creature Vehicle", "Artifact Creature — Vehicle", "3", "3"],
        ["a Vehicle with a * power", "Artifact — Vehicle", "*", "3"],
    ])("REFUSES crew on %s", (_why, typeLine, power, toughness) => {
        const outcome = compileCard(
            oracleCard({
                name: "Crewed Thing",
                typeLine,
                power,
                toughness,
                oracleText: "Crew 2",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Ninjutsu [cost] (CR 702.49a)", () => {
    it("Ninja of the Deep Hours: the catalogue's `ninjutsuAbility`", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Ninja of the Deep Hours",
                    manaCost: "{3}{U}",
                    typeLine: "Creature — Human Ninja",
                    power: "2",
                    toughness: "2",
                    oracleText: NINJA_TEXT,
                })
            )
        ).toEqual({
            name: "Ninja of the Deep Hours",
            types: ["Creature"],
            subtypes: ["Human", "Ninja"],
            manaCost: { X: 3, U: 1 },
            power: 2,
            toughness: 2,
            oracleText: NINJA_TEXT,
            activatedAbilities: [
                {
                    id: "ninjutsu",
                    oracleText:
                        "Ninjutsu {1}{U} ({1}{U}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)",
                    cost: {
                        mana: { X: 1, U: 1 },
                        returnUnblockedAttacker: true,
                    },
                    activateFromHand: true,
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            from: "hand",
                            to: "battlefield",
                            tapped: true,
                            attacking: true,
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "ninja-of-the-deep-hours-trigger",
                    oracleText:
                        "Whenever this creature deals combat damage to a player, you may draw a card.",
                    head: { kind: "combat-damage-to-player" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Draw a card?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                { op: "draw", player: "controller", count: 1 },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it.each([
        ["a variable cost", "Ninjutsu {X}{B}"],
        ["commander ninjutsu (CR 702.49d)", "Commander ninjutsu {2}{U}{B}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a card declaring ninjutsu twice (one ability id per card)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Ninja",
                oracleText: "Ninjutsu {1}{U}\nNinjutsu {2}{B}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Offspring [cost] (CR 702.175a)", () => {
    it("Thundertrap Trainer: the cost entry and its twin trigger, from one line", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Thundertrap Trainer",
                    manaCost: "{1}{U}",
                    typeLine: "Creature — Otter Wizard",
                    power: "1",
                    toughness: "2",
                    oracleText: THUNDERTRAP_TEXT,
                })
            )
        ).toEqual({
            name: "Thundertrap Trainer",
            types: ["Creature"],
            subtypes: ["Otter", "Wizard"],
            manaCost: { X: 1, U: 1 },
            power: 1,
            toughness: 2,
            oracleText: THUNDERTRAP_TEXT,
            kickers: [
                {
                    id: "offspring",
                    keyword: "offspring",
                    description: "Offspring {4}",
                    mana: { X: 4 },
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "offspring-token-copy-offspring",
                    oracleText:
                        "When Thundertrap Trainer enters, if its offspring cost was paid, create a token that's a copy of it, except it's 1/1.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "offspring" },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "offspring" },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "createTokenCopy",
                                    source: { ref: "$source" },
                                    controller: "controller",
                                    except: { basePower: 1, baseToughness: 1 },
                                },
                            ],
                        },
                    ],
                    additionalCostTwin: {
                        keyword: "offspring",
                        costId: "offspring",
                    },
                },
                {
                    id: "thundertrap-trainer-trigger-2",
                    oracleText:
                        "When this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "lookDistribute",
                            keepTo: "hand",
                            player: "controller",
                            look: 4,
                            take: 1,
                            filter: { excludeType: ["Creature", "Land"] },
                            optional: true,
                            reveal: "kept",
                            randomBottom: true,
                        },
                    ],
                },
            ],
        });
    });

    it("the rebuilt trigger carries the twin link the catalogue guard reads", () => {
        const def = compiled(
            oracleCard({
                name: "Thundertrap Trainer",
                manaCost: "{1}{U}",
                typeLine: "Creature — Otter Wizard",
                power: "1",
                toughness: "2",
                oracleText: THUNDERTRAP_TEXT,
            })
        );
        const ability = resolveCompiledTrigger(
            def.compiledTriggeredAbilities![0]!
        );
        expect(ability.additionalCostTwin).toEqual({
            keyword: "offspring",
            costId: "offspring",
        });
    });

    it("REFUSES to stamp a twin onto a trigger not gated on that cost (CR 702.175b)", () => {
        expect(() =>
            resolveCompiledTrigger({
                id: "orphan-twin",
                oracleText: "When this creature enters, draw a card.",
                head: { kind: "entered", scope: "self" },
                effects: [{ op: "draw", player: "controller", count: 1 }],
                additionalCostTwin: {
                    keyword: "offspring",
                    costId: "offspring",
                },
            })
        ).toThrow(/additional-cost twin/);
    });

    it.each([
        ["a variable cost", "Offspring {X}"],
        ["a hybrid pip", "Offspring {W/U}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a card declaring offspring twice (CR 702.175b)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Offspring",
                oracleText: "Offspring {1}\nOffspring {2}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Ward stays refused (CR 702.21a) — no JSON trigger shape yet", () => {
    // `wardAbility` narrows its BECAME_TARGET trigger with a `matches`
    // closure (this permanent, an opponent's spell or ability), which no
    // compiled trigger head expresses; compiling the keyword string alone
    // would ship a ward that never counters anything.
    it.each([
        ["a mana ward in a keyword run", "Flying, ward {2}"],
        ["a bare mana ward", "Ward {2}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES Ward—Pay N life", () => {
        const outcome = compileCard(
            oracleCard({ name: "Life Warded", oracleText: "Ward—Pay 2 life." })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
