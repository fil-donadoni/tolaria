// Narrowed stack targets and the flat counter tax (CR 701.6a, CR 118.12a,
// issue #4555).
//
// Three layers, each watching a different way this family can go wrong:
//
//  1. GOLDEN forms — a real corpus card compiled whole must produce exactly
//     the Compiled Definition below, one card per accepted form: the activated
//     or triggered ability target (Stifle), the card-type, colour and
//     conditional-colour spell targets (Annul, Gainsay, Red/Blue Elemental
//     Blast, Pyroblast, Hydroblast, Lifeforce), the mana-value limit and its
//     kicked replacement (Prohibit), the spell-or-ability target with the
//     "countered this way" rider (Teferi's Response) and the flat tax
//     (Mana Leak).
//  2. REFUSALS — the neighbours these rules must NOT read: a colour no card
//     prints, a tax that is not a plain {N}, a rider behind a counter that can
//     never name an ability, a kicked limit with no base limit to replace.
//  3. CONTAINMENT — the narrowed stack phrases belong to the counter verb; no
//     other verb may read them.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function card(
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

function instant(name: string, manaCost: string, oracleText: string) {
    return card(name, manaCost, "Instant", oracleText);
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(c: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(c);
    if (outcome.state === "unparsed")
        throw new Error(`${c.name} unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition;
}

/** WHERE the compiler gave up on a card it refuses (exactly one gap). */
function refusedAt(c: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(c);
    if (outcome.state !== "unparsed")
        throw new Error(`${c.name} parsed, but should not have`);
    if (outcome.gaps.length !== 1)
        throw new Error(
            `${c.name}: expected one gap, got ${JSON.stringify(outcome.gaps)}`
        );
    const gap = outcome.gaps[0]!;
    return gap.attribution === undefined
        ? gap.reason
        : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`;
}

const PERMANENT_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
];

describe("narrowed stack targets of a counter (CR 701.6a, CR 115.2)", () => {
    it("reads 'target activated or triggered ability' — Stifle", () => {
        expect(
            sortKeys(
                compiled(
                    instant(
                        "Stifle",
                        "{U}",
                        "Counter target activated or triggered ability."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Stifle",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText: "Counter target activated or triggered ability.",
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    spellStackKind: "ability",
                },
            })
        );
    });

    it("reads 'target artifact or enchantment spell' — Annul", () => {
        expect(
            sortKeys(
                compiled(
                    instant(
                        "Annul",
                        "{U}",
                        "Counter target artifact or enchantment spell."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Annul",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText: "Counter target artifact or enchantment spell.",
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    spellTypeFilter: ["Artifact", "Enchantment"],
                },
            })
        );
    });

    it("reads 'target blue spell' — Gainsay", () => {
        expect(
            sortKeys(
                compiled(
                    instant("Gainsay", "{1}{U}", "Counter target blue spell.")
                )
            )
        ).toEqual(
            sortKeys({
                name: "Gainsay",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText: "Counter target blue spell.",
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    colorFilter: "U",
                },
            })
        );
    });

    it("reads 'target red spell' beside a blue permanent mode — Blue Elemental Blast", () => {
        expect(
            sortKeys(
                compiled(
                    instant(
                        "Blue Elemental Blast",
                        "{U}",
                        "Choose one —\n• Counter target red spell.\n• Destroy target red permanent."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Blue Elemental Blast",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText:
                    "Choose one —\n• Counter target red spell.\n• Destroy target red permanent.",
                modes: [
                    {
                        id: "blue-elemental-blast-mode-1",
                        label: "Counter target red spell",
                        oracleText: "Counter target red spell.",
                        effects: [{ op: "counter", target: { target: 0 } }],
                        targetRequirement: {
                            type: "spell",
                            count: 1,
                            colorFilter: "R",
                        },
                    },
                    {
                        id: "blue-elemental-blast-mode-2",
                        label: "Destroy target red permanent",
                        oracleText: "Destroy target red permanent.",
                        effects: [{ op: "destroy", target: { target: 0 } }],
                        targetRequirement: {
                            type: PERMANENT_TYPES,
                            count: 1,
                            colorFilter: "R",
                        },
                    },
                ],
            })
        );
    });

    it("reads 'target blue spell' as an activated ability's target — Lifeforce", () => {
        expect(
            sortKeys(
                compiled(
                    card(
                        "Lifeforce",
                        "{G}{G}",
                        "Enchantment",
                        "{G}{G}: Counter target black spell."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Lifeforce",
                types: ["Enchantment"],
                manaCost: { G: 2 },
                oracleText: "{G}{G}: Counter target black spell.",
                activatedAbilities: [
                    {
                        id: "lifeforce-ability",
                        oracleText: "{G}{G}: Counter target black spell.",
                        cost: { mana: { G: 2 } },
                        useStack: true,
                        effects: [{ op: "counter", target: { target: 0 } }],
                        targetRequirement: {
                            type: "spell",
                            count: 1,
                            colorFilter: "B",
                        },
                    },
                ],
            })
        );
    });

    it("reads 'target spell if it's blue' and 'target permanent if it's blue' — Pyroblast", () => {
        expect(
            sortKeys(
                compiled(
                    instant(
                        "Pyroblast",
                        "{R}",
                        "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Pyroblast",
                types: ["Instant"],
                manaCost: { R: 1 },
                oracleText:
                    "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue.",
                modes: [
                    {
                        id: "pyroblast-mode-1",
                        label: "Counter target spell if it's blue",
                        oracleText: "Counter target spell if it's blue.",
                        effects: [{ op: "counter", target: { target: 0 } }],
                        targetRequirement: {
                            type: "spell",
                            count: 1,
                            colorFilter: "U",
                        },
                    },
                    {
                        id: "pyroblast-mode-2",
                        label: "Destroy target permanent if it's blue",
                        oracleText: "Destroy target permanent if it's blue.",
                        effects: [{ op: "destroy", target: { target: 0 } }],
                        targetRequirement: {
                            type: PERMANENT_TYPES,
                            count: 1,
                            colorFilter: "U",
                        },
                    },
                ],
            })
        );
    });

    it("reads the conditional spelling at the other colour — Hydroblast", () => {
        const definition = compiled(
            instant(
                "Hydroblast",
                "{U}",
                "Choose one —\n• Counter target spell if it's red.\n• Destroy target permanent if it's red."
            )
        );
        expect(definition.modes?.map((mode) => mode.targetRequirement)).toEqual(
            [
                { type: "spell", count: 1, colorFilter: "R" },
                { type: PERMANENT_TYPES, count: 1, colorFilter: "R" },
            ]
        );
    });

    // CR 202.3 + CR 702.33g — the limit is the printed digits, and the kicked
    // sentence swaps the announced requirement (it announces no second target).
    it("reads the mana-value limit and its kicked replacement — Prohibit", () => {
        expect(
            sortKeys(
                compiled(
                    instant(
                        "Prohibit",
                        "{1}{U}",
                        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nCounter target spell if its mana value is 2 or less. If this spell was kicked, counter that spell if its mana value is 4 or less instead."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Prohibit",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText:
                    "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nCounter target spell if its mana value is 2 or less. If this spell was kicked, counter that spell if its mana value is 4 or less instead.",
                kickers: [
                    {
                        id: "kicker",
                        description: "Kicker {2}",
                        mana: { X: 2 },
                    },
                ],
                effects: [{ op: "counter", target: { target: 0 } }],
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    mvFilter: { max: 2 },
                },
                kickedTargetRequirement: {
                    type: "spell",
                    count: 1,
                    mvFilter: { max: 4 },
                },
            })
        );
    });

    // CR 114.1 + CR 701.6a + CR 113.7a — a spell OR ability, and the rider
    // that acts on the SOURCE of a countered ability.
    it("reads the spell-or-ability target and its rider — Teferi's Response", () => {
        const definition = compiled(
            instant(
                "Teferi's Response",
                "{1}{U}",
                "Counter target spell or ability an opponent controls that targets a land you control. If a permanent's ability is countered this way, destroy that permanent.\nDraw two cards."
            )
        );
        expect(definition.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            controller: "opponent",
            spellStackKind: "any",
            spellTargetsPermanentFilter: { types: "Land", controller: "you" },
        });
        expect(definition.effects).toEqual([
            { op: "counter", target: { target: 0 }, bindSource: "$source1" },
            { op: "destroy", target: { ref: "$source1" } },
            { op: "draw", player: "controller", count: 2 },
        ]);
    });
});

describe("the flat counter tax (CR 118.12a)", () => {
    it("lowers 'unless its controller pays {N}' to mayPay + if-not — Mana Leak", () => {
        expect(
            sortKeys(
                compiled(
                    instant(
                        "Mana Leak",
                        "{1}{U}",
                        "Counter target spell unless its controller pays {3}."
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Mana Leak",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText:
                    "Counter target spell unless its controller pays {3}.",
                effects: [
                    {
                        op: "mayPay",
                        player: { controllerOf: { target: 0 } },
                        cost: { X: 3 },
                        prompt: "Pay {3} to prevent your spell from being countered?",
                        bind: "$may1",
                    },
                    {
                        op: "if",
                        predicate: { not: { binding: "$may1" } },
                        then: [{ op: "counter", target: { target: 0 } }],
                    },
                ],
                targetRequirement: { type: "spell", count: 1 },
            })
        );
    });
});

describe("the neighbours these rules refuse (fail-closed, ADR 0105 § 2)", () => {
    // {X} is the spell's own announced amount; a flat-tax rule that read it
    // as a digit would price nothing. Condescend prints it.
    it("refuses a variable tax — Condescend", () => {
        expect(
            refusedAt(
                instant(
                    "Condescend",
                    "{X}{U}",
                    "Counter target spell unless its controller pays {X}. Scry 2."
                )
            )
        ).toBe(
            "effect clause: Counter target spell unless its controller pays {X}"
        );
    });

    // A zero tax would lower to a counterspell that never counters.
    it("refuses a zero tax", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Counter target spell unless its controller pays {0}."
                )
            )
        ).toBe(
            "effect clause: Counter target spell unless its controller pays {0}"
        );
    });

    // A tax with a rider after it is a different price (Dazzling Denial's
    // "instead" branch), not a Mana Leak with extra words.
    it("refuses a tax with a trailing 'plus an additional' price", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Counter target spell unless its controller pays {1} plus an additional {1} for each Faerie you control."
                )
            )
        ).toBe(
            "effect clause: Counter target spell unless its controller pays {1} plus an additional {1} for each Faerie you control"
        );
    });

    // Only the colours a printed counter names have a fixture.
    it("refuses a colour no card here prints", () => {
        expect(
            refusedAt(instant("Probe", "{U}", "Counter target green spell."))
        ).toBe(
            "effect clause > target filter > object descriptor: green spell"
        );
    });

    it("refuses a conditional colour past the Blast cycle's two", () => {
        expect(
            refusedAt(
                instant("Probe", "{U}", "Counter target spell if it's green.")
            )
        ).toBe(
            "effect clause > target filter > object descriptor: spell if it's green"
        );
    });

    it("refuses a mana-value limit that is not 'N or less'", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Counter target spell if its mana value is 2 or greater."
                )
            )
        ).toBe(
            "effect clause > target filter > object descriptor: spell if its mana value is 2 or greater"
        );
    });

    // Trickbind prints the same lead-in with a different consequence; the
    // rider this grammar reads is "destroy that permanent", whole.
    it("refuses a different consequence of a countered ability — Trickbind", () => {
        expect(
            refusedAt(
                instant(
                    "Trickbind",
                    "{1}{U}",
                    "Counter target activated or triggered ability. If a permanent's ability is countered this way, activated abilities of that permanent can't be activated this turn."
                )
            )
        ).toBe(
            "effect clause: If a permanent's ability is countered this way, activated abilities of that permanent can't be activated this turn"
        );
    });

    // A rider behind a counter that can only ever name a spell could never
    // fire; reading it would be accepting a sentence that does nothing.
    it("refuses the rider behind a spell-only counter", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Counter target spell. If a permanent's ability is countered this way, destroy that permanent."
                )
            )
        ).toBe(
            "sentence assembly: Counter target spell. If a permanent's ability is countered this way, destroy that permanent"
        );
    });

    // The kicked limit replaces a limit; a base counter without one has
    // nothing for the kicker to widen.
    it("refuses a kicked limit with no base limit to replace", () => {
        expect(
            refusedAt(
                card(
                    "Probe",
                    "{1}{U}",
                    "Instant",
                    "Kicker {2}\nCounter target spell. If this spell was kicked, counter that spell if its mana value is 4 or less instead."
                )
            )
        ).toBe(
            "a kicked mana-value limit replaces the limit of the one spell target (CR 702.33g)"
        );
    });

    // The "instead" half is a kicker gate's replacement; standing alone it
    // replaces nothing.
    it("refuses the 'instead' limit outside a kicker gate", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Counter target spell if its mana value is 2 or less. Counter that spell if its mana value is 4 or less instead."
                )
            )
        ).toBe(
            'a counter limit "instead" is a kicker gate\'s replacement (CR 702.33g)'
        );
    });
});

describe("the narrowed stack phrases are the counter verb's own", () => {
    it("lets no other verb read an activated or triggered ability target", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Copy target activated or triggered ability."
                )
            )
        ).toMatch(/activated or triggered ability/);
    });

    it("lets no other verb read a colour-narrowed spell target", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "{U}",
                    "Target blue spell becomes the color of your choice until end of turn."
                )
            )
        ).toMatch(/blue spell/);
    });
});
