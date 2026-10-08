// "Sacrifice it unless you <payment>" riders (CR 118.12a, issue #4548).
//
// Three layers:
//
//  1. GOLDEN forms — one real corpus card per accepted payment, compiled whole;
//     the trigger it produces is the `mayPay` + `if not` pair the hand-written
//     catalogue writes (Phyrexian Dreadnought, Treva's Ruins), each payment one
//     `CostLegs` leg: mana, discard, sacrifice, sacrifice-by-total-power, return.
//  2. REFUSALS — printed neighbours the rule must NOT read: a payment with no
//     cost leg (a card returned from the graveyard, life), each pinned to WHERE
//     the compiler gave up so it cannot pass for an unrelated unread line.
//  3. SUBJECT — only the source (or the site's pronoun for it) is sacrificed
//     unless paid for.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const ENTERS = "When this creature enters, ";
const UPKEEP = "At the beginning of your upkeep, ";

function creature(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        oracleText,
    });
}

/** The triggered abilities a card compiles to, failing if it is refused. */
function triggers(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.compiledTriggeredAbilities;
}

/** WHERE the compiler gave up on a card it refuses. */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    expect(outcome.gaps).toHaveLength(1);
    const gap = outcome.gaps[0]!;
    return gap.attribution === undefined
        ? gap.reason
        : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`;
}

/** The pair every form lowers to, around its payment leg and prompt. */
function punisher(cost: unknown, prompt: string) {
    return [
        { op: "mayPay", player: "controller", cost, prompt, bind: "$may1" },
        {
            op: "if",
            predicate: { not: { binding: "$may1" } },
            then: [{ op: "sacrifice", target: { ref: "$source" } }],
        },
    ];
}

describe("sacrifice it unless you … (CR 118.12a)", () => {
    it("pay {mana} — Breeding Pit", () => {
        const card = oracleCard({
            name: "Breeding Pit",
            manaCost: "{3}{B}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {B}{B}.\nAt the beginning of your end step, create a 0/1 black Thrull creature token.",
            power: undefined,
            toughness: undefined,
        });
        expect(triggers(card)![0]).toMatchObject({
            head: { kind: "phase", phase: "UPKEEP", scope: "your" },
            effects: punisher(
                { B: 2 },
                "Pay the cost, or sacrifice Breeding Pit?"
            ),
        });
    });

    it("discard a card — Masticore", () => {
        const card = oracleCard({
            name: "Masticore",
            manaCost: "{4}",
            typeLine: "Artifact Creature — Masticore",
            oracleText: `${UPKEEP}sacrifice this creature unless you discard a card.\n{2}: This creature deals 1 damage to target creature.\n{2}: Regenerate this creature.`,
            power: "4",
            toughness: "4",
        });
        expect(triggers(card)![0]).toMatchObject({
            head: { kind: "phase", phase: "UPKEEP", scope: "your" },
            effects: punisher(
                {
                    hand: {
                        action: "discard",
                        requirements: [{ filter: {}, count: 1 }],
                    },
                },
                "Discard a card, or sacrifice Masticore?"
            ),
        });
    });

    it("sacrifice a Forest — Rogue Elephant", () => {
        expect(
            triggers(
                creature(
                    "Rogue Elephant",
                    `${ENTERS}sacrifice it unless you sacrifice a Forest.`
                )
            )![0]
        ).toMatchObject({
            head: { kind: "entered", scope: "self" },
            effects: punisher(
                {
                    permanent: {
                        action: "sacrifice",
                        filter: { subtypes: ["Forest"] },
                        count: 1,
                    },
                },
                "Sacrifice a permanent, or sacrifice Rogue Elephant?"
            ),
        });
    });

    it("sacrifice creatures with total power N — Phyrexian Dreadnought", () => {
        expect(
            triggers(
                creature(
                    "Phyrexian Dreadnought",
                    `${ENTERS}sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.`
                )
            )![0]
        ).toMatchObject({
            effects: punisher(
                {
                    permanent: {
                        action: "sacrifice",
                        filter: { types: ["Creature"] },
                        count: { minTotalPower: 12 },
                    },
                },
                "Sacrifice creatures with total power 12 or greater, or sacrifice Phyrexian Dreadnought?"
            ),
        });
    });

    it("return a non-Lair land you control — Treva's Ruins", () => {
        const card = oracleCard({
            name: "Treva's Ruins",
            manaCost: "",
            typeLine: "Land — Lair",
            oracleText:
                "When this land enters, sacrifice it unless you return a non-Lair land you control to its owner's hand.\n{T}: Add {G}, {W}, or {U}.",
            power: undefined,
            toughness: undefined,
        });
        expect(triggers(card)![0]).toMatchObject({
            head: { kind: "entered", scope: "self" },
            effects: punisher(
                {
                    permanent: {
                        action: "return",
                        filter: {
                            types: ["Land"],
                            excludeSubtypes: ["Lair"],
                        },
                        count: 1,
                    },
                },
                "Return a permanent you control to its owner's hand, or sacrifice Treva's Ruins?"
            ),
        });
    });
});

describe("sacrifice it unless you … — refused neighbours", () => {
    it("refuses a card returned from the graveyard — Harvest Wurm", () => {
        expect(
            refusedAt(
                creature(
                    "Harvest Wurm",
                    `${ENTERS}sacrifice it unless you return a basic land card from your graveyard to your hand.`
                )
            )
        ).toBe(
            "effect clause: Sacrifice it unless you return a basic land card from your graveyard to your hand"
        );
    });

    it("refuses a life payment — Season of the Witch", () => {
        const card = oracleCard({
            name: "Season of the Witch",
            manaCost: "{B}{B}{B}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay 2 life.",
            power: undefined,
            toughness: undefined,
        });
        expect(refusedAt(card)).toBe(
            "effect clause: Sacrifice this enchantment unless you pay 2 life"
        );
    });

    it("refuses a payment that returns more than a permanent you control", () => {
        expect(
            refusedAt(
                creature(
                    "Test Bear",
                    `${ENTERS}sacrifice it unless you return a land to its owner's hand.`
                )
            )
        ).toBe(
            "effect clause: Sacrifice it unless you return a land to its owner's hand"
        );
    });

    it("refuses a plural where one is printed", () => {
        expect(
            refusedAt(
                creature(
                    "Test Bear",
                    `${ENTERS}sacrifice it unless you sacrifice a Forests.`
                )
            )
        ).toContain("effect clause");
    });
});

describe("sacrifice it unless you … — the subject", () => {
    it("refuses a sacrificed object that is not the source", () => {
        expect(
            refusedAt(
                creature(
                    "Test Bear",
                    `${ENTERS}sacrifice target creature unless you discard a card.`
                )
            )
        ).toContain("effect clause");
    });
});
