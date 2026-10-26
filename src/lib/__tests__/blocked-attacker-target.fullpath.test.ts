// General Jarkeld's "choose two target BLOCKED attacking creatures" (CR 509.1h),
// the FULL PATH in one test: GRE activation (`convex/game.ts`) → wire
// (`projectPublicState`) → the client's target highlight
// (`matchesPermanentTargetFilters`) → the accepted pick (`applyOneTargetSelection`).
//
// "Blocked" lives in `combat.blockedAttackerIds`, not on the candidate, so the
// client agrees with the server only when the projected `combat` carries it
// (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect } from "vitest";
import { matchesPermanentTargetFilters } from "../card-utils";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import { activateAbilityOnState, applyOneTargetSelection } from "@convex/game";

const JARKELD = "6a4f5a28-0bd2-4cc4-b67f-324e89193caa"; // General Jarkeld
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears
const REASSIGN = "general-jarkeld-reassign-blockers";

/** p2 attacks with `blocked`/`blocked2` (each blocked by a p1 creature) and `unblocked`;
 *  p1 holds an untapped Jarkeld. */
function board(): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p2",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: ["blocked", "blocked2", "unblocked"],
            confirmed: true,
            blockerAssignments: {
                blocker: ["blocked"],
                blocker2: ["blocked2"],
            },
            blockedAttackerIds: ["blocked", "blocked2"],
            blockersConfirmed: true,
            damageConfirmed: false,
        },
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(JARKELD, {
                        id: "jarkeld",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(BEARS, {
                        id: "blocker",
                        controllerId: "p1",
                        ownerId: "p1",
                        isBlocking: true,
                    }),
                    makeInstance(BEARS, {
                        id: "blocker2",
                        controllerId: "p1",
                        ownerId: "p1",
                        isBlocking: true,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(BEARS, {
                        id: "blocked",
                        controllerId: "p2",
                        ownerId: "p2",
                        isAttacking: true,
                    }),
                    makeInstance(BEARS, {
                        id: "blocked2",
                        controllerId: "p2",
                        ownerId: "p2",
                        isAttacking: true,
                    }),
                    makeInstance(BEARS, {
                        id: "unblocked",
                        controllerId: "p2",
                        ownerId: "p2",
                        isAttacking: true,
                    }),
                ],
            }),
        ],
    });
}

describe("General Jarkeld — blocked-attacker target, GRE → game.ts → wire → UI (CR 509.1h)", () => {
    it("highlights only the blocked attacker, and the server accepts exactly that pick", () => {
        const state = board();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "jarkeld",
            abilityId: REASSIGN,
        });

        const projected = projectPublicState(state, 1, "p1");
        const players = projected.players as unknown as Player[];
        const pendingTarget =
            projected.pendingTarget as unknown as PendingTarget;
        const combat = projected.combat!;
        const client = (id: string) =>
            players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === id) as unknown as CardInstance;
        const glows = (id: string) =>
            matchesPermanentTargetFilters(
                client(id),
                pendingTarget,
                players,
                "p1",
                undefined,
                undefined,
                combat
            );

        expect(glows("blocked")).toBe(true);
        expect(glows("blocked2")).toBe(true);
        expect(glows("unblocked")).toBe(false);

        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "blocked",
        });
        expect(state.pendingTarget?.selected).toEqual([
            { type: "permanent", id: "blocked" },
        ]);
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "unblocked",
            })
        ).toThrow();
    });
});
