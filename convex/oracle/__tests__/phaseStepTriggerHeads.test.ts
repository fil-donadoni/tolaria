// Phase and step trigger heads — "at the beginning of the end step", "…of the
// upkeep of enchanted creature's controller", "…of each player's first main
// phase" (issue #4545, CR 500.1 / 505.1 / 303.4b / 603.2b).
//
//  1. GOLDENS — each accepted head is the trigger line of a real corpus card,
//     compiled and compared with `sortKeys` equality. Only that line is fed in
//     (the keyword / Aura lines beside it are other rules' business).
//  2. REFUSALS — the neighbours the heads must NOT read: the chosen player's
//     upkeep, the two-phase "each of your main phases", a host-controller
//     antecedent used behind a head that names no creature, and "that creature"
//     after an announced target (the nearer antecedent).
//
// The engine half (does the rebuilt ability FIRE on the right step?) is the
// `phaseTrigger` factory's own suite.

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

function aura(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{1}{B}",
        typeLine: "Enchantment — Aura",
        oracleText: `Enchant creature\n${oracleText}`,
    });
}

function enchantment(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{G}",
        typeLine: "Enchantment",
        oracleText,
    });
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

describe("phase and step trigger heads — goldens (issue #4545)", () => {
    it("Archwing Dragon: 'the end step' is EACH end step (CR 500.1)", () => {
        const text =
            "At the beginning of the end step, return this creature to its owner's hand.";
        expect(
            sortKeys(
                abilitiesOf(
                    oracleCard({
                        name: "Archwing Dragon",
                        manaCost: "{2}{R}{R}",
                        typeLine: "Creature — Dragon",
                        oracleText: text,
                        power: "4",
                        toughness: "4",
                    })
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "archwing-dragon-trigger",
                    oracleText: text,
                    head: { kind: "phase", phase: "END_STEP", scope: "each" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ])
        );
    });

    it("Soul Bleed: the host controller's upkeep; 'that player' is the active player", () => {
        const text =
            "At the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.";
        const [ability] = abilitiesOf(aura("Soul Bleed", text));
        expect(ability!.head).toEqual({
            kind: "phase",
            phase: "UPKEEP",
            scope: "host-controller",
        });
        expect(JSON.stringify(ability!.effects)).toContain(
            "$event.activePlayerId"
        );
    });

    it("Essence Flare: 'that creature' behind the host-controller head is the Aura's host", () => {
        const text =
            "At the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.";
        expect(
            sortKeys(abilitiesOf(aura("Essence Flare", text))[0]!.effects)
        ).toEqual(
            sortKeys([
                {
                    op: "counters",
                    action: "add",
                    counter: "-0/-1",
                    target: { ref: "$host" },
                    count: 1,
                },
            ])
        );
    });

    it("Eladamri's Vineyard: the first main phase is the precombat one (CR 505.1); the mana goes to the active player", () => {
        const text =
            "At the beginning of each player's first main phase, that player adds {G}{G}.";
        expect(
            sortKeys(abilitiesOf(enchantment("Eladamri's Vineyard", text)))
        ).toEqual(
            sortKeys([
                {
                    id: "eladamri-s-vineyard-trigger",
                    oracleText: text,
                    head: {
                        kind: "phase",
                        phase: "PRECOMBAT_MAIN",
                        scope: "each",
                    },
                    effects: [
                        {
                            op: "addMana",
                            mana: { G: 2 },
                            player: { ref: "$event.activePlayerId" },
                        },
                    ],
                },
            ])
        );
    });
});

describe("phase and step trigger heads — refusals (issue #4545)", () => {
    it("refuses 'the chosen player's upkeep' — no head scope reads the stored choice", () => {
        expect(
            refused(
                enchantment(
                    "Chosen Upkeep",
                    "At the beginning of the chosen player's upkeep, that player loses 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'each of your main phases' — one ability over two phases", () => {
        expect(
            refused(
                enchantment(
                    "Both Mains",
                    "At the beginning of each of your main phases, you gain 1 life."
                )
            )
        ).toBe(true);
    });

    it("refuses 'each player's second main phase' — only the first is a row", () => {
        expect(
            refused(
                enchantment(
                    "Second Main",
                    "At the beginning of each player's second main phase, that player adds {G}{G}."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that creature' behind a head that names no creature", () => {
        expect(
            refused(
                enchantment(
                    "Nameless Creature",
                    "At the beginning of your upkeep, put a -1/-1 counter on that creature."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that player adds' behind a head that names no player", () => {
        expect(
            refused(
                enchantment(
                    "Nameless Player",
                    "At the beginning of your upkeep, that player adds {G}{G}."
                )
            )
        ).toBe(true);
    });

    it("refuses 'that creature' after an announced target — the nearer antecedent (CR 608.2h)", () => {
        expect(
            refused(
                aura(
                    "Nearer Antecedent",
                    "At the beginning of the upkeep of enchanted creature's controller, destroy target artifact. Put a -1/-1 counter on that creature."
                )
            )
        ).toBe(true);
    });
});
