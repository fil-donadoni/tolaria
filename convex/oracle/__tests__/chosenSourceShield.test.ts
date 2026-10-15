// "The next time a[n] <qualifier> source of your choice would deal damage to
// you this turn, prevent that damage" (CR 609.7a / 615.1a, issue #5601).
//
// Two layers:
//
//  1. GOLDEN fixtures — a real corpus card per accepted form compiles whole to
//     exactly this Compiled Definition: a `pick-source` choice over the
//     `battlefield-or-stack` pool, filtered by the printed qualifier, then a
//     `"next-from-source"` shield on the pick. One colour, two colours joined
//     by "or", the card types "artifact" and "land", and no qualifier.
//  2. REFUSALS — the neighbour forms this rule has no fixture for stay
//     unparsed: another recipient, no recipient at all, a qualifier outside
//     the closed set.
//
// Gold over the hand-written catalogue (the Circle of Protection cycle,
// Greater Realm of Preservation, Pentagram of the Ages) is `gold.test.ts`'s.

import { describe, expect, it } from "vitest";
import type { CompiledDefinition } from "../types";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function enchantment(name: string, oracleText: string, manaCost = "{1}{W}") {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Enchantment",
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The two-Op script every accepted form lowers to: the qualifier is the
 *  choice's `filter` and, again, the shield's CR 609.7b recheck `match`. */
function shieldScript(
    filter: Record<string, unknown> | undefined,
    match: Record<string, unknown> | undefined,
    prompt: string
) {
    return [
        {
            op: "choice",
            kind: "pick-source",
            player: "controller",
            zone: "battlefield-or-stack",
            ...(filter === undefined ? {} : { filter }),
            count: 1,
            prompt,
            bind: "$source1",
        },
        {
            op: "preventDamage",
            mode: "next-from-source",
            source: { ref: "$source1" },
            to: { player: "controller" },
            duration: { phase: "end-of-turn" },
            ...(match === undefined ? {} : { match }),
        },
    ];
}

const RED =
    "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.";

describe("a source of your choice — golden fixtures (CR 609.7a)", () => {
    it("one colour: Circle of Protection: Red", () => {
        expect(compiled(enchantment("Circle of Protection: Red", RED))).toEqual(
            {
                name: "Circle of Protection: Red",
                types: ["Enchantment"],
                manaCost: { X: 1, W: 1 },
                oracleText: RED,
                activatedAbilities: [
                    {
                        id: "circle-of-protection-red-ability",
                        oracleText: RED,
                        cost: { mana: { X: 1 } },
                        useStack: true,
                        effects: shieldScript(
                            { color: "R" },
                            { colors: ["R"] },
                            "Choose a red source."
                        ),
                    },
                ],
            }
        );
    });

    it("one colour beside Cycling: Rune of Protection: Red", () => {
        const line =
            "{W}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.";
        const definition = compiled(
            enchantment(
                "Rune of Protection: Red",
                `${line}\nCycling {2} ({2}, Discard this card: Draw a card.)`
            )
        );
        expect(definition.activatedAbilities?.[0]).toEqual({
            id: "rune-of-protection-red-ability",
            oracleText: line,
            cost: { mana: { W: 1 } },
            useStack: true,
            effects: shieldScript(
                { color: "R" },
                { colors: ["R"] },
                "Choose a red source."
            ),
        });
    });

    it('two colours joined by "or": Greater Realm of Preservation', () => {
        const line =
            "{1}{W}: The next time a black or red source of your choice would deal damage to you this turn, prevent that damage.";
        expect(
            compiled(enchantment("Greater Realm of Preservation", line))
                .activatedAbilities?.[0]?.effects
        ).toEqual(
            shieldScript(
                { color: ["B", "R"] },
                { colors: ["B", "R"] },
                "Choose a black or red source."
            )
        );
    });

    it("a card type: Circle of Protection: Artifacts", () => {
        const line =
            "{2}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.";
        const ability = compiled(
            enchantment("Circle of Protection: Artifacts", line)
        ).activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { X: 2 } });
        expect(ability?.effects).toEqual(
            shieldScript(
                { type: "Artifact" },
                { cardType: "Artifact" },
                "Choose an artifact source."
            )
        );
    });

    it("a card type: Rune of Protection: Lands", () => {
        const line =
            "{W}: The next time a land source of your choice would deal damage to you this turn, prevent that damage.";
        expect(
            compiled(
                enchantment(
                    "Rune of Protection: Lands",
                    `${line}\nCycling {2} ({2}, Discard this card: Draw a card.)`
                )
            ).activatedAbilities?.[0]?.effects
        ).toEqual(
            shieldScript(
                { type: "Land" },
                { cardType: "Land" },
                "Choose a land source."
            )
        );
    });

    it("no qualifier: Pentagram of the Ages", () => {
        const line =
            "{4}, {T}: The next time a source of your choice would deal damage to you this turn, prevent that damage.";
        const ability = compiled(
            oracleCard({
                name: "Pentagram of the Ages",
                manaCost: "{4}",
                typeLine: "Artifact",
                oracleText: line,
                power: undefined,
                toughness: undefined,
            })
        ).activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { X: 4 }, tap: true });
        expect(ability?.effects).toEqual(
            shieldScript(undefined, undefined, "Choose a source.")
        );
    });
});

describe("a source of your choice — refused neighbours (fail-closed)", () => {
    const refused = (text: string) =>
        compileCard(enchantment("Probe", text)).state;

    it.each([
        // No recipient: the shield covers the source's damage to ANYTHING —
        // a different shield (the corpus's "{W}, Sacrifice this creature" pair).
        "{W}: The next time a red source of your choice would deal damage this turn, prevent that damage.",
        // Another recipient.
        "{1}: The next time a source of your choice would deal damage to any target this turn, prevent that damage.",
        "{1}: The next time a source of your choice would deal damage to target creature this turn, prevent that damage.",
        "{1}: The next time a source of your choice would deal damage to you and/or creatures you control this turn, prevent that damage.",
        // A qualifier outside the closed set.
        "{1}: The next time a creature source of your choice would deal damage to you this turn, prevent that damage.",
        "{1}: The next time a nonblack source of your choice would deal damage to you this turn, prevent that damage.",
        "{1}: The next time a white, blue or red source of your choice would deal damage to you this turn, prevent that damage.",
        "{1}: The next time a white or blue or red source of your choice would deal damage to you this turn, prevent that damage.",
        // A partial prevention is another effect.
        "{1}: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.",
    ])("%s", (text) => {
        expect(refused(text)).toBe("unparsed");
    });
});
