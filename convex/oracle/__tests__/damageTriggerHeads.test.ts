// Damage trigger heads — "whenever [this / enchanted] creature deals damage
// [to an opponent / to a creature]" and "whenever enchanted creature is dealt
// damage", with the two back-references a damage head gives its body: "that
// much" (the damage dealt) and "that player" / "that opponent" (the damaged
// player) (issue #4131, CR 120.3 / 303.4b / 603.2).
//
//  1. GOLDENS — every accepted form is a real corpus card, compiled whole and
//     compared with `sortKeys` equality. The three whose scripts the canned
//     smoke scenario cannot stage (Hypnotic Specter, Fungal Shambler, Spirit
//     Link) are `GOLDEN_FIXTURES` rows, compared whole by
//     `goldenFixtures.test.ts`; `triggerAnaphora.test.ts` requires each to
//     reach `ready`.
//  2. REFUSALS — the neighbours the rules must NOT read: a recipient the table
//     does not carry, an Aura head on a recipient it has no row for, "that
//     much" behind a head that carries no magnitude, "that opponent" behind a
//     head that names no opponent, and a conjunction other than the printed
//     pair.
//
// The engine half (does the rebuilt ability FIRE on the right damage and read
// the right number?) is `gre/__tests__/compiledDamageTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

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

function aura(name: string, lines: string) {
    return oracleCard({
        name,
        manaCost: "{1}{W}",
        typeLine: "Enchantment — Aura",
        oracleText: `Enchant creature\n${lines}`,
        power: undefined,
        toughness: undefined,
    });
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

/** The Effect Script of "you gain that much life": one `gainLife` reading the
 *  firing event's numeric `amount` field. */
const GAIN_THAT_MUCH = [
    {
        op: "gainLife",
        player: "controller",
        amount: { ref: "$event.amount" },
    },
];

describe("damage trigger heads — goldens (issue #4131)", () => {
    it("Thieving Magpie: 'deals damage to an opponent' is damage to a player who is not the controller", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Thieving Magpie",
                        "Whenever this creature deals damage to an opponent, draw a card."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "thieving-magpie-trigger",
                    oracleText:
                        "Whenever this creature deals damage to an opponent, draw a card.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "opponent",
                    },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ])
        );
    });

    it("Wei Night Raiders: 'that player' is the damaged player — the choice is raised for THEM", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Wei Night Raiders",
                        "Whenever this creature deals damage to an opponent, that player discards a card."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "wei-night-raiders-trigger",
                    oracleText:
                        "Whenever this creature deals damage to an opponent, that player discards a card.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "opponent",
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

    it("Spiritmonger: 'deals damage to a creature' names a creature recipient, no player", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Spiritmonger",
                        "Whenever this creature deals damage to a creature, put a +1/+1 counter on this creature."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "spiritmonger-trigger",
                    oracleText:
                        "Whenever this creature deals damage to a creature, put a +1/+1 counter on this creature.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "creature",
                    },
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
            ])
        );
    });

    it("Zebra Unicorn: 'deals damage' names no recipient, and 'that much' is the damage dealt", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    creature(
                        "Zebra Unicorn",
                        "Whenever this creature deals damage, you gain that much life."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "zebra-unicorn-trigger",
                    oracleText:
                        "Whenever this creature deals damage, you gain that much life.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "any",
                    },
                    effects: GAIN_THAT_MUCH,
                },
            ])
        );
    });

    it("Soul Link: 'enchanted creature deals damage' and 'is dealt damage' are the Aura's HOST, one ability each", () => {
        expect(
            sortKeys(
                abilitiesOf(
                    aura(
                        "Soul Link",
                        "Whenever enchanted creature deals damage, you gain that much life.\nWhenever enchanted creature is dealt damage, you gain that much life."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "soul-link-trigger",
                    oracleText:
                        "Whenever enchanted creature deals damage, you gain that much life.",
                    head: {
                        kind: "damage-dealt",
                        source: "host",
                        recipient: "any",
                    },
                    effects: GAIN_THAT_MUCH,
                },
                {
                    id: "soul-link-trigger-2",
                    oracleText:
                        "Whenever enchanted creature is dealt damage, you gain that much life.",
                    head: { kind: "damage-taken", scope: "host" },
                    effects: GAIN_THAT_MUCH,
                },
            ])
        );
    });

    it("'you lose that much life' reads the same amount — the life sentence, not one card's phrase", () => {
        const [ability] = abilitiesOf(
            creature(
                "Test Loser",
                "Whenever this creature deals damage, you lose that much life."
            )
        );
        expect(sortKeys(ability!.effects)).toEqual(
            sortKeys([
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$event.amount" },
                },
            ])
        );
    });
});

