// Per-creature combat trigger firing — CR 508.3a ("Whenever [a creature]
// attacks" triggers for EACH creature declared as an attacker) and CR 509.3a
// ("Whenever [a creature] blocks" triggers only once each combat for that
// creature, even if it blocks multiple creatures). Issue #4151.
//
// The two rules are engine capabilities, not card branches, and they are
// tested at the two places the counting actually happens:
//
//   * ATTACKERS_DECLARED is BATCH-shaped (CR 508.1m — one event carrying every
//     attacker), so the fan-out lives in `collectTriggers`: a `perAttacker`
//     ability is offered one synthetic single-attacker event per declared
//     creature, and `$event.combatant` names that creature.
//   * BLOCKERS_CONFIRMED is PAIR-shaped, so the once-per-creature rule lives in
//     the emitter: `emitBlockersConfirmedEvents` emits one BLOCKER_DECLARED per
//     blocking creature, and a creature blocking two attackers still produces
//     one.
//
// Both go through the real `collectTriggers` and the real emitter rather than a
// hand-built event list, because what is being asserted IS how many events the
// engine makes and how many triggers come back.

import { describe, it, expect } from "vitest";
import {
    makeState,
    makePlayer,
    makeInstance,
} from "../../cards/__tests__/setup";
import { withTemporaryDefinition } from "../../cards/registry";
import { attacksTrigger } from "../../cards/abilities/triggers/attacksTrigger";
import { attacksOrBlocksTrigger } from "../../cards/abilities/triggers/attacksOrBlocksTrigger";
import { emitBlockersConfirmedEvents } from "../phases";
import { collectTriggers } from "../triggers";
import { resolveTopOfStack } from "../state";
import type { CardDefinition, EffectOp, GameEvent } from "../../cards/types";
import type { GameState } from "../state";

// A registered enchantment id, reused as the art anchor for the variants below
// (Fervent Charge's own printing — the card this capability was built for).
const HOST_CARD = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
// A registered vanilla creature, for the attackers and blockers.
const CREATURE_CARD = "55fe6449-1f23-43dc-adee-d144cd505b5c";

/** +2/+2 until end of turn on whichever creature the firing event named. */
const PUMP_THE_COMBATANT: EffectOp[] = [
    {
        op: "pump",
        target: { ref: "$event.combatant" },
        power: 2,
        toughness: 2,
        duration: { phase: "end-of-turn" },
    },
];

function hostDefinition(
    triggered: CardDefinition["triggeredAbilities"]
): CardDefinition {
    return {
        id: HOST_CARD,
        name: "Per-creature combat host",
        types: ["Enchantment"],
        rarity: "common",
        manaCost: { X: 1 },
        triggeredAbilities: triggered,
    };
}

/** p1 controls the host plus `attackerCount` creatures; p2 is the defender. */
function stateWithHost(attackerCount: number): {
    state: GameState;
    hostId: string;
    attackerIds: string[];
} {
    const host = makeInstance(HOST_CARD, { id: "host", controllerId: "p1" });
    const attackers = Array.from({ length: attackerCount }, (_, i) =>
        makeInstance(CREATURE_CARD, { id: `a${i + 1}`, controllerId: "p1" })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host, ...attackers] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, hostId: host.id, attackerIds: attackers.map((a) => a.id) };
}

const declaration = (attackerIds: string[]): GameEvent => ({
    type: "ATTACKERS_DECLARED",
    attackingPlayerId: "p1",
    attackerIds,
});

describe("per-attacker attack triggers (CR 508.3a)", () => {
    it("fires once per declared attacker, each naming its own creature", () => {
        const { state, attackerIds } = stateWithHost(2);
        const triggers = withTemporaryDefinition(
            hostDefinition([
                attacksTrigger({
                    id: "per-attacker",
                    oracleText:
                        "Whenever a creature you control attacks, it gets +2/+2 until end of turn.",
                    scope: "yours",
                    perAttacker: true,
                    effects: PUMP_THE_COMBATANT,
                }),
            ]),
            () => collectTriggers(state, [declaration(attackerIds)])
        );

        expect(triggers).toHaveLength(2);
        // Each firing carries a SYNTHETIC single-attacker declaration, which is
        // what makes `$event.combatant` resolvable to one creature.
        expect(
            triggers.map((t) =>
                t.triggerEvent?.type === "ATTACKERS_DECLARED"
                    ? t.triggerEvent.attackerIds
                    : null
            )
        ).toEqual([["a1"], ["a2"]]);
    });

    it("without the flag the same head fires ONCE for the whole batch", () => {
        const { state, attackerIds } = stateWithHost(2);
        const triggers = withTemporaryDefinition(
            hostDefinition([
                attacksTrigger({
                    id: "batch",
                    oracleText:
                        "Whenever one or more creatures you control attack, do a thing.",
                    scope: "yours",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 1 },
                    ],
                }),
            ]),
            () => collectTriggers(state, [declaration(attackerIds)])
        );

        expect(triggers).toHaveLength(1);
        expect(
            triggers[0]!.triggerEvent?.type === "ATTACKERS_DECLARED" &&
                triggers[0]!.triggerEvent.attackerIds
        ).toEqual(["a1", "a2"]);
    });

    it("scopes per attacker: an opponent's attack fires nothing", () => {
        const { state } = stateWithHost(1);
        const opponentAttacker = makeInstance(CREATURE_CARD, {
            id: "x1",
            controllerId: "p2",
        });
        state.players[1]!.battlefield.push(opponentAttacker);
        const triggers = withTemporaryDefinition(
            hostDefinition([
                attacksTrigger({
                    id: "per-attacker",
                    oracleText:
                        "Whenever a creature you control attacks, it gets +2/+2 until end of turn.",
                    scope: "yours",
                    perAttacker: true,
                    effects: PUMP_THE_COMBATANT,
                }),
            ]),
            () =>
                collectTriggers(state, [
                    {
                        type: "ATTACKERS_DECLARED",
                        attackingPlayerId: "p2",
                        attackerIds: ["x1"],
                    },
                ])
        );

        expect(triggers).toEqual([]);
    });
});

