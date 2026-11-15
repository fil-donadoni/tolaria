// "tapped" / "untapped" in a controls condition's descriptor — the tap-state
// vocabulary of the descriptor reader at the condition slot (CR 110.5,
// CR 603.4).
//
//  1. GOLDENS — one real corpus card per accepted form, compiled whole: the
//     zero count over "untapped" (Keldon Berserker) and over "tapped"
//     (Martyr's Soul), and the counted form (Frontline War-Rager).
//  2. REFUSALS — the neighbours that stay unread: a target or-list whose
//     tap state qualifies ONE alternative ("artifact or tapped creature"; the
//     `TargetRequirement` has no per-alternative tap filter), and the
//     singular controls clause, which no site opted into.
//  3. ENGINE — the gate the compiled condition becomes, against a raw game
//     state: `countControlledMatching` must read each permanent's live
//     `isTapped`, or every land reads as untapped.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import type { CardInstanceState } from "../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { conditionRule } from "../grammar/shared/condition";
import type { OracleCard } from "../types";
import { parseContext } from "./oracle.fixture";

function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition as CardDefinition;
}

const KELDON_BERSERKER: OracleCard = {
    oracleId: "7e0b9e67-3103-4299-934b-46d8fe96f553",
    name: "Keldon Berserker",
    manaCost: "{3}{R}",
    typeLine: "Creature — Human Soldier Berserker",
    oracleText:
        "Whenever this creature attacks, if you control no untapped lands, it gets +3/+0 until end of turn.",
    power: "2",
    toughness: "3",
    layout: "normal",
};

const MARTYRS_SOUL: OracleCard = {
    oracleId: "886382dc-5284-4b84-ad8c-8d8463d42fa0",
    name: "Martyr's Soul",
    manaCost: "{2}{W}",
    typeLine: "Creature — Spirit Soldier",
    oracleText:
        "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nWhen this creature enters, if you control no tapped lands, put two +1/+1 counters on it.",
    power: "3",
    toughness: "2",
    layout: "normal",
};

const FRONTLINE_WAR_RAGER: OracleCard = {
    oracleId: "610d006a-3ceb-4136-b92b-a500c74d06b0",
    name: "Frontline War-Rager",
    manaCost: "{2}{R}",
    typeLine: "Creature — Kavu Soldier",
    oracleText:
        "At the beginning of your end step, if you control two or more tapped creatures, put a +1/+1 counter on this creature.",
    power: "2",
    toughness: "3",
    layout: "normal",
};

