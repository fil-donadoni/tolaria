// The `loseAbility` Verb Frame (CR 613.1f + CR 611.2a, issue #2125):
// "<object> loses <keyword>[ until <duration>]" and the group's "<objects> lose
// <keyword>[ and <keyword>] until <duration>", lowered to one `loseAbility` Op
// per keyword.
//
// Three layers:
//
//  1. GOLDENS — one per accepted form, each a real corpus row: an announced
//     target, timed (Radjan Spirit); the anaphor of the sentence before
//     (Vertigo); the source, INDEFINITE (Mist Dragon's "{0}: This creature
//     loses flying."); a group over a sweep (Whiteout's first line); the
//     opponents' group losing a keyword pair (Shadowspear, Bonds of
//     Mortality) or one keyword (Exterminatus), CR 109.5 + CR 102.2.
//  2. REFUSALS — neighbours that must NOT become a keyword loss: a life loss,
//     a one-object keyword pair, a longer keyword list, "loses all
//     abilities", a timeless group loss (a static ability, not a one-shot),
//     and the opponents' group under any verb but this frame's.
//  3. The Op appears in the lowering exactly as the hand-written card
//     encodes it (Vertigo's DSL definition).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const RADJAN_SPIRIT: OracleCard = {
    oracleId: "c9ffce6c-a113-4c9d-9148-5ace68f68793",
    name: "Radjan Spirit",
    manaCost: "{3}{G}",
    typeLine: "Creature — Spirit",
    oracleText: "{T}: Target creature loses flying until end of turn.",
    power: "3",
    toughness: "2",
    layout: "normal",
};

const VERTIGO: OracleCard = {
    oracleId: "1dabfade-79e5-44e2-afa6-b20498c6bb8b",
    name: "Vertigo",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText:
        "Vertigo deals 2 damage to target creature with flying. That creature loses flying until end of turn.",
    layout: "normal",
};

/** The one line of Mist Dragon that is this frame's: the source, no duration
 *  (the card's other lines are other gaps). */
const MIST_DRAGON_LINE = oracleCard({
    name: "Mist Dragon",
    manaCost: "{4}{U}{U}",
    typeLine: "Creature — Dragon",
    oracleText:
        "Flying\n{0}: This creature loses flying. (This effect lasts indefinitely.)",
    power: "4",
    toughness: "4",
});

/** Whiteout's first line on its own (its graveyard line is another gap). */
const WHITEOUT_LINE = oracleCard({
    name: "Whiteout",
    manaCost: "{1}{G}",
    typeLine: "Instant",
    oracleText: "All creatures lose flying until end of turn.",
    power: undefined,
    toughness: undefined,
});

const SHADOWSPEAR: OracleCard = {
    oracleId: "8b27326f-e7b8-4a4d-b589-df459246d19a",
    name: "Shadowspear",
    manaCost: "{1}",
    typeLine: "Legendary Artifact — Equipment",
    oracleText:
        "Equipped creature gets +1/+1 and has trample and lifelink.\n{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.\nEquip {2}",
    layout: "normal",
};

const BONDS_OF_MORTALITY: OracleCard = {
    oracleId: "d93ba2f2-bf9b-444b-adbb-3835662734e7",
    name: "Bonds of Mortality",
    manaCost: "{1}{G}",
    typeLine: "Enchantment",
    oracleText:
        "When this enchantment enters, draw a card.\n{G}: Creatures your opponents control lose hexproof and indestructible until end of turn.",
    layout: "normal",
};

const EXTERMINATUS: OracleCard = {
    oracleId: "8d90ffb5-63da-48d5-a5a2-7b61062556f6",
    name: "Exterminatus",
    manaCost: "{5}{W}{B}",
    typeLine: "Sorcery",
    oracleText:
        "Nonland permanents your opponents control lose indestructible until end of turn.\nDestroy all nonland permanents.",
    layout: "normal",
};

/** The compiled script of `card`. The $source / $each forms are withheld by
 *  the smoke planner (`smoke-scenario`, a card-dependent subject) unless a
 *  golden fixture clears their form — the parse is what is under test here, so
 *  that quarantine, and only that one, is accepted. */
function readyEffects(card: OracleCard): unknown {
    const result = compileCard(card);
    if (result.state === "quarantine")
        expect(result.reasons.map((r) => r.kind)).toEqual(["smoke-scenario"]);
    else expect(result.state).toBe("ready");
    if (result.state === "unparsed") return undefined;
    const def = result.definition as {
        effects?: unknown;
        activatedAbilities?: { effects?: unknown }[];
    };
    return def.effects ?? def.activatedAbilities?.[0]?.effects;
}

/** Every Op name the compile of `text` emits, empty when it does not parse. */
function opsOf(text: string, typeLine = "Instant"): readonly string[] {
    const result = compileCard(
        oracleCard({
            oracleText: text,
            typeLine,
            power: undefined,
            toughness: undefined,
        })
    );
    return result.state === "unparsed" ? [] : (result.opsUsed ?? []);
}

