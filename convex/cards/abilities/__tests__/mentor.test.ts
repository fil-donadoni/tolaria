// Mentor (CR 702.134) through the real paths: the `getDefinition` expansion, the
// trigger scan off an `ATTACKERS_DECLARED` event, trigger target selection, the
// CR 608.2b legality gate in `resolveTopOfStack`, and the wire projection the
// client's target filter reads.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../gre/rules";
import { checkStateBasedActions } from "../../../gre/sba";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../__tests__/setup.helper";
import { isNamedMechanic, MECHANICS_REGISTRY } from "../../mechanicsRegistry";
import { getDefinition, withTemporaryDefinition } from "../../registry";
import type { CardDefinition, GameEvent } from "../../types";
import { expandMentor } from "../mentor";

const creature = (
    id: string,
    power: number,
    staticAbilities: string[] = []
): CardDefinition => ({
    id,
    name: `Mentor Test ${id}`,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power,
    toughness: 5,
    staticAbilities,
});

const MENTOR = creature("mentor-test-source", 3, ["mentor"]);
const DOUBLE_MENTOR = creature("mentor-test-double", 3, ["mentor", "mentor"]);
const SMALL = creature("mentor-test-small", 2);
const SMALLER = creature("mentor-test-smaller", 1);
const EQUAL = creature("mentor-test-equal", 3);

function withDefinitions(body: () => void): void {
    const defs = [MENTOR, DOUBLE_MENTOR, SMALL, SMALLER, EQUAL];
    const nest = (i: number): void => {
        if (i === defs.length) body();
        else withTemporaryDefinition(defs[i], () => nest(i + 1));
    };
    nest(0);
}

function attacker(def: CardDefinition, id: string): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isAttacking: true,
    });
}

/** An attack declared by every given creature, its triggers on the stack and
 *  its targets raised — the production order. */
function declare(
    attackers: CardInstanceState[],
    bystanders: CardInstanceState[] = []
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [...attackers, ...bystanders] }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: attackers.map((a) => a.id),
    };
    placeTriggersOnStack(state, collectTriggers(state, [event]));
    raiseTriggerTargetSelection(state);
    return state;
}

const top = (state: GameState) => state.stack[state.stack.length - 1];

const counters = (state: GameState, id: string): number =>
    state.players[0].battlefield.find((c) => c.id === id)?.counters?.[
        "+1/+1"
    ] ?? 0;

describe("Mentor — Mechanics Registry (CR 702.134)", () => {
    it("the bare keyword resolves to an implemented row", () => {
        expect(isNamedMechanic("mentor")).toBe(true);
        const row = MECHANICS_REGISTRY.find((r) => r.id === "mentor");
        expect(row?.status).toBe("implemented");
    });
});

describe("Mentor — expansion (CR 702.134a, 702.134b)", () => {
    it("leaves a card without the keyword untouched", () => {
        expect(expandMentor(SMALL)).toBe(SMALL);
    });

    it("injects one trigger per instance, and never twice", () => {
        const once = expandMentor(DOUBLE_MENTOR);
        expect(once.triggeredAbilities).toHaveLength(2);
        expect(expandMentor(once)).toBe(once);
    });

    it("reaches a printed definition through the getDefinition seam", () => {
        withDefinitions(() => {
            const abilities = getDefinition(MENTOR.id).triggeredAbilities;
            expect(abilities?.map((t) => t.id)).toEqual(["mentor"]);
        });
    });
});

