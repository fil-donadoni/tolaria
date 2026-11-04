// CR 602.1b (issue #3685) — the Oracle compiler reads Threshold's spelled-out
// "Activate only if there are N or more cards in your graveyard" into the
// declarative `ActivatedAbility.activationCondition`, and drops the ability
// word heading the line (CR 207.2c) before the activation cost is read.
//
// CR 205.2a — Delirium's "N or more card types among cards in your graveyard"
// reads into the same field as a `countTypes` tally.
//
// Goldens are REAL corpus rows. The neighbours a threshold-like clause prints
// that an activation-time condition cannot read (a filtered count, a
// permanent-type tally) are pinned as refusals so fail-closed is a fact, not an
// assumption.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { sentenceRule } from "../grammar/shared/effectClause";
import { oracleCard, parseContext } from "./oracle.fixture";

function land(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "",
        typeLine: "Land",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

const THRESHOLD_SEVEN = {
    left: { count: { zone: "graveyard", controller: "controller" } },
    op: "ge",
    right: 7,
};

const DELIRIUM_FOUR = {
    left: {
        count: {
            zone: "graveyard",
            controller: "controller",
            countTypes: true,
        },
    },
    op: "ge",
    right: 4,
};

describe("Threshold activation condition — golden fixtures (CR 602.1b)", () => {
    it('"there are N or more cards in your graveyard" (Barbarian Ring), the whole definition', () => {
        const outcome = compileCard(
            land(
                "Barbarian Ring",
                "{T}: Add {R}. This land deals 1 damage to you.\nThreshold — {R}, {T}, Sacrifice this land: It deals 2 damage to any target. Activate only if there are seven or more cards in your graveyard."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Barbarian Ring",
                types: ["Land"],
                oracleText:
                    "{T}: Add {R}. This land deals 1 damage to you.\nThreshold — {R}, {T}, Sacrifice this land: It deals 2 damage to any target. Activate only if there are seven or more cards in your graveyard.",
                activatedAbilities: [
                    {
                        id: "barbarian-ring-mana",
                        oracleText:
                            "{T}: Add {R}. This land deals 1 damage to you.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { R: 1 },
                        dealsDamageToControllerOnTap: 1,
                    },
                    {
                        id: "barbarian-ring-ability-2",
                        oracleText:
                            "Threshold — {R}, {T}, Sacrifice this land: It deals 2 damage to any target. Activate only if there are seven or more cards in your graveyard.",
                        cost: { mana: { R: 1 }, tap: true, sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 2,
                                to: { target: 0 },
                            },
                        ],
                        targetRequirement: { type: "any", count: 1 },
                        activationCondition: THRESHOLD_SEVEN,
                    },
                ],
            })
        );
        // The comparator's `op` is a predicate field, never an Effect Op.
        expect(outcome.opsUsed).toEqual(["dealDamage"]);
    });

    it('"N or more cards are in your graveyard" (Shellfish Scholar\'s word order), the restriction sentence', () => {
        const parsed = sentenceRule.run(
            "Activate only if seven or more cards are in your graveyard",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            role: "restriction",
            restrictions: [{ kind: "own-graveyard-at-least", count: 7 }],
        });
    });
});

describe("Delirium activation condition — golden fixtures (CR 205.2a, CR 602.5)", () => {
    it('"there are N or more card types among cards in your graveyard" (Stallion of Ashmouth), the whole definition', () => {
        const line =
            "Delirium — {1}{B}: This creature gets +1/+1 until end of turn. Activate only if there are four or more card types among cards in your graveyard.";
        const outcome = compileCard(
            oracleCard({
                name: "Stallion of Ashmouth",
                manaCost: "{3}{B}",
                typeLine: "Creature — Nightmare Horse",
                oracleText: line,
                power: "3",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Stallion of Ashmouth",
                types: ["Creature"],
                subtypes: ["Nightmare", "Horse"],
                manaCost: { X: 3, B: 1 },
                power: 3,
                toughness: 3,
                oracleText: line,
                activatedAbilities: [
                    {
                        id: "stallion-of-ashmouth-ability",
                        oracleText: line,
                        cost: { mana: { X: 1, B: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 1,
                                toughness: 1,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                        activationCondition: DELIRIUM_FOUR,
                    },
                ],
            })
        );
    });

    it('the tally joined to a timing restriction by "and only" (Resurrected Cultist), the restriction sentence', () => {
        const parsed = sentenceRule.run(
            "Activate only if there are four or more card types among cards in your graveyard and only as a sorcery",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            role: "restriction",
            restrictions: [
                { kind: "own-graveyard-card-types-at-least", count: 4 },
                { kind: "sorcery-only" },
            ],
        });
    });
});

describe("Threshold activation condition — refused neighbours (fail-closed)", () => {
    /** True when the span reads as an activation restriction at all. */
    const readsAsRestriction = (span: string): boolean => {
        const parsed = sentenceRule.run(span, parseContext());
        return parsed.ok && parsed.value.role === "restriction";
    };

    it("a filtered count (Gate to the Afterlife's creature cards)", () => {
        expect(
            readsAsRestriction(
                "Activate only if there are six or more creature cards in your graveyard"
            )
        ).toBe(false);
    });

    it("a permanent-type tally (Matzalantli's, a narrower set than CR 205.2a's card types)", () => {
        expect(
            readsAsRestriction(
                "Activate only if there are four or more permanent types among cards in your graveyard"
            )
        ).toBe(false);
    });

    it("an ability word alone does not make a line parse: the rest must still read", () => {
        // Krosan Restorer's "up to three target lands" is its own gap; dropping
        // "Threshold" must not swallow it.
        const outcome = compileCard(
            oracleCard({
                name: "Krosan Restorer",
                manaCost: "{2}{G}",
                typeLine: "Creature — Human Druid",
                oracleText:
                    "{T}: Untap target land.\nThreshold — {T}: Untap up to three target lands. Activate only if there are seven or more cards in your graveyard.",
                power: "1",
                toughness: "2",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
