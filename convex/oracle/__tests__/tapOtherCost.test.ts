// Tap-other activation cost: "Tap two untapped creatures you control"
// (CR 118.3 / 701.26a, issue #4140).
//
// Three layers, each watching a different way this cost can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle row compiled whole must produce exactly
//     this Compiled Definition: the bare cost (Diversionary Tactics) and the
//     cost beside `{T}` (Tradewind Rider).
//  2. REFUSALS — the neighbours this rule must NOT read, so fail-closed is
//     pinned rather than assumed: a source that could tap ITSELF to pay (the
//     engine's candidate pool excludes the source), a shared-type
//     qualifier, a colour clause, a count that disagrees with its noun, and
//     "Sacrifice enchanted creature" (no engine cost leg, so Bloodfire
//     Infusion stays unparsed at its own span).
//  3. LOWERING invariant — the source-exclusion refusal turns on whether the
//     cost also carries `{T}`, not on the card's type alone.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./fixtures";

const TWO_UNTAPPED = "Tap two untapped creatures you control";

function permanent(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    const creature = typeLine.startsWith("Creature");
    return oracleCard({
        name,
        manaCost,
        typeLine,
        oracleText,
        power: creature ? "2" : undefined,
        toughness: creature ? "2" : undefined,
    });
}

/** The cost span alone, read for a source of the given printed type line. */
function costFor(span: string, typeLine: string) {
    return activationCostRule.run(
        span,
        parseContext(permanent("Source", "{2}", typeLine, ""))
    );
}

