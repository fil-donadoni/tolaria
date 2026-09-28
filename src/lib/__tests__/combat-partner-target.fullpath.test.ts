// Issue #4320 — Cromat's "destroy target creature blocking or blocked by
// Cromat", the FULL PATH in one test: GRE activation (`convex/game.ts`) → wire
// (`projectPublicState`) → the client's target highlight
// (`matchesPermanentTargetFilters`) → the accepted pick (`applyOneTargetSelection`).
//
// The filter reads the COMBAT, not the candidate alone, so the client can only
// agree with the server when the projected `combat` reaches the matcher: a
// highlight built without it lights nothing, and the ability the server offers
// is one the player can never click (`.claude/rules/gre-development.md`
// § Frontend wiring analysis). The GRE-only half lives in
// `convex/gre/__tests__/combatPartnerTarget.test.ts`.
import { describe, it, expect } from "vitest";
import { matchesPermanentTargetFilters } from "../card-utils";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { GameState } from "@convex/gre/state";
import { activateAbilityOnState, applyOneTargetSelection } from "@convex/game";

const CROMAT = "7d9e0a23-d2a8-40a6-9076-ed6fb539141b"; // Cromat, APC 94
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears
const DESTROY = "cromat-destroy-combat-partner";

/** p1's attacking Cromat, blocked by p2's `partner`; p2's `bystander` sits out
 *  of combat. */
function board(): GameState {
    return makeState({
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
}

describe("Cromat — combat-partner target, GRE → game.ts → wire → UI (issue #4320)", () => {
    it("highlights only the creature blocking Cromat, and the server accepts exactly that pick", () => {
        const state = board();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "cromat",
            abilityId: DESTROY,
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

        expect(glows("partner")).toBe(true);
        expect(glows("bystander")).toBe(false);

        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "partner",
        });
        expect(state.stack[state.stack.length - 1]?.targets).toEqual([
            { type: "permanent", id: "partner" },
        ]);
    });
});