describe("loseAbility frame — goldens (CR 613.1f)", () => {
    it("an announced target loses a keyword until end of turn (Radjan Spirit)", () => {
        expect(readyEffects(RADJAN_SPIRIT)).toEqual([
            {
                op: "loseAbility",
                target: { target: 0 },
                ability: "flying",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("the anaphor names the earlier sentence's target (Vertigo, CR 608.2c)", () => {
        expect(readyEffects(VERTIGO)).toEqual([
            { op: "dealDamage", amount: 2, to: { target: 0 } },
            {
                op: "loseAbility",
                target: { target: 0 },
                ability: "flying",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("no printed duration is INDEFINITE — the field is omitted (Mist Dragon, CR 611.2a)", () => {
        expect(readyEffects(MIST_DRAGON_LINE)).toEqual([
            {
                op: "loseAbility",
                target: { ref: "$source" },
                ability: "flying",
            },
        ]);
    });

    it("a group loses a keyword over a sweep (Whiteout)", () => {
        expect(readyEffects(WHITEOUT_LINE)).toEqual([
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "loseAbility",
                        target: { ref: "$each" },
                        ability: "flying",
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
    });
});

describe("loseAbility frame — the opponents' group (CR 109.5 + CR 102.2)", () => {
    it.each([
        [
            "a keyword pair over every permanent (Shadowspear)",
            SHADOWSPEAR,
            {
                name: "Shadowspear",
                types: ["Artifact"],
                supertypes: ["Legendary"],
                subtypes: ["Equipment"],
                manaCost: { X: 1 },
                oracleText:
                    "Equipped creature gets +1/+1 and has trample and lifelink.\n{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.\nEquip {2}",
                activatedAbilities: [
                    {
                        id: "shadowspear-ability",
                        oracleText:
                            "{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.",
                        cost: { mana: { X: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    controller: "opponent",
                                },
                                effects: [
                                    {
                                        op: "loseAbility",
                                        target: { ref: "$each" },
                                        ability: "hexproof",
                                        duration: { phase: "end-of-turn" },
                                    },
                                    {
                                        op: "loseAbility",
                                        target: { ref: "$each" },
                                        ability: "indestructible",
                                        duration: { phase: "end-of-turn" },
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        id: "shadowspear-equip",
                        oracleText: "Equip {2}",
                        cost: { mana: { generic: 2 } },
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
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        appliesTo: "host",
                        power: 1,
                        toughness: 1,
                    },
                    {
                        kind: "keyword-grant",
                        appliesTo: "host",
                        keyword: "trample",
                    },
                    {
                        kind: "keyword-grant",
                        appliesTo: "host",
                        keyword: "lifelink",
                    },
                ],
            },
        ],
        [
            "a keyword pair over a creature group (Bonds of Mortality)",
            BONDS_OF_MORTALITY,
            {
                name: "Bonds of Mortality",
                types: ["Enchantment"],
                manaCost: { X: 1, G: 1 },
                oracleText:
                    "When this enchantment enters, draw a card.\n{G}: Creatures your opponents control lose hexproof and indestructible until end of turn.",
                activatedAbilities: [
                    {
                        id: "bonds-of-mortality-ability",
                        oracleText:
                            "{G}: Creatures your opponents control lose hexproof and indestructible until end of turn.",
                        cost: { mana: { G: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "forEach",
                                select: {
                                    set: "permanents",
                                    zone: "battlefield",
                                    filter: { type: "Creature" },
                                    controller: "opponent",
                                },
                                effects: [
                                    {
                                        op: "loseAbility",
                                        target: { ref: "$each" },
                                        ability: "hexproof",
                                        duration: { phase: "end-of-turn" },
                                    },
                                    {
                                        op: "loseAbility",
                                        target: { ref: "$each" },
                                        ability: "indestructible",
                                        duration: { phase: "end-of-turn" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "bonds-of-mortality-trigger",
                        oracleText:
                            "When this enchantment enters, draw a card.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            },
        ],
        [
            "one keyword over a narrowed group (Exterminatus)",
            EXTERMINATUS,
            {
                name: "Exterminatus",
                types: ["Sorcery"],
                manaCost: { X: 5, W: 1, B: 1 },
                oracleText:
                    "Nonland permanents your opponents control lose indestructible until end of turn.\nDestroy all nonland permanents.",
                effects: [
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            filter: { excludeType: "Land" },
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "loseAbility",
                                target: { ref: "$each" },
                                ability: "indestructible",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            filter: { excludeType: "Land" },
                        },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            },
        ],
    ] as const)("%s", (_label, card, expected) => {
        const result = compileCard(card);
        expect(result.state).toBe("ready");
        if (result.state !== "ready") return;
        expect(sortKeys(result.definition)).toEqual(sortKeys(expected));
    });
});

describe("loseAbility frame — refusals", () => {
    it.each([
        // A life loss stays the life sentence's.
        ["Target player loses 2 life."],
        // A keyword pair on ONE object: a form no card prints.
        ["Target creature loses flying and first strike until end of turn."],
        // A longer keyword list, one member no registry keyword (Shay Cormac).
        [
            "Permanents your opponents control lose hexproof, indestructible, protection, shroud, and ward until end of turn.",
        ],
        // A timeless keyword pair on a group is a static ability.
        ["Creatures your opponents control lose hexproof and indestructible."],
        // The same keyword twice.
        ["All creatures lose flying and flying until end of turn."],
        // "All abilities" is `loseAllAbilities`' shape, never a keyword.
        ["Target creature loses all abilities until end of turn."],
        // A timeless group loss is a static ability, not a one-shot.
        ["All creatures lose flying."],
        // A word that is no registry keyword.
        ["Target creature loses heart until end of turn."],
    ])("%s → no loseAbility", (text) => {
        expect(opsOf(text)).not.toContain("loseAbility");
    });

    // The opponents' group is read for this frame only: the group pump
    // printing the same subject (Make Obsolete) stays unparsed.
    it("the opponents' group under another verb stays unparsed", () => {
        expect(
            compileCard(
                oracleCard({
                    oracleText:
                        "Creatures your opponents control get -1/-1 until end of turn.",
                    typeLine: "Instant",
                    power: undefined,
                    toughness: undefined,
                })
            ).state
        ).toBe("unparsed");
    });
});