describe("goldens — one corpus card per accepted form (CR 110.5, CR 603.4)", () => {
    it('Keldon Berserker — the zero count over "untapped"', () => {
        expect(sortKeys(compiled(KELDON_BERSERKER))).toEqual(
            sortKeys({
                name: "Keldon Berserker",
                types: ["Creature"],
                subtypes: ["Human", "Soldier", "Berserker"],
                manaCost: { X: 3, R: 1 },
                power: 2,
                toughness: 3,
                oracleText: KELDON_BERSERKER.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "keldon-berserker-trigger",
                        oracleText: KELDON_BERSERKER.oracleText,
                        head: { kind: "attacks" },
                        condition: {
                            kind: "controls",
                            player: "you",
                            filter: { types: ["Land"], tapped: false },
                            atMost: 0,
                        },
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 3,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Martyr\'s Soul — the zero count over "tapped"', () => {
        const trigger =
            "When this creature enters, if you control no tapped lands, put two +1/+1 counters on it.";
        expect(sortKeys(compiled(MARTYRS_SOUL))).toEqual(
            sortKeys({
                name: "Martyr's Soul",
                types: ["Creature"],
                subtypes: ["Spirit", "Soldier"],
                manaCost: { X: 2, W: 1 },
                power: 3,
                toughness: 2,
                oracleText: MARTYRS_SOUL.oracleText,
                staticAbilities: ["convoke"],
                compiledTriggeredAbilities: [
                    {
                        id: "martyr-s-soul-trigger",
                        oracleText: trigger,
                        head: { kind: "entered", scope: "self" },
                        condition: {
                            kind: "controls",
                            player: "you",
                            filter: { types: ["Land"], tapped: true },
                            atMost: 0,
                        },
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "+1/+1",
                                target: { ref: "$source" },
                                count: 2,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Frontline War-Rager — the counted form over "tapped"', () => {
        expect(sortKeys(compiled(FRONTLINE_WAR_RAGER))).toEqual(
            sortKeys({
                name: "Frontline War-Rager",
                types: ["Creature"],
                subtypes: ["Kavu", "Soldier"],
                manaCost: { X: 2, R: 1 },
                power: 2,
                toughness: 3,
                oracleText: FRONTLINE_WAR_RAGER.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "frontline-war-rager-trigger",
                        oracleText: FRONTLINE_WAR_RAGER.oracleText,
                        head: {
                            kind: "phase",
                            phase: "END_STEP",
                            scope: "your",
                        },
                        condition: {
                            kind: "controls",
                            filter: { types: ["Creature"], tapped: true },
                            atLeast: 2,
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
                ],
            })
        );
    });
});

describe("refused neighbours — fail-closed (ADR 0105 § 2)", () => {
    it.each([
        [
            "Radiant Strike",
            "{3}{W}",
            "Instant",
            "Destroy target artifact or tapped creature. You gain 3 life.",
        ],
        [
            "Banishing Slash",
            "{W}{W}",
            "Sorcery",
            "Destroy up to one target artifact, enchantment, or tapped creature. Then if you control an artifact and an enchantment, create a 2/2 white Samurai creature token with vigilance.",
        ],
    ])(
        "%s — a tap state on ONE alternative of a target or-list has no requirement shape",
        (name, manaCost, typeLine, oracleText) => {
            const outcome = compileCard({
                oracleId: "00000000-0000-0000-0000-000000000000",
                name,
                manaCost,
                typeLine,
                oracleText,
                layout: "normal",
            });
            expect(outcome.state).toBe("unparsed");
        }
    );

    it("the singular controls clause stays unread (no site opted in)", () => {
        expect(
            conditionRule.run(
                "if you control a tapped creature",
                parseContext()
            ).ok
        ).toBe(false);
    });
});

const card = (name: string) => getCardByName(name).id;

/**
 * The compiled gate of `source`'s first trigger, asked against a raw game
 * state where p1 controls the source plus `mine`.
 */
function gateOn(
    source: OracleCard,
    mine: readonly CardInstanceState[]
): boolean {
    const definition = {
        ...compiled(source),
        id: `compiled-${source.name.toLowerCase().replace(/[^a-z]+/g, "-")}-5283`,
        rarity: "common" as const,
    };
    return withTemporaryDefinition(definition, () => {
        const self = makeInstance(definition.id, { id: "source" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [self, ...mine] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const ability = resolveCompiledTrigger(
            definition.compiledTriggeredAbilities![0]!
        );
        const event =
            definition.compiledTriggeredAbilities![0]!.head.kind === "attacks"
                ? {
                      type: "ATTACKERS_DECLARED",
                      attackerIds: [self.id],
                      attackingPlayerId: "p1",
                  }
                : { type: "PHASE_BEGIN", phase: "END_STEP", playerId: "p1" };
        return ability.interveningIf!(
            event as never,
            self as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    });
}

function mine(name: string, isTapped: boolean): CardInstanceState {
    return makeInstance(card(name), { controllerId: "p1", isTapped });
}

describe("the gate reads the live tap status (CR 110.5, CR 603.4)", () => {
    it("no untapped lands: holds with every land tapped, fails on one untapped", () => {
        expect(gateOn(KELDON_BERSERKER, [])).toBe(true);
        expect(
            gateOn(KELDON_BERSERKER, [
                mine("Mountain", true),
                mine("Mountain", true),
            ])
        ).toBe(true);
        expect(
            gateOn(KELDON_BERSERKER, [
                mine("Mountain", true),
                mine("Mountain", false),
            ])
        ).toBe(false);
    });

    it("two or more tapped creatures: counts only the tapped ones", () => {
        const bears = (isTapped: boolean) => mine("Grizzly Bears", isTapped);
        expect(gateOn(FRONTLINE_WAR_RAGER, [bears(true), bears(true)])).toBe(
            true
        );
        expect(
            gateOn(FRONTLINE_WAR_RAGER, [
                bears(true),
                bears(false),
                bears(false),
            ])
        ).toBe(false);
    });
});
