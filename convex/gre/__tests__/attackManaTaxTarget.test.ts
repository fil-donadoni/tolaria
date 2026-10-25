// attack-mana-tax is directed at the player, not their planeswalkers/battles
// (CR 508.1h cost to attack, CR 506.2 what may be attacked): "pays {N} for each
// creature they control that's attacking you" never charges a creature
// attacking a planeswalker.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { collectAttackManaTax } from "../combat";

const collectiveRestraint = getDefinition(
    "d71daa57-ac02-4dd9-8c90-d38bdd45fb51"
);
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

describe("collectAttackManaTax — attack target (CR 508.1h / 506.2)", () => {
    it("charges only the attacker aimed at the player, not the one aimed at a planeswalker", () => {
        const atkPlayer = makeInstance(grizzlyBears.id, {
            id: "atk-player",
            controllerId: "p1",
            isAttacking: true,
        });
        const atkWalker = makeInstance(grizzlyBears.id, {
            id: "atk-walker",
            controllerId: "p1",
            isAttacking: true,
        });
        const restraint = makeInstance(collectiveRestraint.id, {
            id: "restraint",
            controllerId: "p2",
        });
        const walker = makeInstance(grizzlyBears.id, {
            id: "walker",
            controllerId: "p2",
            types: ["Planeswalker"],
            counters: { loyalty: 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [atkPlayer, atkWalker] }),
                makePlayer("p2", { battlefield: [restraint, walker] }),
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: ["atk-player", "atk-walker"],
                blockerAssignments: {},
                attackTargets: { "atk-walker": "walker" },
                confirmed: false,
                blockersConfirmed: false,
            },
        });
        expect(collectAttackManaTax(state)).toHaveLength(1);
    });
});
