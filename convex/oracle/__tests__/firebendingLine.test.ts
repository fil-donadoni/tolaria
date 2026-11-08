// Firebending N keyword line (CR 702.189a).
//
// GOLDEN fixtures — real corpus cards compiled whole: the count rides the one
// `"firebending N"` static string the `getDefinition` seam expands
// (`expandFirebending`, ADR 0054), never dropped. REFUSALS — the neighbours
// the rule must NOT read: a zero count, a variable count, a cost where the
// count goes. Fail-closed is pinned, not assumed (ADR 0105 § 2).

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

const FIRE_SAGES_TEXT =
    "Firebending 1 (Whenever this creature attacks, add {R}. This mana lasts until end of combat.)\n{1}{R}{R}: Put a +1/+1 counter on this creature.";

const MAI_AND_ZUKO_TEXT =
    "Firebending 3\nYou may cast Ally spells and artifact spells as though they had flash.";

describe("Firebending N (CR 702.189a)", () => {
    it("Fire Sages: `firebending 1` with its reminder, beside an activated ability", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Fire Sages",
                    manaCost: "{1}{R}",
                    typeLine: "Creature — Human Cleric",
                    power: "2",
                    toughness: "2",
                    oracleText: FIRE_SAGES_TEXT,
                })
            )
        ).toEqual({
            name: "Fire Sages",
            types: ["Creature"],
            subtypes: ["Human", "Cleric"],
            manaCost: { X: 1, R: 1 },
            power: 2,
            toughness: 2,
            oracleText: FIRE_SAGES_TEXT,
            staticAbilities: ["firebending 1"],
            activatedAbilities: [
                {
                    id: "fire-sages-ability",
                    oracleText:
                        "{1}{R}{R}: Put a +1/+1 counter on this creature.",
                    cost: { mana: { X: 1, R: 2 } },
                    useStack: true,
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
            ],
        });
    });

    it("Mai and Zuko: `firebending 3` printed without reminder text", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Mai and Zuko",
                    manaCost: "{1}{U}{B}{R}",
                    typeLine: "Legendary Creature — Human Noble Ally",
                    power: "3",
                    toughness: "5",
                    oracleText: MAI_AND_ZUKO_TEXT,
                })
            )
        ).toEqual({
            name: "Mai and Zuko",
            types: ["Creature"],
            supertypes: ["Legendary"],
            subtypes: ["Human", "Noble", "Ally"],
            manaCost: { X: 1, U: 1, B: 1, R: 1 },
            power: 3,
            toughness: 5,
            oracleText: MAI_AND_ZUKO_TEXT,
            staticAbilities: ["firebending 3"],
            compiledStaticEffects: [
                {
                    kind: "cast-permission",
                    grantee: "controller",
                    filter: {
                        any: [{ subtype: ["Ally"] }, { type: ["Artifact"] }],
                    },
                    asThoughFlash: true,
                    oracleText:
                        "You may cast Ally spells and artifact spells as though they had flash.",
                    id: "controller-ally-48f48cb6",
                },
            ],
        });
    });

    it("reads each printed count (Avatar Roku's Firebending 4)", () => {
        const parsed = readLine("Firebending 4");
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "keywords")
            expect(parsed.value.keywords.map((k) => k.ability)).toEqual([
                "firebending 4",
            ]);
    });

    it.each([
        ["a zero count", "Firebending 0"],
        ["a variable count", "Firebending X, where X is this creature's power"],
        ["a cost where the count goes", "Firebending {1}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });
});
