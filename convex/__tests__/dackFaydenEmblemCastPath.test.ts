// Full-path integration for Dack Fayden's emblem (issues #2360 / #1571):
// GRE → `convex/game.ts` → `projectPublicState`.
//
// The per-card tests (`convex/cards/sets/cns/__tests__/multicolor.test.ts`)
// drive `emitBecameTargetEvents` directly, which proves the trigger but not the
// wiring: the emblem only ever fires in a real game because the CAST commit in
// `game.ts` reaches `emitSpellCastEvent` → `emitBecameTargetEvents(…, "spell")`
// → `processPendingActionTriggers`, all inside one mutation. Two pieces passing
// individually and failing together is exactly the bug class this file exists
// to catch, so it starts from a `pendingTarget` and calls the same
// `finalizeTargetSelection` the `selectTarget` mutation calls.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../game";
import { getCardByName } from "../cards";
import { DACK_FAYDEN_EMBLEM_ID } from "../cards/emblems";
import { resolveTopOfStack } from "../gre/state";
import type { GameState, PendingTarget } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const TWIDDLE = getCardByName("Twiddle").id;
const ORNITHOPTER = getCardByName("Ornithopter").id;

/** p1 holds Twiddle and Dack's emblem; p2 controls an Ornithopter. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(TWIDDLE, {
                        id: "twiddle1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(ORNITHOPTER, {
                        id: "thopter",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    state.emblems = [
        {
            id: "emblem-1",
            ownerId: "p1",
            emblemId: DACK_FAYDEN_EMBLEM_ID,
            name: "Dack Fayden emblem",
            text: "Whenever you cast a spell that targets one or more permanents, gain control of those permanents.",
        },
    ];
    return state;
}

describe("Dack Fayden emblem — full path through the cast commit (CR 601.2c)", () => {
    it("casting a targeted spell places the emblem trigger and the steal crosses the projection", () => {
        const state = board();
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "twiddle1",
            targetType: ["Artifact", "Creature", "Land"],
            count: 1,
            selected: [{ type: "permanent", id: "thopter" }],
        };
        state.pendingTarget = pt;

        // The REAL mutation body: pays the cost, pushes the spell, emits
        // SPELL_CAST + BECAME_TARGET and runs the trigger pass.
        finalizeTargetSelection(state, pt, "p1");

        // The spell is on the stack with its targets locked, and the emblem
        // trigger sits ABOVE it (CR 601.2c — cast triggers go on top and
        // resolve first).
        const spellItem = state.stack.find((s) => s.id === "twiddle1");
        expect(spellItem).toBeDefined();
        expect(spellItem!.targets).toEqual([
            { type: "permanent", id: "thopter" },
        ]);
        const triggers = state.stack.filter(
            (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
        );
        expect(triggers).toHaveLength(1);
        expect(state.stack[state.stack.length - 1].emblemSourceId).toBe(
            DACK_FAYDEN_EMBLEM_ID
        );

        resolveTopOfStack(state);

        // Engine state: control changed (CR 613.1b).
        expect(
            state.players[0].battlefield.some((c) => c.id === "thopter")
        ).toBe(true);
        expect(
            state.players[1].battlefield.some((c) => c.id === "thopter")
        ).toBe(false);

        // Wire format: the board the client renders agrees.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "thopter"
        );
        expect(slim).toBeDefined();
        expect(slim!.controllerId).toBe("p1");
        expect(slim!.ownerId).toBe("p2");
        expect(
            projected.players[1].battlefield.some((c) => c.id === "thopter")
        ).toBe(false);
    });
});
