// "Until end of turn, you don't lose this mana as steps and phases end" after
// an "Add …" (CR 500.5 / 514.2): the mana-lifetime sentence of the effect
// clause, folded onto the `add-mana` in front of it and lowered to
// `addMana … persistsUntil: "end-of-turn"`.
//
//  1. GOLDEN fixtures — a real corpus row per accepted form, compiled to the
//     WHOLE Compiled Definition: fixed pips (Brazen Collector) and "one mana of
//     any color" (Qo'noS Quartermaster), whose lifetime rides on every mode.
//  2. REFUSALS — the neighbours stay `unparsed`, fail-closed (ADR 0105 § 2).
//
// The engine keeping the mana is `gre/__tests__/manaLifetimeEndOfTurn.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";

import { oracleCard } from "./oracle.fixture";

function compiledOf(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(
            `${card.name} did not reach ready: ${outcome.state} — ${JSON.stringify(
                outcome.state === "unparsed" ? outcome.gaps : outcome.reasons
            )}`
        );
    return outcome.definition;
}

const LIFETIME =
    "Until end of turn, you don't lose this mana as steps and phases end.";

describe("golden — the mana lifetime rides on the addMana it follows", () => {
    it("Brazen Collector (BLB) — fixed pips", () => {
        const oracleText = `First strike\nWhenever this creature attacks, add {R}. ${LIFETIME}`;
        const compiled = compiledOf(
            oracleCard({
                oracleId: "f93dc9cc-3dd2-4e2b-b972-217ab9d89dfe",
                name: "Brazen Collector",
                manaCost: "{1}{R}",
                typeLine: "Creature — Raccoon Rogue",
                oracleText,
                power: "2",
                toughness: "1",
            })
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Brazen Collector",
                types: ["Creature"],
                subtypes: ["Raccoon", "Rogue"],
                manaCost: { X: 1, R: 1 },
                power: 2,
                toughness: 1,
                oracleText,
                staticAbilities: ["first strike"],
                compiledTriggeredAbilities: [
                    {
                        id: "brazen-collector-trigger",
                        oracleText: `Whenever this creature attacks, add {R}. ${LIFETIME}`,
                        head: { kind: "attacks" },
                        effects: [
                            {
                                op: "addMana",
                                mana: { R: 1 },
                                persistsUntil: "end-of-turn",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Qo'noS Quartermaster — one mana of any color, the lifetime on every mode", () => {
        const oracleText = `Menace\nWhenever this creature attacks, add one mana of any color. ${LIFETIME}`;
        const compiled = compiledOf(
            oracleCard({
                oracleId: "b7115ed6-526c-491d-828f-f60b18437361",
                name: "Qo'noS Quartermaster",
                manaCost: "{1}{R}",
                typeLine: "Creature — Klingon Warrior",
                oracleText,
                power: "2",
                toughness: "2",
            })
        );
        const mode = (id: string, label: string) => ({
            id,
            label,
            color: id,
            effects: [
                {
                    op: "addMana",
                    mana: { [id]: 1 },
                    persistsUntil: "end-of-turn",
                },
            ],
        });
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Qo'noS Quartermaster",
                types: ["Creature"],
                subtypes: ["Klingon", "Warrior"],
                manaCost: { X: 1, R: 1 },
                power: 2,
                toughness: 2,
                oracleText,
                staticAbilities: ["menace"],
                compiledTriggeredAbilities: [
                    {
                        id: "qo-nos-quartermaster-trigger",
                        oracleText: `Whenever this creature attacks, add one mana of any color. ${LIFETIME}`,
                        head: { kind: "attacks" },
                        effects: [
                            {
                                op: "optionChoice",
                                prompt: "Qo'noS Quartermaster: add mana of which color?",
                                modes: [
                                    mode("W", "White"),
                                    mode("U", "Blue"),
                                    mode("B", "Black"),
                                    mode("R", "Red"),
                                    mode("G", "Green"),
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("refusals — the lifetime sentence extends only the add it can name", () => {
    function creature(oracleText: string): OracleCard {
        return oracleCard({
            name: "Test Lifetime",
            manaCost: "{1}{R}",
            typeLine: "Creature — Raccoon Rogue",
            oracleText,
        });
    }

    it.each([
        [
            "no Add in front of it",
            `Whenever this creature attacks, you gain 1 life. ${LIFETIME}`,
        ],
        [
            "a counted per-member deposit",
            `Whenever this creature attacks, add {R} for each creature you control. ${LIFETIME}`,
        ],
        [
            "the end-of-combat wording (firebending's expansion, not a printed sentence)",
            "Whenever this creature attacks, add {R}. Until end of combat, you don't lose this mana as steps and phases end.",
        ],
        [
            "a duration other than end of turn",
            "Whenever this creature attacks, add {R}. Until your next turn, you don't lose this mana as steps and phases end.",
        ],
    ])("%s stays unparsed", (_label, text) => {
        expect(compileCard(creature(text)).state).toBe("unparsed");
    });
});
