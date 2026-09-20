// Mana ability: "Add one mana of any color" (CR 605.1a / 106.1a, issue #4134)
// — the corpus-heaviest mana-production gap (83 cards for which it is the only
// one), and the ONE member of the "any color" family that needs no board
// descriptor: the offered set is the five colours of mana, constant, which is
// the `manaChoices` list the hand-written catalogue already ships for it.
//
// Three layers, the `manaAbilityRider.test.ts` shape:
//
//  1. GOLDEN fixtures — a real corpus card's printed rows compiled to the
//     WHOLE Compiled Definition the rule must produce. Two accepted forms: the
//     bare production (Helionaut, Ceta Disciple — the two APC cards issue
//     #4134 names) and the production carrying the painland rider (Grand
//     Coliseum), which composes for free because the rule lowers to the same
//     CHOICE IR node "Add {B} or {R}" produces.
//  2. GOLD over the hand-written catalogue — Birds of Paradise and Celestial
//     Prism compile from their own printed text back into their own shipped
//     definitions (Guard C).
//  3. REFUSALS — every neighbour that restricts or counts the offered set
//     stays `unparsed`, fail-closed (ADR 0105 § 2): a board-derived filter, a
//     commander's colour identity, a count, and a non-painland rider sentence.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import type { CompiledDefinition, OracleCard } from "../types";
import { birdsOfParadise } from "../../cards/sets/lea/green";
import { celestialPrism } from "../../cards/sets/lea/colorless";
import { oracleCard } from "./fixtures";

const ANY_COLOR: ReadonlyArray<Record<string, number>> = [
    { W: 1 },
    { U: 1 },
    { B: 1 },
    { R: 1 },
    { G: 1 },
];

function compiledOf(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(
            `${card.name} did not reach ready: ${outcome.state} — ${JSON.stringify(
                outcome.state === "unparsed" ? outcome.gaps : outcome.reasons
            )}`
        );
    return outcome.definition;
}

function land(name: string, oracleText: string, oracleId: string): OracleCard {
    return oracleCard({
        oracleId,
        name,
        manaCost: "",
        typeLine: "Land",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("golden — the bare production compiles to a five-colour manaChoices", () => {
    it("Helionaut (APC) — the whole Compiled Definition", () => {
        const compiled = compiledOf(
            oracleCard({
                oracleId: "8d4de785-20e9-430e-8df1-f39dac0ef07d",
                name: "Helionaut",
                manaCost: "{2}{W}",
                typeLine: "Creature — Human Soldier",
                oracleText: "Flying\n{1}, {T}: Add one mana of any color.",
                power: "1",
                toughness: "2",
            })
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Helionaut",
                oracleText: "Flying\n{1}, {T}: Add one mana of any color.",
                manaCost: { X: 2, W: 1 },
                types: ["Creature"],
                subtypes: ["Human", "Soldier"],
                power: 1,
                toughness: 2,
                staticAbilities: ["flying"],
                activatedAbilities: [
                    {
                        id: "helionaut-mana",
                        oracleText: "{1}, {T}: Add one mana of any color.",
                        cost: { mana: { X: 1 }, tap: true },
                        useStack: false,
                        manaChoices: ANY_COLOR,
                    },
                ],
            })
        );
    });

    it("Ceta Disciple (APC) — the mana line beside a stack-using activated line", () => {
        const compiled = compiledOf(
            oracleCard({
                oracleId: "1f085c2d-bd1b-4889-882f-367e0e970f44",
                name: "Ceta Disciple",
                manaCost: "{U}",
                typeLine: "Creature — Merfolk Wizard",
                oracleText:
                    "{R}, {T}: Target creature gets +2/+0 until end of turn.\n{G}, {T}: Add one mana of any color.",
                power: "1",
                toughness: "1",
            })
        );
        const mana = compiled.activatedAbilities!.find(
            (a) => a.id === "ceta-disciple-mana-2"
        );
        expect(sortKeys(mana)).toEqual(
            sortKeys({
                id: "ceta-disciple-mana-2",
                oracleText: "{G}, {T}: Add one mana of any color.",
                cost: { mana: { G: 1 }, tap: true },
                useStack: false,
                manaChoices: ANY_COLOR,
            })
        );
    });
});

describe("golden — the painland rider composes with the any-colour production", () => {
    it("Grand Coliseum — the colourless line merges in and the damage rides the coloured picks", () => {
        const compiled = compiledOf(
            land(
                "Grand Coliseum",
                "This land enters tapped.\n{T}: Add {C}.\n{T}: Add one mana of any color. This land deals 1 damage to you.",
                "1cea9b82-d2e9-4758-8ec8-729fcf4bb7d7"
            )
        );
        expect(compiled.activatedAbilities).toEqual([
            {
                id: "grand-coliseum-mana",
                oracleText:
                    "{T}: Add {C}.\n{T}: Add one mana of any color. This land deals 1 damage to you.",
                cost: { tap: true },
                useStack: false,
                manaChoices: [{ C: 1 }, ...ANY_COLOR],
                dealsDamageToControllerOnColoredTap: 1,
            },
        ]);
    });
});

describe("gold — the hand-written any-colour twins round-trip through their own text", () => {
    it.each([birdsOfParadise, celestialPrism])("$name", (card) => {
        const verdict = roundTripCard(card).verdict;
        expect(sortKeys(verdict)).toEqual({ ok: true, kind: "equal" });
    });
});

describe("refusals — every neighbour that restricts or counts the offered set", () => {
    it.each([
        [
            "a board-derived filter (manaColorSource, not a constant list)",
            "{T}: Add one mana of any color that a land you control could produce.",
        ],
        [
            "a commander's colour identity",
            "{T}: Add one mana of any color in your commander's color identity.",
        ],
        [
            "a COUNT of one chosen colour",
            "{T}: Add three mana of any one color.",
        ],
        [
            "one mana of any one color with a spend restriction",
            "{T}: Add one mana of any one color. Spend this mana only to cast a creature spell.",
        ],
        [
            "a non-painland rider sentence after the production",
            "{T}: Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead.",
        ],
    ])("%s stays unparsed", (_label, oracleText) => {
        const outcome = compileCard(
            land("Refusal Fixture", oracleText, "refusal-fixture")
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("the production is not read inside a longer span (fail-closed on the exact wording)", () => {
        const outcome = compileCard(
            land(
                "Refusal Fixture",
                "{T}: Add one mana of any color among legendary permanents you control.",
                "refusal-fixture"
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
