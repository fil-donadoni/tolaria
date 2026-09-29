// CR 509.1g — the Bot's side of "target creature blocking or blocked by
// {self}" (Cromat, issue #4320). `enumerateAbilityMoves` binds the requirement
// through the SAME `applySourceDirectives` the activation mutation uses, so the
// tuples the Bot enumerates are exactly the picks the server accepts: the
// source's combat partner, never a creature out of combat (a rejected target
// submission is an ADR 0047 freeze, not a retry).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves } from "../moves";

const CROMAT = "7d9e0a23-d2a8-40a6-9076-ed6fb539141b"; // Cromat, APC 94
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears
const DESTROY = "cromat-destroy-combat-partner";

describe("Cromat's combat-partner target in move enumeration (issue #4320)", () => {
    it("enumerates the blocker of Cromat and never a creature out of combat", () => {
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: ["cromat"],
                confirmed: true,
                blockerAssignments: { partner: ["cromat"] },
                blockersConfirmed: true,
                damageConfirmed: false,
            },
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(CROMAT, {
                            id: "cromat",
                            controllerId: "p1",
                            isAttacking: true,
                        }),
                    ],
                    manaPool: { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEARS, {
                            id: "partner",
                            controllerId: "p2",
                            ownerId: "p2",
                            isBlocking: true,
                        }),
                        makeInstance(BEARS, {
                            id: "bystander",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const targetIds = enumerateMoves(state, "p1")
            .filter(
                (m) => m.kind === "activate-ability" && m.abilityId === DESTROY
            )
            .flatMap((m) =>
                ((m as { targets?: { id: string }[] }).targets ?? []).map(
                    (t) => t.id
                )
            );
        expect(targetIds).toEqual(["partner"]);
    });
});
