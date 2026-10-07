// Mana and cost sentences — "Add {B}{B}{B}.", the one-shot spell-scoped spend
// permission and the variable payment (issue #4529).
//
// Three layers, each watching a different way the rules can go wrong:
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition (CR 106.1 add mana, CR 609.4b / 118.14 spend
//     permission, CR 107.3f variable payment).
//  2. REFUSALS — the neighbours of each sentence stay `unparsed`: the parser is
//     fail-closed, so a rider the rule does not read refuses the line instead
//     of being dropped.
//  3. BOUNDARY — "Add" stays the mana slot's alone inside an activated ability
//     (CR 605.1a), so a mana ability never becomes an ambiguity.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const DARK_RITUAL = oracleCard({
    oracleId: "53f7c868-b03e-4fc2-8dcf-a75bbfa3272b",
    name: "Dark Ritual",
    manaCost: "{B}",
    typeLine: "Instant",
    oracleText: "Add {B}{B}{B}.",
    power: undefined,
    toughness: undefined,
});

const CATHODION = oracleCard({
    oracleId: "fcd4f816-2de1-4b30-82fb-cb87f45747ea",
    name: "Cathodion",
    manaCost: "{3}",
    typeLine: "Artifact Creature — Construct",
    oracleText: "When this creature dies, add {C}{C}{C}.",
    power: "3",
    toughness: "3",
});

const NORTH_STAR = oracleCard({
    oracleId: "9109437a-da80-463f-a92a-77d693d05d91",
    name: "North Star",
    manaCost: "{4}",
    typeLine: "Artifact",
    oracleText:
        "{4}, {T}: For one spell this turn, you may spend mana as though it were mana of any type to pay that spell's mana cost. (Additional costs are still paid normally.)",
    power: undefined,
    toughness: undefined,
});

const VIGIL_FOR_THE_LOST = oracleCard({
    oracleId: "87a4caa4-cb08-4a0c-b57a-d6d8474b1f5e",
    name: "Vigil for the Lost",
    manaCost: "{3}{W}",
    typeLine: "Enchantment",
    oracleText:
        "Whenever a creature you control dies, you may pay {X}. If you do, you gain X life.",
    power: undefined,
    toughness: undefined,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") throw new Error(`${card.name} unparsed`);
    return outcome.definition;
}

/** A spell whose whole text is `text`, for the refusal neighbours. */
function spell(text: string) {
    return compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{B}",
            typeLine: "Instant",
            oracleText: text,
            power: undefined,
            toughness: undefined,
        })
    );
}

/** An enchantment whose whole text is `text`, for the trigger neighbours. */
function enchantment(text: string) {
    return compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{2}{W}",
            typeLine: "Enchantment",
            oracleText: text,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("Add {mana} — golden fixtures (CR 106.1)", () => {
    it("Dark Ritual: a spell that adds fixed pips", () => {
        expect(sortKeys(compiled(DARK_RITUAL))).toEqual(
            sortKeys({
                name: "Dark Ritual",
                types: ["Instant"],
                manaCost: { B: 1 },
                oracleText: "Add {B}{B}{B}.",
                effects: [{ op: "addMana", mana: { B: 3 } }],
            })
        );
    });

    it("Cathodion: a death trigger that adds fixed pips", () => {
        expect(sortKeys(compiled(CATHODION))).toEqual(
            sortKeys({
                name: "Cathodion",
                types: ["Artifact", "Creature"],
                subtypes: ["Construct"],
                manaCost: { X: 3 },
                power: 3,
                toughness: 3,
                oracleText: "When this creature dies, add {C}{C}{C}.",
                compiledTriggeredAbilities: [
                    {
                        id: "cathodion-trigger",
                        oracleText: "When this creature dies, add {C}{C}{C}.",
                        head: { kind: "died", scope: "self" },
                        effects: [{ op: "addMana", mana: { C: 3 } }],
                    },
                ],
            })
        );
    });
});

describe("Add {mana} — refused neighbours", () => {
    it("a spend restriction behind the pips is not dropped", () => {
        expect(
            spell(
                "Add {R}{R}{R}{R}{R}{R}{R}. Spend this mana only to cast artifact or creature spells."
            ).state
        ).toBe("unparsed");
    });

    it('"one mana of any color" is a descriptor, not fixed pips', () => {
        expect(
            enchantment(
                "When this enchantment enters, add one mana of any color."
            ).state
        ).toBe("unparsed");
    });

    it("a generic or {X} amount is not a pip", () => {
        expect(spell("Add {2}.").state).toBe("unparsed");
        expect(spell("Add {X}.").state).toBe("unparsed");
    });

    it('"Add" stays the mana slot\'s inside an activated ability (CR 605.1a)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{1}",
                typeLine: "Artifact",
                oracleText: "{T}: Add {C}.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const text = JSON.stringify(outcome.definition);
        expect(text).toContain('"useStack":false');
    });
});

