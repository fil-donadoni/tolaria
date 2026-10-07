// Mana ability riders and entry counters (CR 605.1a / 121.1 / 122.1 / 614.1c,
// issue #4542) — the sentences a mana production can carry beyond the painland
// ping, each lowered to the one `ActivatedAbility` field the engine already
// reads for it:
//
//   "This land deals N damage to you"  after a FIXED production
//                                       → dealsDamageToControllerOnTap
//   "Draw a card"                       → drawsCardOnTap
//   "If there are no <kind> counters on this land, sacrifice it"
//                                       → sacrificesSourceWhenNoCountersRemain
//   "This land enters with N <kind> counters on it"
//                                       → entersWith.counters
//
// Three layers, the `manaAbilityRider.test.ts` shape:
//
//  1. GOLDEN fixtures — a real corpus card's printed rows compiled to the
//     WHOLE Compiled Definition the rule must produce, one per accepted form.
//  2. GOLD over the hand-written catalogue — Ancient Tomb, Chromatic Sphere and
//     Saprazzan Skerry compile from their own text into their own definitions.
//  3. REFUSALS — every neighbour stays `unparsed`, fail-closed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import type { CompiledDefinition, OracleCard } from "../types";
import { chromaticSphere } from "../../cards/sets/inv/colorless.cards";
import { saprazzanSkerry } from "../../cards/sets/mmq/colorless.cards";
import { ancientTomb } from "../../cards/sets/tmp/colorless.cards";
import { oracleCard } from "./oracle.fixture";

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

