// AKH — red. One describe per card (ADR 0043); fixtures from
// `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { finalizeConfirmAttackers } from "../../../../game";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";
import { makeInstance, makeState } from "../../../__tests__/setup";

const GLORYBRINGER = "3277ad99-5682-4baa-b106-de15721876a6";
/** Grizzly Bears — 2/2 vanilla, the non-Dragon victim. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";
/** Shivan Dragon — a 5/5 DRAGON the opponent controls, an illegal target. */
const SHIVAN_DRAGON = "fefbf149-f988-4f8b-9f53-56f5878116a6";

/** Declares `dragon` as the sole attacker, optionally paying the CR 508.1g
 *  exert cost, and runs the same finalize the `confirmAttackers` mutation does. */
function attackWith(
    state: GameState,
    dragonId: string,
    opts: { exert: boolean }
): void {
    state.combat = {
        attackerIds: [dragonId],
        ...(opts.exert ? { exertedIds: [dragonId] } : {}),
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    finalizeConfirmAttackers(state);
}

describe("Glorybringer (CR 701.43d — exert as an optional attack cost)", () => {
    function setup() {
        const dragon = makeInstance(GLORYBRINGER, { id: "glory" });
        const victim = makeInstance(BEARS, { id: "bears", controllerId: "p2" });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].battlefield = [dragon];
        state.players[1].battlefield = [victim];
        return { state, dragon, victim };
    }

    it("declining the cost exerts nothing and puts no trigger on the stack (CR 508.1g — declining is legal)", () => {
        const { state, dragon } = setup();
        attackWith(state, dragon.id, { exert: false });

        expect(dragon.skipNextUntap).toBeUndefined();
        expect(dragon.isAttacking).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("paying it exerts the attacker and fires the LINKED trigger for 4 damage (CR 701.43a/d, 607.2h)", () => {
        const { state, dragon, victim } = setup();
        attackWith(state, dragon.id, { exert: true });

        // CR 701.43a — the cost is paid as attackers are declared.
        expect(dragon.skipNextUntap).toBe(true);
        expect(dragon.isTapped).toBe(true);

        // CR 603.3d — the trigger locked its only legal target at announcement.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "glorybringer-exert-damage"
        );
        expect(state.stack[0].targets?.[0]).toMatchObject({
            type: "permanent",
            id: victim.id,
        });

        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            victim.id
        );
    });

    it("cannot target a Dragon (CR 701.43d — 'target non-Dragon creature an opponent controls')", () => {
        const { state, dragon } = setup();
        state.players[1].battlefield = [
            makeInstance(SHIVAN_DRAGON, { id: "shivan", controllerId: "p2" }),
        ];
        attackWith(state, dragon.id, { exert: true });

        // CR 603.3c — a required target with no legal candidate removes the
        // trigger from the stack; the exert itself was still paid.
        expect(dragon.skipNextUntap).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("SURFACE — the exert choice survives the wire projection", () => {
        const { state, dragon } = setup();
        state.combat = {
            attackerIds: [dragon.id],
            exertedIds: [dragon.id],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.combat?.exertedIds).toEqual([dragon.id]);
    });
});