describe("one-shot spell mana substitution — golden (CR 609.4b, 118.14)", () => {
    it("North Star: the spend permission rides an activated ability", () => {
        expect(sortKeys(compiled(NORTH_STAR))).toEqual(
            sortKeys({
                name: "North Star",
                types: ["Artifact"],
                manaCost: { X: 4 },
                oracleText:
                    "{4}, {T}: For one spell this turn, you may spend mana as though it were mana of any type to pay that spell's mana cost. (Additional costs are still paid normally.)",
                activatedAbilities: [
                    {
                        id: "north-star-ability",
                        oracleText:
                            "{4}, {T}: For one spell this turn, you may spend mana as though it were mana of any type to pay that spell's mana cost.",
                        cost: { mana: { X: 4 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "grantSpellManaSubstitution",
                                player: "controller",
                                breadth: "any-type",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('"any color" is the other breadth', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{4}",
                typeLine: "Artifact",
                oracleText:
                    "{4}, {T}: For one spell this turn, you may spend mana as though it were mana of any color to pay that spell's mana cost.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(JSON.stringify(outcome.definition)).toContain(
            '"breadth":"any-color"'
        );
    });
});

describe("one-shot spell mana substitution — refused neighbours", () => {
    it("a scope clause narrows the grant and is not dropped", () => {
        expect(
            spell(
                "For one spell this turn, you may spend mana as though it were mana of any type to pay that spell's mana cost and activate abilities."
            ).state
        ).toBe("unparsed");
        expect(
            spell(
                "For one spell this turn, you may spend mana as though it were mana of any type to cast creature spells."
            ).state
        ).toBe("unparsed");
    });

    it("the until-end-of-turn, player-wide grant is a different sentence", () => {
        // False Dawn's sibling Op (`grantManaSubstitution`) reads its own
        // anchored form; this rule must not widen onto it.
        expect(
            spell(
                "For one spell this turn, you may spend white mana as though it were mana of any color to pay that spell's mana cost."
            ).state
        ).toBe("unparsed");
    });
});

describe("variable payment — golden (CR 107.3f)", () => {
    it("Vigil for the Lost: the payoff reads the amount paid", () => {
        expect(sortKeys(compiled(VIGIL_FOR_THE_LOST))).toEqual(
            sortKeys({
                name: "Vigil for the Lost",
                types: ["Enchantment"],
                manaCost: { X: 3, W: 1 },
                oracleText:
                    "Whenever a creature you control dies, you may pay {X}. If you do, you gain X life.",
                compiledTriggeredAbilities: [
                    {
                        id: "vigil-for-the-lost-trigger",
                        oracleText:
                            "Whenever a creature you control dies, you may pay {X}. If you do, you gain X life.",
                        head: { kind: "died", scope: "yours" },
                        effects: [
                            {
                                op: "payVariableMana",
                                player: "controller",
                                prompt: "You may pay {X}. If you do, you gain X life",
                                bind: "$paid1",
                            },
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: { ref: "$paid1" },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("variable payment — refused neighbours", () => {
    it('"you may pay {X}" without its payoff pays for nothing', () => {
        expect(
            enchantment("When this enchantment enters, you may pay {X}.").state
        ).toBe("unparsed");
    });

    it('"If you do" without a payment names nothing', () => {
        expect(
            enchantment("When this enchantment enters, if you do, draw a card.")
                .state
        ).toBe("unparsed");
        expect(spell("If you do, you gain 2 life.").state).toBe("unparsed");
    });

    it("a fixed leg beside {X} is a different payment", () => {
        expect(
            enchantment(
                "Whenever you gain life, you may pay {X}{R}. If you do, you gain X life."
            ).state
        ).toBe("unparsed");
    });

    it("a cap on X is a clause the rule does not read", () => {
        expect(
            enchantment(
                "At the beginning of your end step, you may pay {X}. If you do, you gain X life. X can't be greater than the amount of life you gained this turn."
            ).state
        ).toBe("unparsed");
    });
});
