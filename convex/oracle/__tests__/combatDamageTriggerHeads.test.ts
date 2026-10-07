// Combat and damage trigger heads — "whenever this creature is dealt damage",
// "…deals damage to a player", "…attacks and isn't blocked" (issue #4544,
// CR 120.3 / 508.3a / 509.1h / 603.2).
//
//  1. GOLDENS — every accepted form is a real corpus card, compiled whole and
//     compared with `sortKeys` equality. Jackal Pup (a `dealDamage` reading
//     "that much") is also a `GOLDEN_FIXTURES` row: the canned smoke scenario
//     cannot stage an `$event.amount`, so the fixture is what lets the form
//     reach `ready` (`goldenFixtures.test.ts` compares it whole).
//  2. REFUSALS — the neighbours the heads must NOT read: a receiver or dealer
//     the table does not carry, "that opponent" behind a head that names no
//     opponent, and the "unblocked" head on any subject but the source.
//
// The engine half (does the rebuilt ability FIRE on the right event?) is
// `gre/__tests__/compiledCombatDamageTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function abilitiesOf(
    card: ReturnType<typeof oracleCard>
): readonly CompiledTriggeredAbility[] {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.compiledTriggeredAbilities ?? [];
}

function creature(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{2}{B}",
        typeLine: "Creature — Beast",
        oracleText,
        power: "2",
        toughness: "2",
    });
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

describe("combat and damage trigger heads — goldens (issue #4544)", () => {
    it("Jackal Pup: 'is dealt damage' is the source as receiver; 'that much' is the damage dealt", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Jackal Pup",
                        "Whenever this creature is dealt damage, it deals that much damage to you."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "jackal-pup-trigger",
                    oracleText:
                        "Whenever this creature is dealt damage, it deals that much damage to you.",
                    head: { kind: "damage-taken", scope: "self" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { ref: "$event.amount" },
                            to: { player: "controller" },
                        },
                    ],
                },
            ])
        );
    });

    it("Wall of Hope: 'is dealt damage' reads 'you gain that much life'", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Wall of Hope",
                        "Whenever this creature is dealt damage, you gain that much life."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "wall-of-hope-trigger",
                    oracleText:
                        "Whenever this creature is dealt damage, you gain that much life.",
                    head: { kind: "damage-taken", scope: "self" },
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: { ref: "$event.amount" },
                        },
                    ],
                },
            ])
        );
    });

    it("Fungusaur: 'it' behind 'is dealt damage' is the source itself", () => {
        const [ability] = abilitiesOf(
            creature(
                "Fungusaur",
                "Whenever this creature is dealt damage, put a +1/+1 counter on it."
            )
        );
        expect(ability?.head).toEqual({ kind: "damage-taken", scope: "self" });
        expect(JSON.stringify(ability?.effects)).toContain('"$source"');
    });

    it("Abyssal Specter: 'deals damage to a player' names the damaged player, either one", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Abyssal Specter",
                        "Whenever this creature deals damage to a player, that player discards a card."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "abyssal-specter-trigger",
                    oracleText:
                        "Whenever this creature deals damage to a player, that player discards a card.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "player",
                    },
                    effects: [
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: { ref: "$event.damagedPlayer" },
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                            bind: "$discard1",
                        },
                        {
                            op: "discard",
                            player: { ref: "$event.damagedPlayer" },
                            cards: { ref: "$discard1" },
                        },
                    ],
                },
            ])
        );
    });

    it("Murk Dwellers: 'attacks and isn't blocked' fires on the unblocked attacker, 'it' is the source", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Murk Dwellers",
                        "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "murk-dwellers-trigger",
                    oracleText:
                        "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat.",
                    head: { kind: "attacks-unblocked" },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 2,
                            toughness: 0,
                            duration: { phase: "end-of-combat" },
                        },
                    ],
                },
            ])
        );
    });

    it("Merchant Ship: the unblocked head carries a plain life gain", () => {
        const [ability] = abilitiesOf(
            creature(
                "Merchant Ship",
                "Whenever this creature attacks and isn't blocked, you gain 2 life."
            )
        );
        expect(ability?.head).toEqual({ kind: "attacks-unblocked" });
        expect(ability?.effects).toEqual([
            { op: "gainLife", player: "controller", amount: 2 },
        ]);
    });
});

describe("combat and damage trigger heads — refusals (issue #4544)", () => {
    it("refuses 'is dealt combat damage': the table carries the unqualified head only", () => {
        expect(
            refused(
                creature(
                    "Test Wall",
                    "Whenever this creature is dealt combat damage, you gain 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that much' behind a head that carries no magnitude", () => {
        expect(
            refused(
                creature(
                    "Test Attacker",
                    "Whenever this creature attacks and isn't blocked, you gain that much life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that opponent' behind 'deals damage to a player': either player can be the one dealt damage", () => {
        expect(
            refused(
                creature(
                    "Test Specter",
                    "Whenever this creature deals damage to a player, that opponent discards a card."
                )
            )
        ).toBe(true);
    });

    it("refuses 'attacks and isn't blocked' on a subject other than the source", () => {
        expect(
            refused(
                creature(
                    "Test Captain",
                    "Whenever a creature you control attacks and isn't blocked, you gain 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'is dealt damage' on a subject other than the source", () => {
        expect(
            refused(
                creature(
                    "Test Captain",
                    "Whenever a creature you control is dealt damage, you gain 1 life."
                )
            )
        ).toBe(true);
    });
});
