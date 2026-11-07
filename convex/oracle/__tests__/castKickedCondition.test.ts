// "When you cast this spell, if it was kicked" (CR 702.33d + CR 603.4): the
// kicked gate behind a cast-self head, unnamed and per-kicker (CR 702.33f).
//
// Two layers: GOLDENS (a real corpus card compiled whole equals its full
// Compiled Definition) and REFUSALS (the neighbouring forms stay `unparsed`,
// so fail-closed is pinned, not assumed — ADR 0105 § 2). The engine half, real
// casts through the rebuilt abilities, is
// `gre/__tests__/compiledCastKickedTrigger.test.ts`.

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CompiledTriggeredAbility,
    PermanentView,
} from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const GOLDENS: readonly {
    readonly card: OracleCard;
    readonly expected: CompiledDefinition;
}[] = [
    // the unnamed form: the spell's own aggregate kicked state
    {
        card: {
            name: "Sowing Mycospawn",
            manaCost: "{3}{G}",
            typeLine: "Creature — Eldrazi Fungus",
            oracleText:
                "Devoid (This card has no color.)\nKicker {1}{C} (You may pay an additional {1}{C} as you cast this spell.)\nWhen you cast this spell, search your library for a land card, put it onto the battlefield, then shuffle.\nWhen you cast this spell, if it was kicked, exile target land.",
            power: "3",
            toughness: "3",
            oracleId: "63a19c7c-49d7-4b75-aac8-d0ff36c45fb8",
            layout: "normal",
        },
        expected: {
            name: "Sowing Mycospawn",
            types: ["Creature"],
            subtypes: ["Eldrazi", "Fungus"],
            manaCost: { X: 3, G: 1 },
            power: 3,
            toughness: 3,
            oracleText:
                "Devoid (This card has no color.)\nKicker {1}{C} (You may pay an additional {1}{C} as you cast this spell.)\nWhen you cast this spell, search your library for a land card, put it onto the battlefield, then shuffle.\nWhen you cast this spell, if it was kicked, exile target land.",
            staticAbilities: ["devoid"],
            compiledTriggeredAbilities: [
                {
                    id: "sowing-mycospawn-trigger",
                    oracleText:
                        "When you cast this spell, search your library for a land card, put it onto the battlefield, then shuffle.",
                    head: { kind: "spell-cast", scope: "self" },
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Land" },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a land card.",
                            bind: "$found1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "battlefield",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
                {
                    id: "sowing-mycospawn-trigger-2",
                    oracleText:
                        "When you cast this spell, if it was kicked, exile target land.",
                    head: { kind: "spell-cast", scope: "self" },
                    condition: { kind: "spell-kicked" },
                    targetRequirement: { type: "Land", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { kickerCount: true },
                                op: "ge",
                                right: 1,
                            },
                            then: [{ op: "exile", target: { target: 0 } }],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker {1}{C}",
                    mana: { X: 1, C: 1 },
                },
            ],
        },
    },
    // the per-kicker form: one payment record per printed cost (CR 702.33f)
    {
        card: {
            name: "Wastescape Battlemage",
            manaCost: "{1}{C}",
            typeLine: "Creature — Eldrazi Wizard",
            oracleText:
                "Kicker {G} and/or {1}{U}\nWhen you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\nWhen you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.",
            power: "2",
            toughness: "2",
            oracleId: "3cc6475d-aae9-4592-a26b-0fbb4269759d",
            layout: "normal",
        },
        expected: {
            name: "Wastescape Battlemage",
            types: ["Creature"],
            subtypes: ["Eldrazi", "Wizard"],
            manaCost: { X: 1, C: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Kicker {G} and/or {1}{U}\nWhen you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\nWhen you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.",
            compiledTriggeredAbilities: [
                {
                    id: "wastescape-battlemage-trigger",
                    oracleText:
                        "When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.",
                    head: { kind: "spell-cast", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-g" },
                    targetRequirement: {
                        type: ["Artifact", "Enchantment"],
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-g" },
                                op: "ge",
                                right: 1,
                            },
                            then: [{ op: "exile", target: { target: 0 } }],
                        },
                    ],
                },
                {
                    id: "wastescape-battlemage-trigger-2",
                    oracleText:
                        "When you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.",
                    head: { kind: "spell-cast", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-u" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-u" },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "moveZone",
                                    target: { target: 0 },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "kicker-g",
                    description: "Kicker {G}",
                    mana: { G: 1 },
                },
                {
                    id: "kicker-u",
                    description: "Kicker {1}{U}",
                    mana: { X: 1, U: 1 },
                },
            ],
        },
    },
];

describe("cast-self kicked gate — goldens (CR 702.33d, CR 702.33f, CR 603.4)", () => {
    for (const { card, expected } of GOLDENS)
        it(`${card.name} compiles whole`, () => {
            const outcome = compileCard(oracleCard(card));
            // `ready`, not merely parsed: `quarantine` keeps the card unplayable.
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
        });
});

describe("cast-self kicked gate — refusals (fail-closed)", () => {
    const KICKER = "Kicker {1}{C}\n";
    const unparsed = (oracleText: string): boolean =>
        compileCard(
            oracleCard({
                name: "Probe Spawn",
                manaCost: "{3}{G}",
                typeLine: "Creature — Eldrazi",
                oracleText,
                power: "3",
                toughness: "3",
            })
        ).state === "unparsed";

    it("still reads a line with the gate on a real probe, so each refusal below is the neighbour's", () => {
        expect(
            unparsed(
                `${KICKER}When you cast this spell, if it was kicked, exile target land.`
            )
        ).toBe(false);
    });

    it("refuses the gate behind a cast head that watches other spells (CR 702.33d)", () => {
        for (const head of [
            "Whenever you cast a spell",
            "Whenever an opponent casts a spell",
            "Whenever a player casts a spell",
        ])
            expect(
                unparsed(
                    `${KICKER}${head}, if it was kicked, exile target land.`
                ),
                head
            ).toBe(true);
    });

    it("refuses a subject other than the printed pronoun", () => {
        expect(
            unparsed(
                `${KICKER}When you cast this spell, if this spell was kicked, exile target land.`
            )
        ).toBe(true);
    });

    it("refuses the gate on a card that prints no kicker (CR 702.33e)", () => {
        expect(
            unparsed(
                "When you cast this spell, if it was kicked, exile target land."
            )
        ).toBe(true);
    });

    it("refuses a kicker cost the card does not print (CR 702.33f)", () => {
        expect(
            unparsed(
                "Kicker {G} and/or {1}{U}\nWhen you cast this spell, if it was kicked with its {R} kicker, exile target land."
            )
        ).toBe(true);
    });

    it("refuses the evidence gate behind the cast head (CR 701.59c)", () => {
        expect(
            unparsed(
                "As an additional cost to cast this spell, you may collect evidence 4.\nWhen you cast this spell, if evidence was collected, exile target land."
            )
        ).toBe(true);
    });
});

describe("the kicked gates fit only a head with a source to read (CR 702.33d)", () => {
    const probe = (
        head: CompiledTriggeredAbility["head"],
        condition: CompiledTriggeredAbility["condition"]
    ) =>
        resolveCompiledTrigger({
            id: "probe",
            oracleText: "probe",
            head,
            condition,
            effects: [],
        } as never);
    const castSelf = { kind: "spell-cast", scope: "self" } as const;
    const enteredSelf = { kind: "entered", scope: "self" } as const;

    it("rebuilds the unnamed gate on a cast-self head, as a decided gate", () => {
        const { gate } = probe(castSelf, { kind: "spell-kicked" });
        expect(gate && "onSelf" in gate).toBe(true);
        if (!gate || !("onSelf" in gate)) return;
        expect(
            gate.onSelf({
                kickerPayments: { kicker: 1 },
            } as unknown as PermanentView)
        ).toBe(true);
        expect(gate.onSelf({} as unknown as PermanentView)).toBe(false);
    });

    it("rebuilds the per-kicker gate on a cast-self head and on an entered-self head", () => {
        for (const head of [castSelf, enteredSelf]) {
            const { gate } = probe(head, {
                kind: "kicker-paid",
                kickerId: "kicker-g",
            });
            expect(gate && "onSelf" in gate, head.kind).toBe(true);
        }
    });

    it("throws on every other head", () => {
        expect(() => probe(enteredSelf, { kind: "spell-kicked" })).toThrow(
            /spell-kicked/
        );
        expect(() =>
            probe(
                { kind: "spell-cast", scope: "you" },
                { kind: "spell-kicked" }
            )
        ).toThrow(/spell-kicked/);
        expect(() =>
            probe(
                { kind: "spell-cast", scope: "you" },
                { kind: "kicker-paid", kickerId: "kicker-g" }
            )
        ).toThrow(/kicker-paid/);
        expect(() =>
            probe(castSelf, { kind: "cast-off-sorcery-timing" })
        ).toThrow(/cast-off-sorcery-timing/);
    });
});