describe("Mentor — the target (CR 702.134a)", () => {
    it("offers only an attacking creature with lesser power", () => {
        withDefinitions(() => {
            const state = declare(
                [
                    attacker(MENTOR, "src"),
                    attacker(SMALL, "small"),
                    attacker(SMALLER, "smaller"),
                    attacker(EQUAL, "equal"),
                ],
                // Lesser power, but not attacking.
                [
                    makeInstance(SMALLER.id, {
                        id: "home",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ]
            );
            expect(state.pendingTarget?.kind).toBe("trigger");
            expect(state.pendingTarget?.powerFilter).toEqual({ max: 2 });
            expect(state.pendingTarget?.combatRoleFilter).toBe("attacking");
        });
    });

    it("reads the source's effective power, counters included", () => {
        withDefinitions(() => {
            const src = attacker(MENTOR, "src");
            src.counters = { "+1/+1": 1 };
            const state = declare([src, attacker(EQUAL, "equal")]);
            // 3 < 4: the lone legal target is auto-selected.
            expect(top(state)?.targets).toEqual([
                { type: "permanent", id: "equal" },
            ]);
        });
    });

    it("is removed from the stack with no legal target (CR 603.3d)", () => {
        withDefinitions(() => {
            const state = declare([
                attacker(MENTOR, "src"),
                attacker(EQUAL, "equal"),
            ]);
            expect(state.stack).toHaveLength(0);
            expect(state.pendingTarget).toBeUndefined();
        });
    });

    it("puts the counter on the target as it resolves", () => {
        withDefinitions(() => {
            const state = declare([
                attacker(MENTOR, "src"),
                attacker(SMALL, "small"),
            ]);
            resolveTopOfStack(state);
            expect(counters(state, "small")).toBe(1);
            expect(counters(state, "src")).toBe(0);
        });
    });
});

describe("Mentor — resolution (CR 608.2b)", () => {
    it("fizzles when the target's power has caught up in response", () => {
        withDefinitions(() => {
            const small = attacker(SMALL, "small");
            const state = declare([attacker(MENTOR, "src"), small]);
            small.counters = { "+1/+1": 1 }; // 3, no longer less than 3
            resolveTopOfStack(state);
            expect(counters(state, "small")).toBe(1);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("fizzles when the source's power has dropped in response", () => {
        withDefinitions(() => {
            const src = attacker(MENTOR, "src");
            const state = declare([src, attacker(SMALL, "small")]);
            src.counters = { "-1/-1": 1 }; // 2, target no longer lesser
            resolveTopOfStack(state);
            expect(counters(state, "small")).toBe(0);
        });
    });

    it("uses the source's last-known power once it has left", () => {
        withDefinitions(() => {
            const src = attacker(MENTOR, "src");
            src.counters = { "+1/+1": 1 }; // 4 as it leaves
            const state = declare([src, attacker(EQUAL, "equal")]);
            src.damageMarked = 6;
            checkStateBasedActions(state);
            expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
                "src",
            ]);
            expect(top(state)?.sourceLkiPower).toBe(4);
            // Read live, the gone source has no power and the 3-power target
            // fizzles. Its last-known 4 keeps the target legal.
            resolveTopOfStack(state);
            expect(counters(state, "equal")).toBe(1);
        });
    });
});

describe("Mentor — mentoring a creature (CR 702.134c)", () => {
    const WATCHER: CardDefinition = {
        ...creature("mentor-test-watcher", 1),
        triggeredAbilities: [
            {
                id: "watch-mentor",
                oracleText:
                    "Whenever this creature's controller's creature mentors a creature, put a +1/+1 counter on that creature.",
                event: "CREATURE_MENTORED",
                matches: (e, self) =>
                    e.type === "CREATURE_MENTORED" &&
                    e.controllerId === self.controllerId,
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { ref: "$event.mentoredId" },
                        count: 1,
                    },
                ],
            },
        ],
    };
    const watcher = (): CardInstanceState =>
        makeInstance(WATCHER.id, {
            id: "watcher",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });

    it("an ability listening for it triggers when mentor resolves", () => {
        withDefinitions(() => {
            withTemporaryDefinition(WATCHER, () => {
                const state = declare(
                    [attacker(MENTOR, "src"), attacker(SMALL, "small")],
                    [watcher()]
                );
                expect(state.stack).toHaveLength(1);
                resolveTopOfStack(state);
                const watching = top(state);
                expect(watching?.triggeredAbilityId).toBe("watch-mentor");
                expect(watching?.triggerEvent).toEqual({
                    type: "CREATURE_MENTORED",
                    mentorId: "src",
                    mentoredId: "small",
                    controllerId: "p1",
                });
                resolveTopOfStack(state);
                expect(counters(state, "small")).toBe(2);
            });
        });
    });

    it("nothing triggers when mentor fizzles", () => {
        withDefinitions(() => {
            withTemporaryDefinition(WATCHER, () => {
                const small = attacker(SMALL, "small");
                const state = declare(
                    [attacker(MENTOR, "src"), small],
                    [watcher()]
                );
                small.counters = { "+1/+1": 1 };
                resolveTopOfStack(state);
                expect(state.stack).toHaveLength(0);
            });
        });
    });
});

describe("Mentor — multiple instances (CR 702.134b)", () => {
    it("each instance triggers separately and picks without a prompt to order", () => {
        withDefinitions(() => {
            const state = declare([
                attacker(DOUBLE_MENTOR, "src"),
                attacker(SMALL, "small"),
            ]);
            expect(state.stack).toHaveLength(2);
            resolveTopOfStack(state);
            // Now 3: the second instance's target caught up with the source.
            resolveTopOfStack(state);
            expect(counters(state, "small")).toBe(1);
        });
    });
});

describe("Mentor — wire format", () => {
    it("carries the numeric bound the client's target filter reads", () => {
        withDefinitions(() => {
            const state = declare([
                attacker(MENTOR, "src"),
                attacker(SMALL, "small"),
                attacker(SMALLER, "smaller"),
            ]);
            const wire = projectPublicState(state, 1, "p1");
            expect(wire.pendingTarget?.powerFilter).toEqual({ max: 2 });
            expect(wire.pendingTarget?.combatRoleFilter).toBe("attacking");
        });
    });
});