describe("damage trigger heads — refusals (fail-closed, ADR 0105)", () => {
    it("refuses a recipient the head table does not carry", () => {
        expect(
            refused(
                creature(
                    "Test A",
                    "Whenever this creature deals damage to a player, draw a card."
                )
            )
        ).toBe(true);
        expect(
            refused(
                creature(
                    "Test B",
                    "Whenever this creature deals damage to a creature or opponent, draw a card."
                )
            )
        ).toBe(true);
    });

    it("refuses an Aura head on a recipient it has no row for", () => {
        expect(
            refused(
                aura(
                    "Test C",
                    "Whenever enchanted creature deals damage to an opponent, you gain 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'this creature is dealt damage' — only the Aura host's row exists", () => {
        expect(
            refused(
                creature(
                    "Test D",
                    "Whenever this creature is dealt damage, you gain 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that much' behind a head whose event carries no magnitude", () => {
        for (const head of [
            "Whenever this creature attacks",
            "Whenever this creature deals combat damage to a player",
            "When this creature dies",
            "At the beginning of your upkeep",
        ]) {
            expect(
                refused(
                    creature("Test E", `${head}, you gain that much life.`)
                ),
                head
            ).toBe(true);
        }
    });

    it("refuses 'that much' at a spell site", () => {
        expect(
            refused(
                oracleCard({
                    name: "Test F",
                    manaCost: "{1}{W}",
                    typeLine: "Instant",
                    oracleText: "You gain that much life.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it("refuses 'that many' — only the life sentence reads a back-referenced amount", () => {
        expect(
            refused(
                creature(
                    "Test G",
                    "Whenever this creature deals damage, draw that many cards."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that player' behind heads whose recipient may be a creature", () => {
        // "deals damage" and "deals damage to a creature" name no PLAYER, so
        // "that player" has nobody to be — binding the head's controller or a
        // guess is the defect ADR 0105 exists to prevent.
        for (const head of [
            "Whenever this creature deals damage",
            "Whenever this creature deals damage to a creature",
        ]) {
            expect(
                refused(
                    creature(
                        "Test M",
                        `${head}, that player discards a card at random.`
                    )
                ),
                head
            ).toBe(true);
        }
    });

    it("refuses 'that opponent' behind a head that names no opponent", () => {
        expect(
            refused(
                creature(
                    "Test H",
                    "Whenever this creature deals damage, that opponent discards a card."
                )
            )
        ).toBe(true);
        expect(
            refused(
                creature(
                    "Test I",
                    "Whenever this creature deals combat damage to a player, that opponent discards a card."
                )
            )
        ).toBe(true);
        expect(
            refused(
                oracleCard({
                    name: "Test J",
                    manaCost: "{1}{B}",
                    typeLine: "Enchantment",
                    oracleText:
                        "At the beginning of each player's upkeep, that opponent discards a card.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it("keeps the draw-and-discard conjunction pinned to the printed pair", () => {
        const head = "Whenever this creature deals damage to an opponent, ";
        for (const body of [
            "you draw a card and that player discards a card.",
            "you draw a card and target opponent discards a card.",
            "you gain 1 life and that opponent discards a card.",
            "you draw a card and that opponent loses 1 life.",
        ]) {
            expect(refused(creature("Test K", head + body)), body).toBe(true);
        }
    });
});
