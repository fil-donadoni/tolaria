// Mana ability: board-derived productions (issue #5195) — a mana AMOUNT
// counted off the battlefield ("Add {G} for each creature you control", CR
// 608.2h / 605.1a) and a mana TYPE read off it ("one mana of any type that a
// land you control could produce", CR 106.7 / 106.1b). Both lower to a JSON
// descriptor the engine evaluates at activation — `manaAmountSource` and a
// `"producesType"` `manaColorSource` — where the hand-written catalogue used a
// `manaAmount` closure no compiled definition can carry (ADR 0046).
//
// Three layers, the `manaAnyColor.test.ts` shape:
//
//  1. GOLDEN fixtures — a real corpus card's printed rows compiled to the
//     WHOLE Compiled Definition the rule must produce. Three accepted forms:
//     a count of permanents "you control" (Gaea's Cradle; Cabal Stronghold's
//     costed, supertype-filtered line beside a plain {C} one), a count "on
//     the battlefield" (Priest of Titania — every player's Elves, CR 109.2),
//     and the any-TYPE read (Reflecting Pool).
//  2. GOLD over the hand-written catalogue — Gaea's Cradle, Tolarian Academy
//     and Serra's Sanctum compile from their own printed text back into their
//     own shipped definitions (Guard C).
//  3. REFUSALS — every neighbour the descriptor cannot carry stays
//     `unparsed`, fail-closed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import type { CompiledDefinition, OracleCard } from "../types";
import {
    gaeasCradle,
    serrasSanctum,
    tolarianAcademy,
} from "../../cards/sets/usg/colorless.cards";
import { oracleCard } from "./oracle.fixture";

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

describe("golden — a count of permanents lowers to manaAmountSource (CR 608.2h)", () => {
    it('Gaea\'s Cradle — "for each creature you control": the whole Compiled Definition', () => {
        const compiled = compiledOf(
            oracleCard({
                oracleId: "7c427c3d-ecd8-45ef-bebd-8f10f4a311db",
                name: "Gaea's Cradle",
                manaCost: "",
                typeLine: "Legendary Land",
                oracleText: "{T}: Add {G} for each creature you control.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Gaea's Cradle",
                oracleText: "{T}: Add {G} for each creature you control.",
                types: ["Land"],
                supertypes: ["Legendary"],
                activatedAbilities: [
                    {
                        id: "gaea-s-cradle-mana",
                        oracleText:
                            "{T}: Add {G} for each creature you control.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { G: 1 },
                        manaAmountSource: {
                            filter: {
                                types: ["Creature"],
                                controllerRelation: "you",
                            },
                        },
                    },
                ],
            })
        );
    });

    it('Priest of Titania — "for each Elf on the battlefield": no controller clause (CR 109.2)', () => {
        const compiled = compiledOf(
            oracleCard({
                oracleId: "3a198a16-17b9-481e-b516-5bc945c7e247",
                name: "Priest of Titania",
                manaCost: "{1}{G}",
                typeLine: "Creature — Elf Druid",
                oracleText: "{T}: Add {G} for each Elf on the battlefield.",
                power: "1",
                toughness: "1",
            })
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Priest of Titania",
                oracleText: "{T}: Add {G} for each Elf on the battlefield.",
                manaCost: { X: 1, G: 1 },
                types: ["Creature"],
                subtypes: ["Elf", "Druid"],
                power: 1,
                toughness: 1,
                activatedAbilities: [
                    {
                        id: "priest-of-titania-mana",
                        oracleText:
                            "{T}: Add {G} for each Elf on the battlefield.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { G: 1 },
                        manaAmountSource: { filter: { subtypes: ["Elf"] } },
                    },
                ],
            })
        );
    });

    it("Cabal Stronghold — a costed, supertype-filtered count beside a plain {C} ability", () => {
        const compiled = compiledOf(
            land(
                "Cabal Stronghold",
                "{T}: Add {C}.\n{3}, {T}: Add {B} for each basic Swamp you control.",
                "066cd584-773c-4623-be53-8f6feda5a26a"
            )
        );
        expect(sortKeys(compiled.activatedAbilities)).toEqual(
            sortKeys([
                {
                    id: "cabal-stronghold-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
                {
                    id: "cabal-stronghold-mana-2",
                    oracleText:
                        "{3}, {T}: Add {B} for each basic Swamp you control.",
                    cost: { mana: { X: 3 }, tap: true },
                    useStack: false,
                    manaProduced: { B: 1 },
                    manaAmountSource: {
                        filter: {
                            subtypes: ["Swamp"],
                            supertypes: ["Basic"],
                            controllerRelation: "you",
                        },
                    },
                },
            ])
        );
    });
});

