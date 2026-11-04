// "Exile cards from the top of your library until you exile a nonland card.
// You may cast that card without paying its mana cost." (CR 406.3, CR 608.2g,
// CR 118.9, issue #7354), and the "your second spell each turn" head it is
// printed behind (CR 601.2i).
//
//  1. GOLDEN — Wanda's Vision compiled whole.
//  2. HEAD — the hydrated trigger fires on the caster's second spell only.
//  3. REFUSALS — each half without the other, and the printed neighbours.

import { describe, expect, it } from "vitest";
import type { GameEvent, PermanentView } from "../../cards/types";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const WALK =
    "exile cards from the top of your library until you exile a nonland card.";
const OFFER = "You may cast that card without paying its mana cost.";
const HEAD = "Whenever you cast your second spell each turn, ";

const WANDA = `${HEAD}${WALK} ${OFFER}`;

function compiled(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Wanda's Vision",
            manaCost: "{3}{R}{R}",
            typeLine: "Enchantment",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("exile until + free offer (CR 406.3, CR 608.2g, CR 118.9)", () => {
    it("GOLDEN: Wanda's Vision lowers to the bound walk and the free offer", () => {
        const out = compiled(WANDA);
        if (out.state === "unparsed") throw new Error(JSON.stringify(out.gaps));
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Wanda's Vision",
                types: ["Enchantment"],
                manaCost: { X: 3, R: 2 },
                oracleText: WANDA,
                compiledTriggeredAbilities: [
                    {
                        id: "wanda-s-vision-trigger",
                        oracleText: WANDA,
                        head: {
                            kind: "spell-cast",
                            scope: "you",
                            nthSpellThisTurn: 2,
                        },
                        effects: [
                            {
                                op: "revealUntilMatch",
                                player: "controller",
                                filter: { excludeType: "Land" },
                                match: "exile",
                                rest: "exile",
                                bind: "$hit1",
                            },
                            {
                                op: "castDuringResolution",
                                player: "controller",
                                card: { ref: "$hit1" },
                                source: "exile",
                                free: true,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it.each([
        ["the walk alone", `${HEAD}${WALK}`],
        [
            "the walk behind another sentence",
            `${HEAD}draw a card. Exile cards from the top of your library until you exile a nonland card.`,
        ],
        [
            "the offer alone",
            `${HEAD}you may cast that card without paying its mana cost.`,
        ],
        [
            "another filter (Dazzling Sphinx's)",
            `${HEAD}exile cards from the top of your library until you exile an instant or sorcery card. ${OFFER}`,
        ],
        [
            "an offer with a window (Territorial Bruntar's)",
            `${HEAD}${WALK} You may cast that card this turn.`,
        ],
        ["an offer with a paid cost", `${HEAD}${WALK} You may cast that card.`],
        [
            "another player's library (Gríma's)",
            `${HEAD}that player exiles cards from the top of their library until they exile a nonland card. ${OFFER}`,
        ],
        [
            "a third sentence (Chaos Wand's tail)",
            `${HEAD}${WALK} ${OFFER} Then put the exiled cards that weren't cast this way on the bottom of your library in a random order.`,
        ],
    ])("REFUSES %s", (_label, oracleText) => {
        expect(compiled(oracleText).state).toBe("unparsed");
    });
});

describe("your second spell each turn head (CR 601.2i)", () => {
    function fires(casterSpellCountThisTurn: number, casterId = "p1"): boolean {
        const out = compiled(WANDA);
        if (out.state === "unparsed") throw new Error(JSON.stringify(out.gaps));
        const [descriptor] = out.definition.compiledTriggeredAbilities!;
        const trigger = resolveCompiledTrigger(descriptor!);
        return trigger.matches(
            {
                type: "SPELL_CAST",
                casterId,
                casterSpellCountThisTurn,
            } as unknown as GameEvent,
            { controllerId: "p1", id: "src" } as unknown as PermanentView
        );
    }

    it("fires on the caster's second spell only", () => {
        expect([0, 1, 2].map((prior) => fires(prior))).toEqual([
            false,
            true,
            false,
        ]);
    });

    it("does not fire on an opponent's second spell", () => {
        expect(fires(1, "p2")).toBe(false);
    });
});
