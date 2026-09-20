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

    it("only permanents the payer controls, and only untapped ones", () => {
        // The descriptor reads both of these; only the payer's own permanents
        // can be tapped to pay (CR 118.3), so the cost refuses them itself.
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
