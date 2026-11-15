// "You may put a <descriptor> card from your hand onto the battlefield" at an
// activated ability (CR 608.2d, CR 400.7; issue #4066).
//
// Two layers:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition: the "may" folded into a 0..1 hand pick, then
//     the `moveZone` of the pick. One per argument class the site reads: the
//     colour COUNT "multicolored" (CR 105.2b), a land card behind an
//     activation restriction, a basic land card entering tapped beside a mana
//     ability, a "<Subtype> permanent card", and the drop as the second
//     sentence of the ability.
//  2. REFUSALS — the neighbours the site must NOT read: any other "You may"
//     sentence, a pick of more than one card, a pick out of the graveyard,
//     the bare instruction, and "multicolored" in a library search.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function artifact(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Artifact",
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The two Ops every drop lowers to: the 0..1 pick, then its move. */
function drop(filter: Record<string, unknown>, clause: string, tapped = false) {
    return [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            filter,
            count: { min: 0, max: 1 },
            prompt: `You may ${clause}.`,
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "hand",
            to: "battlefield",
            ...(tapped ? { tapped: true } : {}),
        },
    ];
}

describe("optional hand drop at an activated ability — golden fixtures (CR 608.2d, CR 400.7)", () => {
    it("'a multicolored creature card' is a colour COUNT, never a colour (CR 105.2b): Dragon Arch", () => {
        const text =
            "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.";
        expect(
            sortKeys(compiled(artifact("Dragon Arch", "{5}", text)))
        ).toEqual(
            sortKeys({
                name: "Dragon Arch",
                types: ["Artifact"],
                manaCost: { X: 5 },
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "dragon-arch-ability",
                        oracleText: text,
                        cost: { mana: { X: 2 }, tap: true },
                        useStack: true,
                        effects: drop(
                            { type: "Creature", colorCountAtLeast: 2 },
                            "put a multicolored creature card from your hand onto the battlefield"
                        ),
                    },
                ],
            })
        );
    });

    it("a land card behind 'Activate only as a sorcery' (CR 602.5d): Skyshroud Ranger", () => {
        const text =
            "{T}: You may put a land card from your hand onto the battlefield. Activate only as a sorcery.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Skyshroud Ranger",
                        manaCost: "{G}",
                        typeLine: "Creature — Elf Ranger",
                        oracleText: text,
                        power: "1",
                        toughness: "1",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Skyshroud Ranger",
                types: ["Creature"],
                subtypes: ["Elf", "Ranger"],
                manaCost: { G: 1 },
                power: 1,
                toughness: 1,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "skyshroud-ranger-ability",
                        oracleText: text,
                        cost: { tap: true },
                        useStack: true,
                        effects: drop(
                            { type: "Land" },
                            "put a land card from your hand onto the battlefield"
                        ),
                        sorcerySpeedOnly: true,
                    },
                ],
            })
        );
    });

    it("a basic land card entering tapped (CR 110.5b), beside a mana ability: Terrain Generator", () => {
        const mana = "{T}: Add {C}.";
        const put =
            "{2}, {T}: You may put a basic land card from your hand onto the battlefield tapped.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Terrain Generator",
                        manaCost: "",
                        typeLine: "Land",
                        oracleText: `${mana}\n${put}`,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Terrain Generator",
                types: ["Land"],
                oracleText: `${mana}\n${put}`,
                activatedAbilities: [
                    {
                        id: "terrain-generator-mana",
                        oracleText: mana,
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { C: 1 },
                    },
                    {
                        id: "terrain-generator-ability-2",
                        oracleText: put,
                        cost: { mana: { X: 2 }, tap: true },
                        useStack: true,
                        effects: drop(
                            { type: "Land", supertype: "Basic" },
                            "put a basic land card from your hand onto the battlefield tapped",
                            true
                        ),
                    },
                ],
            })
        );
    });

    it("'a <Subtype> permanent card' keeps the catalogue's excludeType shape (CR 110.4): Didgeridoo", () => {
        const text =
            "{3}: You may put a Minotaur permanent card from your hand onto the battlefield.";
        expect(sortKeys(compiled(artifact("Didgeridoo", "{1}", text)))).toEqual(
            sortKeys({
                name: "Didgeridoo",
                types: ["Artifact"],
                manaCost: { X: 1 },
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "didgeridoo-ability",
                        oracleText: text,
                        cost: { mana: { X: 3 } },
                        useStack: true,
                        effects: drop(
                            {
                                subtype: "Minotaur",
                                excludeType: ["Instant", "Sorcery"],
                            },
                            "put a Minotaur permanent card from your hand onto the battlefield"
                        ),
                    },
                ],
            })
        );
    });

    it("the drop as the ability's second sentence, after a draw (CR 608.2c): Gretchen Titchwillow", () => {
        const text =
            "{2}{G}{U}: Draw a card. You may put a land card from your hand onto the battlefield.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Gretchen Titchwillow",
                        manaCost: "{G}{U}",
                        typeLine: "Legendary Creature — Halfling Druid",
                        oracleText: text,
                        power: "0",
                        toughness: "4",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Gretchen Titchwillow",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Halfling", "Druid"],
                manaCost: { U: 1, G: 1 },
                power: 0,
                toughness: 4,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "gretchen-titchwillow-ability",
                        oracleText: text,
                        cost: { mana: { X: 2, U: 1, G: 1 } },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                            ...drop(
                                { type: "Land" },
                                "put a land card from your hand onto the battlefield"
                            ),
                        ],
                    },
                ],
            })
        );
    });
});

describe("optional hand drop at an activated ability — refused neighbours (fail-closed, ADR 0105 § 2)", () => {
    it.each([
        // The marker is admitted for the drop alone: any other optional
        // effect at the site is a reading with no fixture, even one the
        // frames would read behind it.
        [
            "another 'You may' sentence",
            "{T}: You may return target creature to its owner's hand.",
        ],
        // More than one card is not the 0..1 pick the "may" folds into.
        [
            "a pick of more than one card",
            "{2}, {T}: You may put up to two creature cards from your hand onto the battlefield.",
        ],
        // The form names the hand; a graveyard drop is a different move.
        [
            "a pick out of the graveyard",
            "{2}, {T}: You may put a creature card from your graveyard onto the battlefield.",
        ],
        // CR 608.2d — every printed hand → battlefield drop says "may".
        [
            "the bare instruction",
            "{2}, {T}: Put a creature card from your hand onto the battlefield.",
        ],
        // The colour count is peeled at the hand / graveyard pick only: the
        // library-search frame keeps the argument classes its fixtures show.
        [
            "'multicolored' in a library search",
            "{2}, {T}: Search your library for a multicolored card, reveal it, put it into your hand, then shuffle.",
        ],
    ])("%s stays unparsed", (_form, text) => {
        expect(compileCard(artifact("Probe", "{5}", text)).state).toBe(
            "unparsed"
        );
    });
});
