// Transmute [cost] (CR 702.53a) — the keyword-line rule `transmute`.
//
//  1. GOLDEN fixtures — real corpus cards compiled whole must produce exactly
//     this Compiled Definition: the cost lands in the catalogue's own
//     `transmuteAbility`, and the searched-for mana value is the card's
//     printed one (CR 202.3; no mana cost = 0, CR 202.3a).
//  2. REFUSALS — the neighbours the rule must NOT read: a cost the payment
//     path does not exercise, a non-mana cost, a second declaration.
//     Fail-closed is pinned, not assumed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const TRANSMUTE_UU =
    "Transmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)";

/** The ability `transmuteAbility` builds for `mana` and `manaValue`. */
function transmuteAbilityFor(
    mana: Record<string, number>,
    manaValue: number,
    oracleText = TRANSMUTE_UU
) {
    return {
        id: "transmute",
        oracleText,
        cost: { mana, discardThis: true },
        activateFromHand: true,
        useStack: true,
        sorcerySpeedOnly: true,
        effects: [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { manaValueEquals: manaValue },
                count: { min: 0, max: 1 },
                prompt: `Search your library for a card with mana value ${manaValue} (or none).`,
                bind: "$transmuted",
            },
            {
                op: "reveal",
                player: "controller",
                cards: { ref: "$transmuted" },
            },
            {
                op: "moveZone",
                cards: { ref: "$transmuted" },
                player: "controller",
                from: "library",
                to: "hand",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ],
    };
}

describe("Transmute [cost] (CR 702.53a)", () => {
    it("Dizzy Spell: the printed mana value {U} = 1 is the searched-for value", () => {
        const oracleText = `Target creature gets -3/-0 until end of turn.\n${TRANSMUTE_UU}`;
        expect(
            compiled(
                oracleCard({
                    name: "Dizzy Spell",
                    manaCost: "{U}",
                    typeLine: "Instant",
                    oracleText,
                })
            )
        ).toEqual({
            name: "Dizzy Spell",
            types: ["Instant"],
            manaCost: { U: 1 },
            oracleText,
            activatedAbilities: [transmuteAbilityFor({ X: 1, U: 2 }, 1)],
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -3,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        });
    });

    it("Dimir House Guard: a {1}{B}{B} cost and a four-pip printed mana value", () => {
        const line =
            "Transmute {1}{B}{B} ({1}{B}{B}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)";
        const definition = compiled(
            oracleCard({
                name: "Dimir House Guard",
                manaCost: "{3}{B}",
                typeLine: "Creature — Skeleton",
                power: "2",
                toughness: "3",
                oracleText: `Fear (This creature can't be blocked except by artifact creatures and/or black creatures.)\nSacrifice a creature: Regenerate this creature.\n${line}`,
            })
        );
        expect(
            definition.activatedAbilities?.find((a) => a.id === "transmute")
        ).toEqual(transmuteAbilityFor({ X: 1, B: 2 }, 4, line));
    });

    it("Tolaria West (GOLDEN_FIXTURES): no mana cost searches for mana value 0 (CR 202.3a)", () => {
        const fixture = GOLDEN_FIXTURES.find((f) => f.rule === "transmute");
        expect(fixture).toBeDefined();
        expect(compiled(fixture!.card)).toEqual(fixture!.expected);
        expect(fixture!.expected.activatedAbilities?.[1]).toEqual(
            transmuteAbilityFor({ X: 1, U: 2 }, 0)
        );
    });

    it.each([
        ["a variable cost", "Transmute {X}{U}"],
        ["a hybrid cost", "Transmute {1}{U/B}"],
        ["a non-mana cost", "Transmute—Pay 3 life"],
    ])("REFUSES %s", (_why, line) => {
        expect(keywordLineSlot.run(line, parseContext()).ok).toBe(false);
    });

    it("REFUSES a card declaring transmute twice (one ability id per card)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Transmute",
                manaCost: "{U}",
                typeLine: "Instant",
                oracleText: "Transmute {1}{U}{U}\nTransmute {1}{B}{B}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