describe("golden — the any-TYPE read lowers to a producesType manaColorSource (CR 106.7)", () => {
    it("Reflecting Pool — the whole Compiled Definition, {C} in the no-board fallback", () => {
        const compiled = compiledOf(
            land(
                "Reflecting Pool",
                "{T}: Add one mana of any type that a land you control could produce.",
                "67f43ac6-2a58-4b53-b5d7-0330e2a252e2"
            )
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Reflecting Pool",
                oracleText:
                    "{T}: Add one mana of any type that a land you control could produce.",
                types: ["Land"],
                activatedAbilities: [
                    {
                        id: "reflecting-pool-mana",
                        oracleText:
                            "{T}: Add one mana of any type that a land you control could produce.",
                        cost: { tap: true },
                        useStack: false,
                        // CR 106.1b — the six types, colourless included.
                        manaChoices: [
                            { W: 1 },
                            { U: 1 },
                            { B: 1 },
                            { R: 1 },
                            { G: 1 },
                            { C: 1 },
                        ],
                        manaColorSource: {
                            filter: {
                                types: ["Land"],
                                controllerRelation: "you",
                            },
                            colors: "producesType",
                        },
                    },
                ],
            })
        );
    });
});

describe("gold — the hand-written board-count lands round-trip through their own text", () => {
    it.each([gaeasCradle(), tolarianAcademy(), serrasSanctum()])(
        "$name",
        (card) => {
            const verdict = roundTripCard(card).verdict;
            expect(sortKeys(verdict)).toEqual({ ok: true, kind: "equal" });
        }
    );
});

describe("refusals — every neighbour the board-derived descriptor cannot carry", () => {
    it.each([
        [
            "a keyword clause on the counted permanents (Overgrown Battlement)",
            "{T}: Add {G} for each creature you control with defender.",
        ],
        [
            "a count of cards in a graveyard (Crypt of Agadeem — not the battlefield)",
            "{2}, {T}: Add {B} for each black creature card in your graveyard.",
        ],
        [
            "a power bound on the counted creatures",
            "{T}: Add {G} for each creature with power 4 or greater you control.",
        ],
        [
            "a count of permanents an OPPONENT controls",
            "{T}: Add {R} for each creature an opponent controls.",
        ],
        [
            "a unit of two mana",
            "{T}: Add {G}{G} for each creature you control.",
        ],
        [
            "a counter count on the source (no descriptor names it)",
            "{T}: Add {C} for each charge counter on this artifact.",
        ],
        [
            "the any-COLOR read of an opponent's lands (Fellwar Stone — its own gap)",
            "{T}: Add one mana of any color that a land an opponent controls could produce.",
        ],
        [
            "the any-TYPE read of an opponent's lands",
            "{T}: Add one mana of any type that a land an opponent controls could produce.",
        ],
        [
            "the any-TYPE read of a sacrificed land (not on the battlefield at resolution)",
            "{T}, Sacrifice a land: Add one mana of any type the sacrificed land could produce.",
        ],
    ])("%s stays unparsed", (_label, oracleText) => {
        const outcome = compileCard(
            land("Refusal Fixture", oracleText, "refusal-fixture")
        );
        expect(outcome.state).toBe("unparsed");
    });
});
