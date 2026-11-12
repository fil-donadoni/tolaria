// "If this card is in your opening hand, you may begin the game with it on the
// battlefield." — an opening-hand action (CR 103.6a), declared on the card as
// `openingHandAction` and taken in the CR 103.6 window before the first turn.
//
//  1. GOLDEN forms — real corpus cards compiled whole: the Leyline line beside
//     an enchantment's static (Leyline of Anticipation) and beside an
//     Equipment's statics and equip ability (Leyline Axe).
//  2. REFUSAL — the neighbour with its own gate and rider (Gemstone Caverns:
//     "and you're not the starting player … with a luck counter on it. If you
//     do, exile a card from your hand"), which the declaration cannot express.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const LEYLINE_LINE =
    "If this card is in your opening hand, you may begin the game with it on the battlefield.";

function noncreature(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
        power: undefined,
        toughness: undefined,
    });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("begin the game on the battlefield (CR 103.6a)", () => {
    it("declares the action beside an enchantment's static — Leyline of Anticipation, whole", () => {
        const oracleText = `${LEYLINE_LINE}\nYou may cast spells as though they had flash.`;
        expect(
            sortKeys(
                compiled(
                    noncreature(
                        "Leyline of Anticipation",
                        "{2}{U}{U}",
                        "Enchantment",
                        oracleText
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Leyline of Anticipation",
                types: ["Enchantment"],
                manaCost: { X: 2, U: 2 },
                oracleText,
                openingHandAction: "begin-on-battlefield",
                compiledStaticEffects: [
                    {
                        kind: "cast-permission",
                        id: "controller-spell-a7736ca4",
                        grantee: "controller",
                        filter: {},
                        asThoughFlash: true,
                        oracleText:
                            "You may cast spells as though they had flash.",
                    },
                ],
            })
        );
    });

    it("declares the action on an Equipment — Leyline Axe, whole", () => {
        const oracleText = `${LEYLINE_LINE}\nEquipped creature gets +1/+1 and has double strike and trample.\nEquip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)`;
        expect(
            sortKeys(
                compiled(
                    noncreature(
                        "Leyline Axe",
                        "{4}",
                        "Artifact — Equipment",
                        oracleText
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Leyline Axe",
                types: ["Artifact"],
                subtypes: ["Equipment"],
                manaCost: { X: 4 },
                oracleText,
                openingHandAction: "begin-on-battlefield",
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
                        keyword: "double strike",
                    },
                    {
                        kind: "keyword-grant",
                        appliesTo: "host",
                        keyword: "trample",
                    },
                ],
                activatedAbilities: [
                    {
                        id: "leyline-axe-equip",
                        oracleText: "Equip {3}",
                        cost: { mana: { generic: 3 } },
                        effects: [{ op: "attach", target: { target: 0 } }],
                        sorcerySpeedOnly: true,
                        targetRequirement: {
                            type: "Creature",
                            controller: "you",
                            count: 1,
                        },
                        useStack: true,
                    },
                ],
            })
        );
    });

    it("leaves a card without the line undeclared", () => {
        expect(
            compiled(
                noncreature(
                    "Test Enchantment",
                    "{2}{U}{U}",
                    "Enchantment",
                    "You may cast spells as though they had flash."
                )
            ).openingHandAction
        ).toBeUndefined();
    });

    it("refuses a gated begin-on-battlefield with a counter rider — Gemstone Caverns", () => {
        const line =
            "If this card is in your opening hand and you're not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.";
        const outcome = compileCard(
            noncreature("Gemstone Caverns", "", "Legendary Land", line)
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((gap) => gap.attribution?.path)).toEqual([
            ["static clause"],
        ]);
    });
});
