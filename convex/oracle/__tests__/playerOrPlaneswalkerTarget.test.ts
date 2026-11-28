// "target player or planeswalker" (CR 115.1 + CR 120.3): one announced target
// that is either a player or a planeswalker, `type: ["player",
// "Planeswalker"]` — the encoding every hand-written burn card carries
// (Witch Hunter, Lava Spike). Read by exact spelling in the shared target
// filter, so every slot routing there inherits it.
//
//  1. GOLDEN fixtures — the triggered slot the cluster names (Keldon
//     Champion) and the spell slot that inherits the rule (Lava Spike).
//  2. REFUSALS — a narrowed spelling the requirement has no facet for.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const PLAYER_OR_PLANESWALKER = { type: ["player", "Planeswalker"], count: 1 };

describe("target player or planeswalker — golden fixtures (CR 115.1, CR 120.3)", () => {
    it("triggered: Keldon Champion — it deals 3 damage to target player or planeswalker", () => {
        const text =
            "Haste\nEcho {2}{R}{R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nWhen this creature enters, it deals 3 damage to target player or planeswalker.";
        const card = oracleCard({
            oracleId: "1600b361-9298-49f0-8925-4c1aad363e1b",
            name: "Keldon Champion",
            manaCost: "{2}{R}{R}",
            typeLine: "Creature — Human Barbarian",
            oracleText: text,
            power: "3",
            toughness: "2",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Keldon Champion",
                types: ["Creature"],
                subtypes: ["Human", "Barbarian"],
                manaCost: { X: 2, R: 2 },
                power: 3,
                toughness: 2,
                oracleText: text,
                staticAbilities: ["haste"],
                compiledTriggeredAbilities: [
                    {
                        id: "keldon-champion-trigger",
                        oracleText:
                            "When this creature enters, it deals 3 damage to target player or planeswalker.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: PLAYER_OR_PLANESWALKER,
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 3,
                                to: { target: 0 },
                            },
                        ],
                    },
                ],
                echo: { X: 2, R: 2 },
            })
        );
    });

    it("spell: Lava Spike — deals 3 damage to target player or planeswalker", () => {
        const card = oracleCard({
            oracleId: "2837888c-bfa8-4955-9334-0605ad409f7e",
            name: "Lava Spike",
            manaCost: "{R}",
            typeLine: "Sorcery — Arcane",
            oracleText:
                "Lava Spike deals 3 damage to target player or planeswalker.",
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Lava Spike",
                types: ["Sorcery"],
                subtypes: ["Arcane"],
                manaCost: { R: 1 },
                oracleText:
                    "Lava Spike deals 3 damage to target player or planeswalker.",
                effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
                targetRequirement: PLAYER_OR_PLANESWALKER,
            })
        );
    });
});

describe("target player or planeswalker — refused neighbours stay unparsed", () => {
    it.each([
        [
            "a controller clause the requirement has no facet for",
            "{self} deals 3 damage to target player or planeswalker an opponent controls.",
        ],
        [
            "a planeswalker narrowed by colour",
            "{self} deals 3 damage to target player or red planeswalker.",
        ],
    ])("%s", (_label, text) => {
        const card = oracleCard({
            name: "Neighbour",
            manaCost: "{R}",
            typeLine: "Sorcery",
            oracleText: text.replace("{self}", "Neighbour"),
            power: undefined,
            toughness: undefined,
        });
        expect(compileCard(card).state).toBe("unparsed");
    });
});
