// Spell-cast trigger heads narrowed by card type or a colour list, and the
// "when" opener — "whenever you cast an enchantment spell", "when an opponent
// casts an instant spell", "whenever you cast a spell that's white, blue,
// black, or red" (issue #4543, CR 603.2 / 601.2i / 205.2a / 105.2).
//
//  1. GOLDENS — a real corpus card compiled whole and compared with `sortKeys`
//     equality for the two forms whose body already compiles (Argothian
//     Enchantress: type filter; Quirion Dryad: colour list). The other four
//     cards' bodies are still separate Grammar Gaps, so their HEAD is pinned
//     at the table (`OTHER_HEADS`) and, end to end, behind a body that
//     compiles.
//  2. REFUSALS — the neighbours the table must NOT read: a type it does not
//     spell, a rider after the noun, a colour list in another shape, a "when"
//     opener on a colour row.
//  3. TABLE — a type row narrows by `types` alone, never also by colour.
//
// The engine half (does the rebuilt ability FIRE on the right type?) is the
// existing `spell-cast` descriptor path, `matchesSpellFilter`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { OTHER_HEADS } from "../grammar/shared/triggerHead";
import { oracleCard } from "./oracle.fixture";

const refused = (oracleText: string) =>
    compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    ).state === "unparsed";

describe("spell-cast type heads — goldens (issue #4543)", () => {
    it("Argothian Enchantress: 'you cast an enchantment spell' — types [Enchantment]", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Argothian Enchantress",
                manaCost: "{1}{G}",
                typeLine: "Creature — Human Druid",
                oracleText:
                    "Shroud (This creature can't be the target of spells or abilities.)\nWhenever you cast an enchantment spell, draw a card.",
                power: "0",
                toughness: "1",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "argothian-enchantress-trigger",
                    oracleText:
                        "Whenever you cast an enchantment spell, draw a card.",
                    head: {
                        kind: "spell-cast",
                        scope: "you",
                        filter: { types: ["Enchantment"] },
                    },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ])
        );
    });

    it("Quirion Dryad: 'a spell that's white, blue, black, or red' — colours [W,U,B,R]", () => {
        const text =
            "Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on this creature.";
        const outcome = compileCard(
            oracleCard({
                name: "Quirion Dryad",
                manaCost: "{1}{G}",
                typeLine: "Creature — Dryad",
                oracleText: text,
                power: "1",
                toughness: "1",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "quirion-dryad-trigger",
                    oracleText: text,
                    head: {
                        kind: "spell-cast",
                        scope: "you",
                        filter: { colors: ["W", "U", "B", "R"] },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ])
        );
    });

    // Heads of the cards whose BODY is a separate gap: Skittering Skirge,
    // Hidden Gibbons, Presence of the Master, Standstill.
    const HEADS: readonly [string, unknown][] = [
        [
            "when you cast a creature spell",
            {
                kind: "spell-cast",
                scope: "you",
                filter: { types: ["Creature"] },
            },
        ],
        [
            "when an opponent casts an instant spell",
            {
                kind: "spell-cast",
                scope: "opponent",
                filter: { types: ["Instant"] },
            },
        ],
        [
            "whenever a player casts an enchantment spell",
            {
                kind: "spell-cast",
                scope: "any",
                filter: { types: ["Enchantment"] },
            },
        ],
        ["when a player casts a spell", { kind: "spell-cast", scope: "any" }],
    ];

    for (const [phrase, head] of HEADS)
        it(`compiles the head: ${phrase}`, () => {
            const outcome = compileCard(
                oracleCard({
                    name: "Control",
                    manaCost: "{2}",
                    typeLine: "Artifact",
                    oracleText: `${phrase[0]!.toUpperCase()}${phrase.slice(1)}, you gain 1 life.`,
                    power: undefined,
                    toughness: undefined,
                })
            );
            if (outcome.state === "unparsed")
                throw new Error(JSON.stringify(outcome.gaps));
            expect(
                outcome.definition.compiledTriggeredAbilities?.[0]?.head
            ).toEqual(head);
        });

    it("end to end: the 'when' + type head compiles behind a body that compiles", () => {
        const text = "When you cast a creature spell, you gain 1 life.";
        const outcome = compileCard(
            oracleCard({
                name: "Control",
                manaCost: "{2}",
                typeLine: "Artifact",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(
            outcome.definition.compiledTriggeredAbilities?.[0]?.head
        ).toEqual({
            kind: "spell-cast",
            scope: "you",
            filter: { types: ["Creature"] },
        });
    });
});

describe("spell-cast type heads — refusals stay fail-closed (issue #4543)", () => {
    const REFUSED = [
        // A type the table does not spell.
        "Whenever you cast an artifact spell, you gain 1 life.",
        // A rider after the noun changes the event.
        "Whenever you cast a creature spell with flying, you gain 1 life.",
        // A colour list in another shape.
        "Whenever you cast a spell that's white or blue, you gain 1 life.",
        "Whenever an opponent casts a spell that's white, blue, black, or red, you gain 1 life.",
        // "when" is spelled only for the rows the corpus prints.
        "When you cast a white spell, you gain 1 life.",
        "When an opponent casts a spell, you gain 1 life.",
    ];

    it("control: an accepted head over the same body compiles", () => {
        expect(refused("Whenever you cast a spell, you gain 1 life.")).toBe(
            false
        );
    });

    for (const line of REFUSED)
        it(`refuses: ${line}`, () => {
            expect(refused(line)).toBe(true);
        });
});

describe("spell-cast type heads — the table (issue #4543)", () => {
    it("a type row narrows by `types` alone, never by colour", () => {
        const rows = [...OTHER_HEADS].filter(([phrase]) =>
            / an? (creature|enchantment|instant) spell$/.test(phrase)
        );
        expect(rows).toHaveLength(18);
        for (const [, head] of rows) {
            if (head.kind !== "spell-cast") throw new Error("unreachable");
            expect(head.filter?.types).toHaveLength(1);
            expect(head.filter?.colors).toBeUndefined();
            expect(head.filter?.excludeColors).toBeUndefined();
        }
    });
});
