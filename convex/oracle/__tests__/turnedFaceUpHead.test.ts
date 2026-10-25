// The "turned face up" trigger head (issue #5227): "when this creature is
// turned face up" (CR 708.8 / 702.37e), over the engine's
// `PERMANENT_TURNED_FACE_UP` event.
//
//  1. GOLDENS — real corpus cards compiled whole and compared with `sortKeys`
//     equality: a targeted body (Nantuko Vigilante) and a body whose "it" is
//     the source (Skirk Marauder).
//  2. REFUSALS — the neighbours the head must NOT read: a turn-up of ANOTHER
//     permanent (Trail of Mystery — the event's permanent is not the source),
//     the CR 614.1e "as this creature is turned face up" replacement, and the
//     inverse "is turned face down".
//
// The engine half (does the rebuilt ability FIRE on the turn-up?) is
// `convex/gre/__tests__/turnedFaceUpTrigger.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

/** Nantuko Vigilante's corpus row, verbatim (`data/oracle-corpus.json.gz`). */
const NANTUKO_VIGILANTE: OracleCard = {
    oracleId: "28ea78dc-7ad6-4006-aaf8-4b25057ec019",
    name: "Nantuko Vigilante",
    manaCost: "{3}{G}",
    typeLine: "Creature — Insect Druid Mutant",
    oracleText:
        "Morph {1}{G} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\nWhen this creature is turned face up, destroy target artifact or enchantment.",
    power: "3",
    toughness: "2",
    layout: "normal",
};

/** Skirk Marauder's corpus row, verbatim. */
const SKIRK_MARAUDER: OracleCard = {
    oracleId: "8ba0e831-054a-4e01-92ed-2845bd2fa12f",
    name: "Skirk Marauder",
    manaCost: "{1}{R}",
    typeLine: "Creature — Goblin",
    oracleText:
        "Morph {2}{R} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\nWhen this creature is turned face up, it deals 2 damage to any target.",
    power: "2",
    toughness: "1",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const refused = (card: OracleCard) => compileCard(card).state === "unparsed";

const morphProbe = (line: string) =>
    oracleCard({
        name: "Probe Morph",
        manaCost: "{2}{G}",
        typeLine: "Creature — Elf",
        oracleText: `Morph {1}{G}\n${line}`,
    });

describe("'turned face up' trigger head — goldens (issue #5227)", () => {
    it("Nantuko Vigilante: the source's own turn-up, with a targeted body", () => {
        expect(sortKeys(compiled(NANTUKO_VIGILANTE))).toEqual(
            sortKeys({
                name: "Nantuko Vigilante",
                types: ["Creature"],
                subtypes: ["Insect", "Druid", "Mutant"],
                manaCost: { X: 3, G: 1 },
                power: 3,
                toughness: 2,
                oracleText: NANTUKO_VIGILANTE.oracleText,
                morph: { X: 1, G: 1 },
                compiledTriggeredAbilities: [
                    {
                        id: "nantuko-vigilante-trigger",
                        oracleText:
                            "When this creature is turned face up, destroy target artifact or enchantment.",
                        head: { kind: "turned-face-up" },
                        targetRequirement: {
                            type: ["Artifact", "Enchantment"],
                            count: 1,
                        },
                        effects: [{ op: "destroy", target: { target: 0 } }],
                    },
                ],
            })
        );
    });

    it("Skirk Marauder: 'it' behind the head is the source (CR 708.8)", () => {
        expect(sortKeys(compiled(SKIRK_MARAUDER))).toEqual(
            sortKeys({
                name: "Skirk Marauder",
                types: ["Creature"],
                subtypes: ["Goblin"],
                manaCost: { X: 1, R: 1 },
                power: 2,
                toughness: 1,
                oracleText: SKIRK_MARAUDER.oracleText,
                morph: { X: 2, R: 1 },
                compiledTriggeredAbilities: [
                    {
                        id: "skirk-marauder-trigger",
                        oracleText:
                            "When this creature is turned face up, it deals 2 damage to any target.",
                        head: { kind: "turned-face-up" },
                        targetRequirement: { type: "any", count: 1 },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 2,
                                to: { target: 0 },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("'turned face up' trigger head — refusals (issue #5227)", () => {
    it("refuses a turn-up of another permanent (Trail of Mystery): the head is self only", () => {
        expect(
            refused(
                oracleCard({
                    oracleId: "0e09aaba-5c32-4a45-8a07-b69e873510ef",
                    name: "Trail of Mystery",
                    manaCost: "{1}{G}",
                    typeLine: "Enchantment",
                    oracleText:
                        "Whenever a permanent you control is turned face up, if it's a creature, it gets +2/+2 until end of turn.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it("refuses 'as this creature is turned face up': a replacement effect (CR 614.1e), not a trigger", () => {
        expect(
            refused(
                morphProbe(
                    "As this creature is turned face up, put a +1/+1 counter on it."
                )
            )
        ).toBe(true);
    });

    it("refuses 'is turned face down': no event, and not this head", () => {
        expect(
            refused(
                morphProbe(
                    "When this creature is turned face down, draw a card."
                )
            )
        ).toBe(true);
    });

    it("refuses 'whenever' over the head: the corpus prints 'when'", () => {
        expect(
            refused(
                morphProbe(
                    "Whenever this creature is turned face up, draw a card."
                )
            )
        ).toBe(true);
    });
});