describe("Tap-other cost — golden fixtures (CR 118.3, 701.26a)", () => {
    it("Diversionary Tactics: the bare cost lowers to cost.tapOtherFilter", () => {
        const outcome = compileCard(
            permanent(
                "Diversionary Tactics",
                "{3}{W}",
                "Enchantment",
                `${TWO_UNTAPPED}: Tap target creature.`
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Diversionary Tactics",
            types: ["Enchantment"],
            manaCost: { X: 3, W: 1 },
            oracleText: `${TWO_UNTAPPED}: Tap target creature.`,
            activatedAbilities: [
                {
                    id: "diversionary-tactics-ability",
                    oracleText: `${TWO_UNTAPPED}: Tap target creature.`,
                    cost: {
                        tapOtherFilter: {
                            filter: {
                                types: ["Creature"],
                                controllerRelation: "you",
                            },
                            count: 2,
                        },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { target: 0 },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
        });
    });

    it("Tradewind Rider: {T} beside the cost taps the source AND two others", () => {
        const text = `{T}, ${TWO_UNTAPPED}: Return target permanent to its owner's hand.`;
        const outcome = compileCard(
            permanent("Tradewind Rider", "{3}{U}{U}", "Creature — Spirit", text)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities?.[0]?.cost).toEqual({
            tap: true,
            tapOtherFilter: {
                filter: { types: ["Creature"], controllerRelation: "you" },
                count: 2,
            },
        });
    });
});

/** The other forms this rule reads — same cost atom, different noun phrase or
 *  slot — each a real corpus row, asserted on the ability's cost and stack use
 *  (the whole-definition goldens above pin the surrounding lowering). */
const NOUN_PHRASE_FORMS: readonly {
    name: string;
    manaCost: string;
    typeLine: string;
    power?: string;
    oracleText: string;
    ability: number;
    cost: object;
    useStack: boolean;
}[] = [
    {
        name: "Ghirapur Aether Grid",
        manaCost: "{2}{R}",
        typeLine: "Enchantment",
        oracleText:
            "Tap two untapped artifacts you control: This enchantment deals 1 damage to any target.",
        ability: 0,
        cost: {
            tapOtherFilter: {
                filter: { types: ["Artifact"], controllerRelation: "you" },
                count: 2,
            },
        },
        useStack: true,
    },
    {
        name: "Dune Diviner",
        manaCost: "{2}{G}",
        typeLine: "Creature — Snake Cleric",
        power: "2",
        oracleText: "{1}, Tap an untapped Desert you control: You gain 1 life.",
        ability: 0,
        cost: {
            mana: { X: 1 },
            tapOtherFilter: {
                filter: { subtypes: ["Desert"], controllerRelation: "you" },
                count: 1,
            },
        },
        useStack: true,
    },
    {
        name: "Relic of Legends",
        manaCost: "{3}",
        typeLine: "Artifact",
        oracleText:
            "{T}: Add one mana of any color.\nTap an untapped legendary creature you control: Add one mana of any color.",
        ability: 1,
        cost: {
            tapOtherFilter: {
                filter: {
                    types: ["Creature"],
                    supertypes: ["Legendary"],
                    controllerRelation: "you",
                },
                count: 1,
            },
        },
        useStack: false,
    },
    {
        name: "Honor-Worn Shaku",
        manaCost: "{3}",
        typeLine: "Artifact",
        oracleText:
            "{T}: Add {C}.\nTap an untapped legendary permanent you control: Untap this artifact.",
        ability: 1,
        cost: {
            tapOtherFilter: {
                // "permanent" is every permanent type (CR 110.4).
                filter: {
                    types: [
                        "Artifact",
                        "Battle",
                        "Creature",
                        "Enchantment",
                        "Land",
                        "Planeswalker",
                    ],
                    supertypes: ["Legendary"],
                    controllerRelation: "you",
                },
                count: 1,
            },
        },
        useStack: true,
    },
];

describe("Tap-other cost — the other noun phrases and the mana slot", () => {
    it.each(NOUN_PHRASE_FORMS)(
        "$name reads its cost into cost.tapOtherFilter",
        (form) => {
            const outcome = compileCard(
                oracleCard({
                    name: form.name,
                    manaCost: form.manaCost,
                    typeLine: form.typeLine,
                    oracleText: form.oracleText,
                    power: form.power,
                    toughness: form.power === undefined ? undefined : "2",
                })
            );
            expect(outcome.state).toBe("ready");
            if (outcome.state !== "ready") return;
            const ability =
                outcome.definition.activatedAbilities?.[form.ability];
            expect(ability?.cost).toEqual(form.cost);
            expect(ability?.useStack).toBe(form.useStack);
        }
    );
});

describe("Tap-other cost — the mana slot pays it only without {T} (CR 605.1a)", () => {
    // `activateManaAbility` pays a tap-other pick; the `{T}` route
    // (`tapUntap`) does not, so "{T}, Tap an untapped creature you control:
    // Add one mana" would tap the source, tap nothing else and produce mana.
    // Refused until that route has a tap-other leg
    // (docs/findings/4140-mana-tap-route-pays-no-tap-other.md).
    it.each([
        {
            name: "Springleaf Drum",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText:
                "{T}, Tap an untapped creature you control: Add one mana of any color.",
        },
        {
            name: "Gene Pollinator",
            manaCost: "{G}",
            typeLine: "Artifact Creature — Robot Insect",
            oracleText:
                "{T}, Tap an untapped permanent you control: Add one mana of any color.",
        },
    ])("$name stays unparsed", (row) => {
        const creature = row.typeLine.includes("Creature");
        const outcome = compileCard(
            oracleCard({
                ...row,
                power: creature ? "1" : undefined,
                toughness: creature ? "2" : undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Tap-other cost — could the source pay with itself? (supertypes, exclusions, grants)", () => {
    it("a supertype the source shares decides it: legendary vs not", () => {
        // Legendary creature tapping "a legendary creature": itself qualifies.
        expect(
            costFor(
                "Tap an untapped legendary creature you control",
                "Legendary Creature — Elf"
            ).ok
        ).toBe(false);
        // Same filter, source is a creature but not legendary: it cannot.
        expect(
            costFor(
                "Tap an untapped legendary creature you control",
                "Creature — Elf"
            ).ok
        ).toBe(true);
        // Honor-Worn Shaku's shape: a non-legendary artifact, legendary filter.
        expect(
            costFor(
                "Tap an untapped legendary permanent you control",
                "Artifact"
            ).ok
        ).toBe(true);
    });

    it("an excluded type the source has rules it out: nonartifact creature", () => {
        expect(
            costFor(
                "Tap an untapped nonartifact creature you control",
                "Artifact Creature — Golem"
            ).ok
        ).toBe(true);
        expect(
            costFor(
                "Tap an untapped nonartifact creature you control",
                "Creature — Elf"
            ).ok
        ).toBe(false);
    });

    it.each([
        "Tap an untapped legendary creature you control: Draw a card.",
        "Tap two untapped Goblins you control: Draw a card.",
        "Tap an untapped creature you control: Draw a card.",
    ])(
        "a granted ability knows its host by TYPE only, so it is refused: %s",
        (quoted) => {
            // "Enchanted creature" may be legendary or a Goblin and so tap
            // itself; the granted ability's type line carries no subtypes or
            // supertypes to say otherwise (`hostTypeOnly`).
            const outcome = compileCard(
                permanent(
                    "Grantor",
                    "{1}{U}",
                    "Enchantment — Aura",
                    `Enchant creature\nEnchanted creature has "${quoted}"`
                )
            );
            expect(outcome.state).toBe("unparsed");
        }
    );

    it("a granted ability with {T} beside the cost is fine: the host is tapped", () => {
        const outcome = compileCard(
            permanent(
                "Grantor",
                "{1}{U}",
                "Enchantment — Aura",
                'Enchant creature\nEnchanted creature has "{T}, Tap an untapped legendary creature you control: Draw a card."'
            )
        );
        expect(outcome.state).toBe("ready");
    });
});

describe("Tap-other cost — refused neighbours (fail-closed)", () => {
    it("a creature source without {T} could tap itself: refused (Root-Kin Ally)", () => {
        const outcome = compileCard(
            permanent(
                "Root-Kin Ally",
                "{3}{G}{G}",
                "Creature — Elemental Warrior",
                `${TWO_UNTAPPED}: This creature gets +2/+2 until end of turn.`
            )
        );
        expect(outcome.state).toBe("unparsed");
        const read = costFor(TWO_UNTAPPED, "Creature — Elemental Warrior");
        expect(read.ok).toBe(false);
        if (read.ok) return;
        expect(read.reason).toMatch(/could tap itself/);
    });

    it("a Vehicle is a creature whenever crewed: refused (Honeymoon Hearse)", () => {
        const outcome = compileCard(
            permanent(
                "Honeymoon Hearse",
                "{2}",
                "Artifact — Vehicle",
                `${TWO_UNTAPPED}: This Vehicle becomes an artifact creature until end of turn.`
            )
        );
        expect(outcome.state).toBe("unparsed");
        expect(costFor(TWO_UNTAPPED, "Artifact — Vehicle").ok).toBe(false);
    });

    it("a qualifier on the tapped creatures is not read (Weight of Conscience)", () => {
        const outcome = compileCard(
            permanent(
                "Weight of Conscience",
                "{1}{W}",
                "Enchantment — Aura",
                `${TWO_UNTAPPED} that share a creature type: Exile enchanted creature.`
            )
        );
        expect(outcome.state).toBe("unparsed");
        expect(
            costFor(
                `${TWO_UNTAPPED} that share a creature type`,
                "Enchantment — Aura"
            ).ok
        ).toBe(false);
    });

    it("a colour clause is not read (Hand of Justice's own shape)", () => {
        expect(
            costFor(
                "Tap three untapped white creatures you control",
                "Enchantment"
            ).ok
        ).toBe(false);
    });

    it("the count word must agree with its noun", () => {
        expect(
            costFor("Tap two untapped creature you control", "Enchantment").ok
        ).toBe(false);
        expect(
            costFor("Tap an untapped creatures you control", "Enchantment").ok
        ).toBe(false);
    });

    it("only permanents the payer controls; 'tapped' fails the atom's own head", () => {
        // The descriptor reads both of these, but `tapOtherFilter` has no
        // reading of them ("you control" is its only controller relation), so
        // the cost refuses them itself.
        expect(
            costFor(
                "Tap two untapped creatures an opponent controls",
                "Enchantment"
            ).ok
        ).toBe(false);
        expect(costFor("Tap two untapped creatures", "Enchantment").ok).toBe(
            false
        );
        expect(
            costFor("Tap two tapped creatures you control", "Enchantment").ok
        ).toBe(false);
    });

    it("'Sacrifice enchanted creature' stays unparsed at its own span (Bloodfire Infusion)", () => {
        const outcome = compileCard(
            permanent(
                "Bloodfire Infusion",
                "{2}{R}",
                "Enchantment — Aura",
                "{R}, Sacrifice enchanted creature: This Aura deals damage equal to the sacrificed creature's power to each creature."
            )
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]?.attribution).toMatchObject({
            slot: "activated",
            path: ["activation cost"],
            span: "Sacrifice enchanted creature",
        });
    });
});

describe("Tap-other cost — lowering invariant", () => {
    it("the refusal turns on {T}, not on the card type alone", () => {
        // Same creature type line, same two-creature cost: with {T} the source
        // is already tapped and cannot be one of the untapped creatures (CR
        // 107.5 / 118.3); without it the source could pay with itself.
        const type = "Creature — Spirit";
        expect(costFor(`{T}, ${TWO_UNTAPPED}`, type).ok).toBe(true);
        expect(costFor(TWO_UNTAPPED, type).ok).toBe(false);
        // A noncreature source never matches a creature filter.
        expect(costFor(TWO_UNTAPPED, "Enchantment").ok).toBe(true);
    });

    it("a filter the source cannot match is accepted for a creature source", () => {
        // "Tap an untapped Gate you control" — a Spirit creature is not a Gate.
        const read = costFor(
            "Tap an untapped Gate you control",
            "Creature — Spirit"
        );
        expect(read.ok).toBe(true);
    });

    it("a rule run with no ParseContext is refused, never assumed safe", () => {
        expect(activationCostRule.run(TWO_UNTAPPED, {}).ok).toBe(false);
    });
});
