// Distributed counters: "Distribute N <kind> counters among <count phrase>
// <targets>" (CR 601.2d / 122.1), and the delayed take-back "For each <kind>
// counter you put on a creature this way, remove a <kind> counter from that
// creature at the beginning of the next cleanup / end step" (CR 603.7a).
//
// Four layers:
//
//  1. GOLDEN fixtures — real corpus cards compiled whole, one per count phrase
//     and counter kind the corpus prints, at a spell and a triggered site, and
//     one per take-back timing.
//  2. REACHES READY — the smoke planner cannot scenario-ize the division or the
//     delayed body; the `distributed counters` rows in `grammar/fixtures.ts`
//     are what clear them.
//  3. REFUSALS — the neighbours the rule must not read (fail-closed).
//  4. ANNOUNCEMENT — a compiled trigger announces a capped, "counters"-kind
//     divide budget (the label the client's divide banner reads).

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards/catalogue";
import { raiseTriggerTargetSelection } from "../../gre/rules";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function spell(name: string, manaCost: string, typeLine: string, text: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText: text,
        typeLine,
        power: undefined,
        toughness: undefined,
    });
}

function creature(
    name: string,
    manaCost: string,
    typeLine: string,
    text: string,
    stats: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText: text,
        typeLine,
        power: stats,
        toughness: stats,
    });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const takeBack = (counter: string, step: "cleanup" | "end", bind: string) => ({
    op: "delayedTrigger",
    timing: step === "cleanup" ? "next-cleanup-step" : "next-end-step",
    oracleText: `For each ${counter} counter you put on a creature this way, remove a ${counter} counter from that creature at the beginning of the next ${step} step.`,
    capture: { $placed: { select: { set: "bound", ref: bind } } },
    effects: [
        {
            op: "forEach",
            select: { set: "bound", ref: "$placed" },
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter,
                    target: { ref: "$each" },
                    count: 1,
                },
            ],
        },
    ],
});

const BOUNTY =
    "You may exile a green card from your hand rather than pay this spell's mana cost.\nDistribute three +1/+1 counters among one, two, or three target creatures. For each +1/+1 counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next cleanup step.";
const SWARM =
    "When this creature dies, distribute three -1/-1 counters among one, two, or three target creatures. For each -1/-1 counter you put on a creature this way, remove a -1/-1 counter from that creature at the beginning of the next end step.";

