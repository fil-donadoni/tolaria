// The becomes-prepared Verb Frame (CR 722.3a, issue #3689).
//
//  1. GOLDEN — a real corpus card compiled whole must produce exactly this
//     Compiled Definition (`sortKeys` equality). Smoke-scenario generation
//     covers the `becomePrepared` Op, so no `GOLDEN_FIXTURES` row is owed.
//  2. REFUSALS — the neighbours the frame does not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const ABUNDANCE_TEXT =
    "Vigilance\nThis creature enters prepared.\nWhenever this creature attacks, if you control eight or more lands, this creature becomes prepared.";

const EMERITUS_OF_ABUNDANCE: OracleCard = {
    oracleId: "e5152e8d-9f55-493d-a0fc-753cc72ee299",
    name: "Emeritus of Abundance // Regrowth",
    manaCost: "{2}{G} // {1}{G}",
    typeLine: "Creature — Elf Druid // Sorcery",
    oracleText: "",
    power: "3",
    toughness: "4",
    layout: "prepare",
    faces: [
        {
            name: "Emeritus of Abundance",
            manaCost: "{2}{G}",
            typeLine: "Creature — Elf Druid",
            oracleText: ABUNDANCE_TEXT,
            power: "3",
            toughness: "4",
        },
        {
            name: "Regrowth",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText: "Return target card from your graveyard to your hand.",
        },
    ],
};

describe("becomes-prepared frame — golden (CR 722.3a)", () => {
    it('Emeritus of Abundance: "this creature becomes prepared" acts on the trigger\'s own source, behind its intervening if (CR 603.4)', () => {
        const outcome = compileCard(EMERITUS_OF_ABUNDANCE);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Emeritus of Abundance",
                types: ["Creature"],
                subtypes: ["Elf", "Druid"],
                manaCost: { X: 2, G: 1 },
                power: 3,
                toughness: 4,
                oracleText: ABUNDANCE_TEXT,
                staticAbilities: ["vigilance"],
                compiledTriggeredAbilities: [
                    {
                        id: "emeritus-of-abundance-trigger",
                        oracleText:
                            "Whenever this creature attacks, if you control eight or more lands, this creature becomes prepared.",
                        head: { kind: "attacks" },
                        condition: {
                            kind: "controls",
                            filter: { types: ["Land"] },
                            atLeast: 8,
                        },
                        effects: [
                            {
                                op: "becomePrepared",
                                target: { ref: "$source" },
                            },
                        ],
                    },
                ],
                entersPrepared: true,
                insetSpell: {
                    kind: "prepare",
                    name: "Regrowth",
                    manaCost: { X: 1, G: 1 },
                    types: ["Sorcery"],
                    oracleText:
                        "Return target card from your graveyard to your hand.",
                    effects: [
                        { op: "moveZone", target: { target: 0 }, to: "hand" },
                    ],
                    targetRequirement: {
                        type: "card",
                        count: 1,
                        zone: "graveyard",
                        controller: "you",
                    },
                },
            })
        );
    });
});

describe("becomes-prepared frame — refusals", () => {
    it("refuses a subject that is not the card itself — no printed card prepares another permanent", () => {
        const outcome = compileCard(
            oracleCard({
                oracleText:
                    "When this creature enters, target creature becomes prepared.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a spell's own text — only a permanent becomes prepared (CR 722.3a)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Instant",
                oracleText: "Test Instant becomes prepared.",
                typeLine: "Instant",
                manaCost: "{G}",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