describe("per-blocker block triggers (CR 509.3a)", () => {
    /** p1 attacks with two creatures; p2's single blocker blocks both. */
    function multiBlockState(): GameState {
        const host = makeInstance(HOST_CARD, {
            id: "host",
            controllerId: "p1",
        });
        const a1 = makeInstance(CREATURE_CARD, {
            id: "a1",
            controllerId: "p1",
        });
        const a2 = makeInstance(CREATURE_CARD, {
            id: "a2",
            controllerId: "p1",
        });
        // Toughness 3, so 2 damage marks the creature instead of killing it
        // (CR 704.5g) — the assertion is WHICH creature was dealt damage.
        const blocker = makeInstance(CREATURE_CARD, {
            id: "b1",
            controllerId: "p2",
            power: 3,
            toughness: 3,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [host, a1, a2] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["a1", "a2"],
                confirmed: true,
                blockersConfirmed: true,
                blockerAssignments: { b1: ["a1", "a2"] },
            },
        });
    }

    it("a creature blocking TWO attackers triggers the ability once", () => {
        const state = multiBlockState();
        withTemporaryDefinition(
            hostDefinition([
                attacksOrBlocksTrigger({
                    id: "attacks-or-blocks",
                    oracleText:
                        "Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.",
                    scope: "any",
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { ref: "$event.combatant" },
                        },
                    ],
                }),
            ]),
            () => emitBlockersConfirmedEvents(state)
        );

        const fired = state.stack.filter(
            (item) => item.triggeredAbilityId === "attacks-or-blocks"
        );
        expect(fired).toHaveLength(1);
        expect(
            fired[0]!.triggerEvent?.type === "BLOCKER_DECLARED" &&
                fired[0]!.triggerEvent.blockerId
        ).toBe("b1");
    });

    it("resolves onto the BLOCKER the firing named, not the attackers", () => {
        const state = multiBlockState();
        withTemporaryDefinition(
            hostDefinition([
                attacksOrBlocksTrigger({
                    id: "attacks-or-blocks",
                    oracleText:
                        "Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.",
                    scope: "any",
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { ref: "$event.combatant" },
                        },
                    ],
                }),
            ]),
            () => {
                emitBlockersConfirmedEvents(state);
                // CR 608.2h — the whole point of the censused
                // `$event.combatant` row: the damage has to find the creature
                // this firing was FOR. A missing row leaves the ref
                // unresolvable and the Op silently does nothing.
                while (state.stack.length > 0) {
                    if (resolveTopOfStack(state) === null) break;
                }
            }
        );

        const damage = (id: string): number =>
            [
                ...state.players[0]!.battlefield,
                ...state.players[1]!.battlefield,
            ].find((c) => c.id === id)!.damageMarked ?? 0;
        expect(damage("b1")).toBe(2);
        expect(damage("a1")).toBe(0);
        expect(damage("a2")).toBe(0);
    });

    it("both halves of one Oracle line read the same censused field", () => {
        const ability = attacksOrBlocksTrigger({
            id: "attacks-or-blocks",
            oracleText: "Whenever a creature attacks or blocks, …",
            scope: "any",
            effects: [
                {
                    op: "dealDamage",
                    amount: 2,
                    to: { ref: "$event.combatant" },
                },
            ],
        });
        // CR 603.2 — ONE ability, two event types, never two abilities.
        expect(ability.event).toEqual([
            "ATTACKERS_DECLARED",
            "BLOCKER_DECLARED",
        ]);
        expect(ability.perAttacker).toBe(true);
    });
});
