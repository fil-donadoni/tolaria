// Mobilize N keyword line (CR 702.181a, issue #2611).
//
// GOLDEN fixtures — real corpus cards compiled whole: the count rides the one
// `"mobilize N"` static string the `getDefinition` seam expands
// (`expandMobilize`, ADR 0054), never dropped. REFUSALS — the neighbours the
// rule must NOT read: a zero count, a variable count, a cost where the count
// goes. Fail-closed is pinned, not assumed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function readLine(line: string) {
    return keywordLineSlot.run(line, parseContext());
}

const VOICE_OF_VICTORY_TEXT =
    "Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens. Sacrifice them at the beginning of the next end step.)\nYour opponents can't cast spells during your turn.";

const DRAGONBACK_LANCER_TEXT =
    "Flying\nMobilize 1 (Whenever this creature attacks, create a tapped and attacking 1/1 red Warrior creature token. Sacrifice it at the beginning of the next end step.)";

describe("Mobilize N (CR 702.181a)", () => {
    it("Voice of Victory: `mobilize 2` beside the opponent cast lock", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Voice of Victory",
                    manaCost: "{1}{W}",
                    typeLine: "Creature — Human Bard",
                    power: "1",
                    toughness: "3",
                    oracleText: VOICE_OF_VICTORY_TEXT,
                })
            )
        ).toEqual({
            name: "Voice of Victory",
            types: ["Creature"],
            subtypes: ["Human", "Bard"],
            manaCost: { X: 1, W: 1 },
            power: 1,
            toughness: 3,
            oracleText: VOICE_OF_VICTORY_TEXT,
            staticAbilities: ["mobilize 2"],
            compiledStaticEffects: [
                {
                    kind: "cast-restriction",
                    id: "voice-of-victory-opponent-cast-lock",
                    oracleText:
                        "Your opponents can't cast spells during your turn.",
                    opponentsDuringControllersTurn: true,
                },
            ],
        });
    });

    it("Dragonback Lancer: `mobilize 1` on its own line after a keyword", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Dragonback Lancer",
                    manaCost: "{3}{W}",
                    typeLine: "Creature — Human Soldier",
                    power: "3",
                    toughness: "3",
                    oracleText: DRAGONBACK_LANCER_TEXT,
                })
            )
        ).toEqual({
            name: "Dragonback Lancer",
            types: ["Creature"],
            subtypes: ["Human", "Soldier"],
            manaCost: { X: 3, W: 1 },
            power: 3,
            toughness: 3,
            oracleText: DRAGONBACK_LANCER_TEXT,
            staticAbilities: ["flying", "mobilize 1"],
        });
    });

    it("reads each printed count (Dalkovan Packbeasts' Mobilize 3)", () => {
        const parsed = readLine("Mobilize 3");
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "keywords")
            expect(parsed.value.keywords.map((k) => k.ability)).toEqual([
                "mobilize 3",
            ]);
    });

    it.each([
        ["a zero count", "Mobilize 0"],
        ["a variable count", "Mobilize X"],
        ["a cost where the count goes", "Mobilize {1}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });
});