function land(name: string, oracleText: string, oracleId = name): OracleCard {
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

function artifact(
    name: string,
    manaCost: string,
    oracleText: string,
    oracleId = name
): OracleCard {
    return oracleCard({
        oracleId,
        name,
        manaCost,
        typeLine: "Artifact",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("golden — one fixture per accepted rider form", () => {
    it("Ancient Tomb (Tempest) — the unconditional ping after a FIXED production", () => {
        const text = "{T}: Add {C}{C}. This land deals 2 damage to you.";
        expect(sortKeys(compiledOf(land("Ancient Tomb", text)))).toEqual(
            sortKeys({
                name: "Ancient Tomb",
                oracleText: text,
                types: ["Land"],
                activatedAbilities: [
                    {
                        id: "ancient-tomb-mana",
                        oracleText: text,
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { C: 2 },
                        dealsDamageToControllerOnTap: 2,
                    },
                ],
            })
        );
    });

    it("Chromatic Sphere (Invasion) — the draw after a five-colour choice", () => {
        const text =
            "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card.";
        expect(
            sortKeys(compiledOf(artifact("Chromatic Sphere", "{1}", text)))
        ).toEqual(
            sortKeys({
                name: "Chromatic Sphere",
                oracleText: text,
                manaCost: { X: 1 },
                types: ["Artifact"],
                activatedAbilities: [
                    {
                        id: "chromatic-sphere-mana",
                        oracleText: text,
                        cost: { mana: { X: 1 }, tap: true, sacrifice: true },
                        useStack: false,
                        manaChoices: ANY_COLOR,
                        drawsCardOnTap: 1,
                    },
                ],
            })
        );
    });

    it("Mossfire Egg (Invasion, no hand-written twin) — the draw after a FIXED production", () => {
        const text =
            "{2}, {T}, Sacrifice this artifact: Add {R}{G}. Draw a card.";
        expect(
            sortKeys(compiledOf(artifact("Mossfire Egg", "{3}", text)))
        ).toEqual(
            sortKeys({
                name: "Mossfire Egg",
                oracleText: text,
                manaCost: { X: 3 },
                types: ["Artifact"],
                activatedAbilities: [
                    {
                        id: "mossfire-egg-mana",
                        oracleText: text,
                        cost: { mana: { X: 2 }, tap: true, sacrifice: true },
                        useStack: false,
                        manaProduced: { R: 1, G: 1 },
                        drawsCardOnTap: 1,
                    },
                ],
            })
        );
    });

    it("Saprazzan Skerry (Mercadian Masques) — the depletion sacrifice", () => {
        const text =
            "{T}, Remove a depletion counter from this land: Add {U}{U}. If there are no depletion counters on this land, sacrifice it.";
        expect(sortKeys(compiledOf(land("Saprazzan Skerry", text)))).toEqual(
            sortKeys({
                name: "Saprazzan Skerry",
                oracleText: text,
                types: ["Land"],
                activatedAbilities: [
                    {
                        id: "saprazzan-skerry-mana",
                        oracleText: text,
                        cost: {
                            tap: true,
                            removeCounter: { type: "depletion", count: 1 },
                        },
                        useStack: false,
                        manaProduced: { U: 2 },
                        sacrificesSourceWhenNoCountersRemain: "depletion",
                    },
                ],
            })
        );
    });

    it("Gemstone Mine (Nemesis) — unconditional entry counters beside the mining sacrifice", () => {
        const enters = "This land enters with three mining counters on it.";
        const mana =
            "{T}, Remove a mining counter from this land: Add one mana of any color. If there are no mining counters on this land, sacrifice it.";
        expect(
            sortKeys(compiledOf(land("Gemstone Mine", `${enters}\n${mana}`)))
        ).toEqual(
            sortKeys({
                name: "Gemstone Mine",
                oracleText: `${enters}\n${mana}`,
                types: ["Land"],
                entersWith: { counters: [{ type: "mining", count: 3 }] },
                activatedAbilities: [
                    {
                        id: "gemstone-mine-mana",
                        oracleText: mana,
                        cost: {
                            tap: true,
                            removeCounter: { type: "mining", count: 1 },
                        },
                        useStack: false,
                        manaChoices: ANY_COLOR,
                        sacrificesSourceWhenNoCountersRemain: "mining",
                    },
                ],
            })
        );
    });
});

describe("gold — the hand-written twins round-trip through their own text", () => {
    it.each([ancientTomb(), chromaticSphere(), saprazzanSkerry()])(
        "$name",
        (card) => {
            const verdict = roundTripCard(card).verdict;
            expect(sortKeys(verdict)).toEqual({ ok: true, kind: "equal" });
        }
    );
});

describe("refusals — the neighbours of each rider form", () => {
    it.each([
        [
            "two rider sentences (only one is a printed shape)",
            land(
                "Double Rider",
                "{T}: Add {R}. This land deals 1 damage to you. Draw a card."
            ),
        ],
        [
            "a draw count other than one",
            land("Draw Two", "{T}: Add {R}. Draw two cards."),
        ],
        [
            "a sacrifice rider with no counter leg in the cost",
            land(
                "No Counter Cost",
                "{T}: Add {C}. If there are no depletion counters on this land, sacrifice it."
            ),
        ],
        [
            "a sacrifice rider naming a counter the cost never removes",
            land(
                "Wrong Counter",
                "{T}, Remove a depletion counter from this land: Add {U}. If there are no mining counters on this land, sacrifice it."
            ),
        ],
        [
            "a delayed return of the land (Undiscovered Paradise — no engine surface)",
            land(
                "Undiscovered Paradise",
                "{T}: Add one mana of any color. During your next untap step, as you untap your permanents, return this land to its owner's hand."
            ),
        ],
        [
            "an entry rider that places no counters",
            land(
                "Empty Entry",
                "This land enters with no mining counters on it."
            ),
        ],
        [
            "an entry rider counted per kick on a card with no kicker",
            land(
                "Kicked Entry",
                "This land enters with three mining counters on it for each time it was kicked."
            ),
        ],
        [
            "an entry rider on a permanent that is not this one",
            land(
                "Other Entry",
                "Each land enters with three mining counters on it."
            ),
        ],
    ])("%s stays unparsed", (_label, card) => {
        expect(compileCard(card).state).toBe("unparsed");
    });
});