describe("distributed counters — golden fixtures (CR 601.2d)", () => {
    it("spell · one or two target creatures (Elven Rite)", () => {
        const text =
            "Distribute two +1/+1 counters among one or two target creatures.";
        expect(
            sortKeys(compiled(spell("Elven Rite", "{1}{G}", "Sorcery", text)))
        ).toEqual(
            sortKeys({
                name: "Elven Rite",
                types: ["Sorcery"],
                manaCost: { X: 1, G: 1 },
                oracleText: text,
                effects: [
                    {
                        op: "distributeCountersAsChosen",
                        counter: "+1/+1",
                        total: 2,
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: { min: 1 },
                    divideAsChosen: { total: 2, kind: "counters" },
                },
            })
        );
    });

    it("spell · one, two, or three target creatures you control (Defend the Celestus)", () => {
        const text =
            "Distribute three +1/+1 counters among one, two, or three target creatures you control.";
        expect(
            sortKeys(
                compiled(
                    spell("Defend the Celestus", "{2}{G}{G}", "Instant", text)
                )
            )
        ).toEqual(
            sortKeys({
                name: "Defend the Celestus",
                types: ["Instant"],
                manaCost: { X: 2, G: 2 },
                oracleText: text,
                effects: [
                    {
                        op: "distributeCountersAsChosen",
                        counter: "+1/+1",
                        total: 3,
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    controller: "you",
                    count: { min: 1 },
                    divideAsChosen: { total: 3, kind: "counters" },
                },
            })
        );
    });

    it("spell · −1/−1 counters (Splendid Agony)", () => {
        const text =
            "Distribute two -1/-1 counters among one or two target creatures.";
        const definition = compiled(
            spell("Splendid Agony", "{2}{B}", "Instant", text)
        );
        expect(definition.effects).toEqual([
            { op: "distributeCountersAsChosen", counter: "-1/-1", total: 2 },
        ]);
        expect(definition.targetRequirement).toEqual({
            type: "Creature",
            count: { min: 1 },
            divideAsChosen: { total: 2, kind: "counters" },
        });
    });

    it("triggered · an enters head (Wurmskin Forger)", () => {
        const text =
            "When this creature enters, distribute three +1/+1 counters among one, two, or three target creatures.";
        const trigger = compiled(
            creature(
                "Wurmskin Forger",
                "{5}{G}{G}",
                "Creature — Elf Warrior",
                text,
                "2"
            )
        ).compiledTriggeredAbilities?.[0];
        expect(trigger?.targetRequirement).toEqual({
            type: "Creature",
            count: { min: 1 },
            divideAsChosen: { total: 3, kind: "counters" },
        });
        expect(trigger?.effects).toEqual([
            { op: "distributeCountersAsChosen", counter: "+1/+1", total: 3 },
        ]);
    });

    it("spell · the cleanup-step take-back of the counters put on this way (Bounty of the Hunt)", () => {
        const definition = compiled(
            spell("Bounty of the Hunt", "{3}{G}{G}", "Instant", BOUNTY)
        );
        expect(definition.effects).toEqual([
            {
                op: "distributeCountersAsChosen",
                counter: "+1/+1",
                total: 3,
                bind: "$placed1",
            },
            takeBack("+1/+1", "cleanup", "$placed1"),
        ]);
        expect(definition.targetRequirement).toEqual({
            type: "Creature",
            count: { min: 1 },
            divideAsChosen: { total: 3, kind: "counters" },
        });
    });

    it("triggered · the end-step take-back of −1/−1 counters (Shambling Swarm)", () => {
        const trigger = compiled(
            creature(
                "Shambling Swarm",
                "{1}{B}{B}{B}",
                "Creature — Horror",
                SWARM,
                "3"
            )
        ).compiledTriggeredAbilities?.[0];
        expect(trigger?.effects).toEqual([
            {
                op: "distributeCountersAsChosen",
                counter: "-1/-1",
                total: 3,
                bind: "$placed1",
            },
            takeBack("-1/-1", "end", "$placed1"),
        ]);
    });
});

describe("distributed counters — reaches ready", () => {
    it.each([
        [
            "spell, take-back",
            spell("Bounty of the Hunt", "{3}{G}{G}", "Instant", BOUNTY),
        ],
        [
            "spell",
            spell(
                "Elven Rite",
                "{1}{G}",
                "Sorcery",
                "Distribute two +1/+1 counters among one or two target creatures."
            ),
        ],
        [
            "spell, −1/−1",
            spell(
                "Splendid Agony",
                "{2}{B}",
                "Instant",
                "Distribute two -1/-1 counters among one or two target creatures."
            ),
        ],
        [
            "triggered, take-back",
            creature(
                "Shambling Swarm",
                "{1}{B}{B}{B}",
                "Creature — Horror",
                SWARM,
                "3"
            ),
        ],
    ])("%s", (_site, card) => {
        expect(compileCard(card).state).toBe("ready");
    });
});

describe("distributed counters — refused neighbours (fail-closed)", () => {
    const refuses = (text: string) =>
        expect(
            compileCard(spell("Refusal Probe", "{2}{G}", "Sorcery", text)).state
        ).toBe("unparsed");

    it("refuses an X budget — every corpus X is defined by a clause this rule does not read (Spoils of War)", () => {
        refuses(
            "Distribute X +1/+1 counters among any number of target creatures."
        );
    });

    it("refuses 'up to three' — not a divided count phrase (Ajani, Sleeper Agent)", () => {
        refuses(
            "Distribute three +1/+1 counters among up to three target creatures."
        );
    });

    it("refuses a ', then double …' tail (Biogenic Upgrade)", () => {
        refuses(
            "Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures."
        );
    });

    it("refuses an untargeted group (Invoke Justice's 'among any number of creatures')", () => {
        refuses(
            "Distribute four +1/+1 counters among any number of creatures you control."
        );
    });

    it("refuses a non-P/T counter kind — a stun or shield counter is another mechanic (CR 122.1)", () => {
        refuses(
            "Distribute three stun counters among one, two, or three target creatures."
        );
    });

    it("refuses a take-back naming a different counter kind", () => {
        refuses(
            "Distribute three +1/+1 counters among one, two, or three target creatures. For each +1/+1 counter you put on a creature this way, remove a -1/-1 counter from that creature at the beginning of the next cleanup step."
        );
    });

    it("refuses a take-back with no distribution before it — 'this way' names nothing", () => {
        refuses(
            "Put a +1/+1 counter on target creature. For each +1/+1 counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next cleanup step."
        );
    });
});

describe("distributed counters — a compiled TRIGGER announces a counters budget (CR 601.2d)", () => {
    // A DIES head: `diedTrigger` must forward the compiled requirement, or the
    // trigger goes on the stack announcing nothing (CR 603.3d).
    it('Shambling Swarm: count {min 1, max 3}, divideKind "counters"', () => {
        const definition = {
            ...compiled(
                creature(
                    "Shambling Swarm",
                    "{1}{B}{B}{B}",
                    "Creature — Horror",
                    SWARM,
                    "3"
                )
            ),
            id: "test-distributed-counters-swarm",
            rarity: "common",
        } as unknown as CardDefinition;
        withTemporaryDefinition(definition, () => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [1, 2, 3, 4].map((n) =>
                            makeInstance(getCardByName("Serra Angel").id, {
                                controllerId: "p2",
                                ownerId: "p2",
                                id: `angel${n}`,
                            })
                        ),
                    }),
                ],
            });
            const source = makeInstance(definition.id, {
                id: "source",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.stack.push({
                ...source,
                zone: "stack",
                castById: "p1",
                triggeredAbilityId:
                    definition.compiledTriggeredAbilities?.[0]?.id,
                triggerSourceId: source.id,
                targets: undefined,
            } as never);
            raiseTriggerTargetSelection(state);
            expect(state.pendingTarget?.count).toEqual({ min: 1, max: 3 });
            expect(state.pendingTarget?.divideTotal).toBe(3);
            expect(state.pendingTarget?.divideKind).toBe("counters");
        });
    });
});
