// "Becomes the target of a spell or ability" trigger heads narrowed by WHO
// targets and WHAT is targeted (CR 603.2, CR 109.4, CR 115.1):
//
//   - "Whenever this creature becomes the target of a spell or ability you
//     control for the first time each turn" (the Valiant ability word, CR
//     207.2c) — the source, targeted by its controller's spell or ability,
//     once each turn (`maxTriggersPerTurn: 1`).
//   - "Whenever a creature you control becomes the target of a spell or
//     ability an opponent controls" — any creature its controller controls,
//     targeted by an opponent's spell or ability.
//
//  1. GOLDEN fixtures — a real corpus card per accepted form, compiled whole.
//  2. The compiled head reaches the ENGINE: registered, it fires on exactly the
//     targetings it names, and the Valiant cap holds for the rest of the turn.
//  3. REFUSALS — the printed neighbours the rule does not read stay unparsed.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import {
    emitBecameTargetEvents,
    processPendingActionTriggers,
} from "../../gre/state";
import type { GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const NETTLE_GUARD_TEXT =
    "Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, it gets +0/+2 until end of turn.\n{1}, Sacrifice this creature: Destroy target artifact or enchantment.";
const NETTLE_GUARD_TRIGGER =
    "Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, it gets +0/+2 until end of turn.";
const SHAPERS_SANCTUARY_TEXT =
    "Whenever a creature you control becomes the target of a spell or ability an opponent controls, you may draw a card.";

const nettleGuard = () =>
    oracleCard({
        name: "Nettle Guard",
        manaCost: "{1}{W}",
        typeLine: "Creature — Mouse Soldier",
        oracleText: NETTLE_GUARD_TEXT,
        power: "3",
        toughness: "1",
    });

const shapersSanctuary = () =>
    oracleCard({
        name: "Shapers' Sanctuary",
        manaCost: "{G}",
        typeLine: "Enchantment",
        oracleText: SHAPERS_SANCTUARY_TEXT,
        power: undefined,
        toughness: undefined,
    });

describe("becomes-target heads — goldens (CR 603.2, CR 109.4)", () => {
    it("reads the source targeted by its controller's spell or ability, the first time each turn (Nettle Guard)", () => {
        expect(sortKeys(compiled(nettleGuard()))).toEqual(
            sortKeys({
                name: "Nettle Guard",
                types: ["Creature"],
                subtypes: ["Mouse", "Soldier"],
                manaCost: { X: 1, W: 1 },
                power: 3,
                toughness: 1,
                oracleText: NETTLE_GUARD_TEXT,
                activatedAbilities: [
                    {
                        id: "nettle-guard-ability",
                        oracleText:
                            "{1}, Sacrifice this creature: Destroy target artifact or enchantment.",
                        cost: { mana: { X: 1 }, sacrifice: true },
                        useStack: true,
                        effects: [{ op: "destroy", target: { target: 0 } }],
                        targetRequirement: {
                            type: ["Artifact", "Enchantment"],
                            count: 1,
                        },
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "nettle-guard-trigger",
                        oracleText: NETTLE_GUARD_TRIGGER,
                        head: { kind: "became-target", by: "you" },
                        maxTriggersPerTurn: 1,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 0,
                                toughness: 2,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reads a creature you control targeted by an opponent's spell or ability (Shapers' Sanctuary)", () => {
        expect(sortKeys(compiled(shapersSanctuary()))).toEqual(
            sortKeys({
                name: "Shapers' Sanctuary",
                types: ["Enchantment"],
                manaCost: { G: 1 },
                oracleText: SHAPERS_SANCTUARY_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "shapers-sanctuary-trigger",
                        oracleText: SHAPERS_SANCTUARY_TEXT,
                        head: {
                            kind: "became-target",
                            scope: "yours",
                            by: "opponent",
                        },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Draw a card?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "draw",
                                        player: "controller",
                                        count: 1,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

/** Registers a compiled definition under a test id and returns that id. */
function register(definition: CompiledDefinition): string {
    const id = `test-becomes-target-${definition.name}`;
    registerTokenDefinition({
        id,
        rarity: "common",
        ...definition,
    } as unknown as CardDefinition);
    return id;
}

/** p1 controls `watcher` + a bear, p2 a bear; p1's turn. */
function board(watcherId: string): GameState {
    const bears = getCardByName("Grizzly Bears").id;
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(watcherId, {
                        id: "watcher",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(bears, {
                        id: "myBear",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(bears, {
                        id: "theirBear",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

/** `by` targets `permanentId` with a spell; returns how many triggers of
 *  the watcher went on the stack. */
function target(state: GameState, permanentId: string, by: string): number {
    const before = state.stack.length;
    emitBecameTargetEvents(
        state,
        [{ type: "permanent", id: permanentId }],
        by,
        `spell-${state.stack.length}-${permanentId}-${by}`,
        "spell"
    );
    processPendingActionTriggers(state);
    return state.stack
        .slice(before)
        .filter((item) => item.triggeredAbilityId !== undefined).length;
}

describe("a compiled becomes-target head fires in the engine (CR 603.2)", () => {
    it("the Valiant form: the controller's targeting fires it once each turn, an opponent's never", () => {
        const state = board(register(compiled(nettleGuard())));
        expect(target(state, "watcher", "p2")).toBe(0);
        expect(target(state, "myBear", "p1")).toBe(0);
        expect(target(state, "watcher", "p1")).toBe(1);
        expect(state.stack.at(-1)?.triggeredAbilityId).toBe(
            "nettle-guard-trigger"
        );
        expect(target(state, "watcher", "p1")).toBe(0);
    });

    it("the opponent form: an opponent targeting a creature you control fires it; your own targeting, their creature and a noncreature do not", () => {
        const state = board(register(compiled(shapersSanctuary())));
        expect(target(state, "myBear", "p1")).toBe(0);
        expect(target(state, "theirBear", "p2")).toBe(0);
        // The Sanctuary itself is a permanent you control, not a creature.
        expect(target(state, "watcher", "p2")).toBe(0);
        expect(target(state, "myBear", "p2")).toBe(1);
        expect(state.stack.at(-1)?.triggeredAbilityId).toBe(
            "shapers-sanctuary-trigger"
        );
        // No per-turn cap on this form: a second targeting fires again.
        expect(target(state, "myBear", "p2")).toBe(1);
    });
});

describe("becomes-target refusals — printed neighbours (ADR 0105 § 2)", () => {
    it.each([
        [
            "the first-time form with no controller named",
            "Whenever this creature becomes the target of a spell or ability for the first time each turn, put a +1/+1 counter on it.",
        ],
        [
            "the source targeted by an opponent's spell or ability",
            "Whenever this creature becomes the target of a spell or ability an opponent controls, draw a card.",
        ],
        [
            "another permanent you control",
            "Whenever another permanent you control becomes the target of a spell or ability an opponent controls, draw a card.",
        ],
        [
            "a creature you control with a counter on it",
            "Whenever a creature you control with a +1/+1 counter on it becomes the target of a spell or ability an opponent controls, draw a card.",
        ],
        [
            "a creature or planeswalker you control",
            "Whenever a creature or planeswalker you control becomes the target of a spell or ability an opponent controls, draw a card.",
        ],
        [
            '"that creature" behind the opponent form (no antecedent read)',
            "Whenever a creature you control becomes the target of a spell or ability an opponent controls, that creature gets +1/+1 until end of turn.",
        ],
        [
            '"it" behind the opponent form (the head names no one object)',
            "Whenever a creature you control becomes the target of a spell or ability an opponent controls, it gets +1/+1 until end of turn.",
        ],
        [
            "a first-time head beside a printed per-turn limit",
            "Whenever this creature becomes the target of a spell or ability you control for the first time each turn, draw a card. This ability triggers only once each turn.",
        ],
    ])("REFUSES %s", (_why, oracleText) => {
        expect(
            compileCard(oracleCard({ name: "Probe", oracleText })).state
        ).toBe("unparsed");
    });
});
