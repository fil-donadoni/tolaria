// Harmonize [cost] (CR 702.180a) — the keyword-line rule `harmonize`.
//
//  1. GOLDEN fixtures — real corpus cards compiled whole must produce exactly
//     this Compiled Definition: the printed cost lands on
//     `CardDefinition.harmonize`, beside the card's own spell text.
//  2. QUARANTINE — while the Mechanics Registry row is `planned`, every card
//     carrying the keyword is held back as `planned-mechanic`, never shipped
//     inert (the Guard A shape).
//  3. REFUSALS — the neighbours the rule must NOT read: a variable {X} cost,
//     a hybrid cost, a non-mana cost, a second declaration. Fail-closed is
//     pinned, not assumed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { oracleCard, parseContext } from "./oracle.fixture";

const REMINDER =
    "(You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by {X}, where X is its power. Then exile this spell.)";

const harmonizeStatus = MECHANICS_REGISTRY.find(
    (row) => row.id === "harmonize"
)?.status;

function outcomeOf(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome;
}

describe("Harmonize [cost] (CR 702.180a)", () => {
    it("Unending Whisper: Harmonize {5}{U} lands on CardDefinition.harmonize", () => {
        const oracleText = `Draw a card.\nHarmonize {5}{U} ${REMINDER}`;
        expect(
            outcomeOf(
                oracleCard({
                    name: "Unending Whisper",
                    manaCost: "{U}",
                    typeLine: "Sorcery",
                    oracleText,
                })
            ).definition
        ).toEqual({
            name: "Unending Whisper",
            types: ["Sorcery"],
            manaCost: { U: 1 },
            oracleText,
            effects: [{ op: "draw", player: "controller", count: 1 }],
            harmonize: { X: 5, U: 1 },
        });
    });

    it("Channeled Dragonfire: a two-pip Harmonize {5}{R}{R} beside a targeted spell", () => {
        const oracleText = `Channeled Dragonfire deals 2 damage to any target.\nHarmonize {5}{R}{R} ${REMINDER}`;
        expect(
            outcomeOf(
                oracleCard({
                    name: "Channeled Dragonfire",
                    manaCost: "{R}",
                    typeLine: "Sorcery",
                    oracleText,
                })
            ).definition
        ).toEqual({
            name: "Channeled Dragonfire",
            types: ["Sorcery"],
            manaCost: { R: 1 },
            oracleText,
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
            targetRequirement: { type: "any", count: 1 },
            harmonize: { X: 5, R: 2 },
        });
    });

    it.runIf(harmonizeStatus !== "implemented")(
        "QUARANTINES the card as planned-mechanic while the registry row is not implemented",
        () => {
            const outcome = outcomeOf(
                oracleCard({
                    name: "Unending Whisper",
                    manaCost: "{U}",
                    typeLine: "Sorcery",
                    oracleText: `Draw a card.\nHarmonize {5}{U} ${REMINDER}`,
                })
            );
            expect(outcome.state).toBe("quarantine");
            expect(
                outcome.state === "quarantine" ? outcome.reasons : []
            ).toContainEqual({
                kind: "planned-mechanic",
                detail: 'keyword "harmonize" is not implemented in the Mechanics Registry',
            });
        }
    );

    it.each([
        ["a variable {X} cost (Nature's Rhythm)", "Harmonize {X}{G}{G}{G}{G}"],
        ["a hybrid cost", "Harmonize {4}{G/U}"],
        ["a non-mana cost", "Harmonize—Tap two untapped creatures you control"],
    ])("REFUSES %s", (_why, line) => {
        expect(keywordLineSlot.run(line, parseContext()).ok).toBe(false);
    });

    it("REFUSES a card declaring harmonize twice (one alternative cost per keyword)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Harmonize",
                manaCost: "{U}",
                typeLine: "Sorcery",
                oracleText: "Draw a card.\nHarmonize {5}{U}\nHarmonize {4}{U}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
