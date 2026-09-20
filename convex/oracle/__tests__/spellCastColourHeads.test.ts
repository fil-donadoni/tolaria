// Spell-cast trigger heads with a colour filter — "whenever a player casts a
// black spell", "whenever you cast a nonred spell" (issue #4135, CR 603.2 /
// 601.2i / 105.2).
//
//  1. GOLDENS — every accepted form is a real corpus card, compiled whole and
//     compared with `sortKeys` equality: colour filter for any caster (Bog
//     Gnarr, Glade Gnarr — two colours of one form), negated colour for
//     "you" (Dwarven Patrol), colour filter for an opponent (Warmth).
//  2. REFUSALS — the neighbours the table must NOT read: a filter it does not
//     spell (multicolored, colorless), a rider after the noun ("from your
//     hand", "during your turn"), a disjunction with another event, and a
//     colour word outside the five.
//  3. VOCABULARY — every (caster, colour, polarity) row is one of the five
//     colours of CR 105.1, and "nonred" EXCLUDES red rather than listing the
//     other four (CR 105.2c: a colourless spell is a nonred spell).
//
// The engine half (does the rebuilt ability FIRE on the right colour?) is
// `gre/__tests__/compiledSpellCastColourTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { OTHER_HEADS } from "../grammar/shared/triggerHead";
import { oracleCard } from "./fixtures";

function abilitiesOf(
    card: ReturnType<typeof oracleCard>
): readonly CompiledTriggeredAbility[] {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.compiledTriggeredAbilities ?? [];
}

function creature(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{4}{G}",
        typeLine: "Creature — Beast",
        oracleText,
        power: "5",
        toughness: "5",
    });
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

const PUMP_SELF = [
    {
        op: "pump",
        target: { ref: "$source" },
        power: 2,
        toughness: 2,
        duration: { phase: "end-of-turn" },
    },
];

describe("spell-cast colour heads — goldens (issue #4135)", () => {
    it("Bog Gnarr: 'a player casts a black spell' — any caster, colours [B]", () => {
        const text =
            "Whenever a player casts a black spell, this creature gets +2/+2 until end of turn.";
        expect(sortKeys(abilitiesOf(creature("Bog Gnarr", text)))).toEqual(
            sortKeys([
                {
                    id: "bog-gnarr-trigger",
                    oracleText: text,
                    head: {
                        kind: "spell-cast",
                        scope: "any",
                        filter: { colors: ["B"] },
                    },
                    effects: PUMP_SELF,
                },
            ])
        );
    });

    it("Glade Gnarr: the same form with another colour word reads that colour", () => {
        const text =
            "Whenever a player casts a blue spell, this creature gets +2/+2 until end of turn.";
        expect(sortKeys(abilitiesOf(creature("Glade Gnarr", text)))).toEqual(
            sortKeys([
                {
                    id: "glade-gnarr-trigger",
                    oracleText: text,
                    head: {
                        kind: "spell-cast",
                        scope: "any",
                        filter: { colors: ["U"] },
                    },
                    effects: PUMP_SELF,
                },
            ])
        );
    });

    it("Dwarven Patrol: 'you cast a nonred spell' — the controller, red EXCLUDED", () => {
        const text = "Whenever you cast a nonred spell, untap this creature.";
        expect(
            sortKeys(
                abilitiesOf(
                    oracleCard({
                        name: "Dwarven Patrol",
                        manaCost: "{2}{R}",
                        typeLine: "Creature — Dwarf",
                        oracleText: text,
                        power: "3",
                        toughness: "3",
                    })
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "dwarven-patrol-trigger",
                    oracleText: text,
                    head: {
                        kind: "spell-cast",
                        scope: "you",
                        filter: { excludeColors: ["R"] },
                    },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ])
        );
    });

    it("Warmth: 'an opponent casts a red spell' — the opponent scope, colours [R]", () => {
        const text = "Whenever an opponent casts a red spell, you gain 2 life.";
        expect(
            sortKeys(
                abilitiesOf(
                    oracleCard({
                        name: "Warmth",
                        manaCost: "{W}",
                        typeLine: "Enchantment",
                        oracleText: text,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "warmth-trigger",
                    oracleText: text,
                    head: {
                        kind: "spell-cast",
                        scope: "opponent",
                        filter: { colors: ["R"] },
                    },
                    effects: [
                        { op: "gainLife", player: "controller", amount: 2 },
                    ],
                },
            ])
        );
    });
});

describe("spell-cast colour heads — refusals stay fail-closed (issue #4135)", () => {
    const REFUSED_HEADS: readonly [string, string][] = [
        // A filter the table does not spell (multicolored is not a colour word
        // of CR 105.1; colorless is the ABSENCE of colour, CR 105.2c).
        [
            "Rewards of Diversity",
            "Whenever an opponent casts a multicolored spell, you gain 1 life.",
        ],
        [
            "Thought Harvester",
            "Whenever you cast a colorless spell, you gain 1 life.",
        ],
        // A rider after the noun changes the event the ability watches.
        [
            "Baron Helmut Zemo",
            "Whenever you cast a black spell from your hand, you gain 1 life.",
        ],
        [
            "Eyes of the Wisent",
            "Whenever an opponent casts a blue spell during your turn, you gain 1 life.",
        ],
        // A second event joined by "or" is a different head.
        [
            "Staff of the Wild Magus",
            "Whenever you cast a green spell or a Forest you control enters, you gain 1 life.",
        ],
        // Not a colour word.
        [
            "Invented",
            "Whenever a player casts a purple spell, you gain 1 life.",
        ],
        [
            "Invented",
            "Whenever a player casts a nonpurple spell, you gain 1 life.",
        ],
    ];

    it("control: the same body behind an accepted head compiles, so the refusals below are the HEAD's", () => {
        expect(
            refused(
                oracleCard({
                    name: "Control",
                    manaCost: "{2}",
                    typeLine: "Artifact",
                    oracleText:
                        "Whenever a player casts a black spell, you gain 1 life.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(false);
    });

    for (const [name, line] of REFUSED_HEADS) {
        it(`refuses: ${line}`, () => {
            expect(
                refused(
                    oracleCard({
                        name,
                        manaCost: "{2}",
                        typeLine: "Artifact",
                        oracleText: line,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            ).toBe(true);
        });
    }
});

describe("spell-cast colour heads — the table (issue #4135)", () => {
    const rows = [...OTHER_HEADS].filter(
        ([, head]) => head.kind === "spell-cast" && head.filter !== undefined
    );

    it("spells 3 casters x 5 colours x 2 polarities, and no other spell-cast filter", () => {
        expect(rows).toHaveLength(30);
    });

    it("'nonred' EXCLUDES red — never a list of the other four (CR 105.2c)", () => {
        for (const [phrase, head] of rows) {
            if (head.kind !== "spell-cast") throw new Error("unreachable");
            const negative = /a non(white|blue|black|red|green) spell$/.test(
                phrase
            );
            if (negative) {
                expect(head.filter?.colors).toBeUndefined();
                expect(head.filter?.excludeColors).toHaveLength(1);
            } else {
                expect(head.filter?.excludeColors).toBeUndefined();
                expect(head.filter?.colors).toHaveLength(1);
            }
        }
    });
});
