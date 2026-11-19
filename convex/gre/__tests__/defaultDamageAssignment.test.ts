// The engine's pre-filled combat-damage split for a non-trample attacker
// blocked by two or more creatures (issue #9987).
//
// CR 510.1c: "If two or more creatures are blocking it, it assigns its combat
// damage to those creatures divided as its controller chooses among them." Any
// division is legal, so the seed is only the assigner modal's default: lethal
// damage to each live blocker in order while power lasts, any remainder on the
// last blocker assigned.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    dragonWhelp,
    earthElemental,
    hillGiant,
    monssGoblinRaiders,
} from "../../cards/sets/lea/red.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { CardInstanceState, GameState } from "../state";
import { buildDefaultDamageAssignments } from "../phases";

function permanent(
    defId: string,
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

/** p1's `attacker` blocked by every one of p2's `blockers`, in order; `gone`
 *  lists blocker ids still in `blockerAssignments` (ahead of the live ones) but
 *  off the battlefield. */
function combatDamage(
    attacker: CardInstanceState,
    blockers: CardInstanceState[],
    gone: string[] = []
): GameState {
    const blockerAssignments: Record<string, string[]> = {};
    for (const id of gone) blockerAssignments[id] = [attacker.id];
    for (const b of blockers) blockerAssignments[b.id] = [attacker.id];
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [{ ...attacker, isAttacking: true }],
            }),
            makePlayer("p2", {
                battlefield: blockers.map((b) => ({ ...b, isBlocking: true })),
            }),
        ],
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments,
            blockersConfirmed: true,
            blockedAttackerIds: [attacker.id],
            damageConfirmed: false,
            damageAssignments: {},
            damageAssignerIds: { [attacker.id]: "p1" },
            damageAssignmentConfirmedBy: [],
        },
    });
}

const seed = (state: GameState) =>
    buildDefaultDamageAssignments(state, "regular").atk;

describe("default combat-damage split, no trample (CR 510.1c)", () => {
    it("2 power into two 1/1s: 1 to each, both die", () => {
        const state = combatDamage(permanent(grizzlyBears().id, "atk", "p1"), [
            permanent(monssGoblinRaiders().id, "g1", "p2"),
            permanent(monssGoblinRaiders().id, "g2", "p2"),
        ]);
        expect(seed(state)).toEqual({ g1: 1, g2: 1 });
    });

    it("4 power into a 2/3 and a 1/1: lethal on each in order", () => {
        const state = combatDamage(
            permanent(earthElemental().id, "atk", "p1"),
            [
                permanent(dragonWhelp().id, "whelp", "p2"),
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
            ]
        );
        expect(seed(state)).toEqual({ whelp: 3, goblin: 1 });
    });

    it("power left after lethal on every blocker goes to the last one assigned", () => {
        const state = combatDamage(
            permanent(earthElemental().id, "atk", "p1"),
            [
                permanent(monssGoblinRaiders().id, "g1", "p2"),
                permanent(monssGoblinRaiders().id, "g2", "p2"),
            ]
        );
        expect(seed(state)).toEqual({ g1: 1, g2: 3 });
    });

    it("power short of lethal on the next blocker: what is left goes to it, later blockers get 0", () => {
        // 3 power into a 1/1, a 3/3 and a 1/1: lethal 1, then 2 of 3.
        const state = combatDamage(permanent(hillGiant().id, "atk", "p1"), [
            permanent(monssGoblinRaiders().id, "g1", "p2"),
            permanent(hillGiant().id, "giant", "p2"),
            permanent(monssGoblinRaiders().id, "g2", "p2"),
        ]);
        expect(seed(state)).toEqual({ g1: 1, giant: 2, g2: 0 });
    });

    it("a blocker gone from the battlefield is skipped, never seeded", () => {
        const state = combatDamage(
            permanent(earthElemental().id, "atk", "p1"),
            [
                permanent(monssGoblinRaiders().id, "g1", "p2"),
                permanent(monssGoblinRaiders().id, "g2", "p2"),
            ],
            ["dead"]
        );
        expect(seed(state)).toEqual({ g1: 1, g2: 3 });
    });
});
