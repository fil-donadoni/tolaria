// Full path for Provoke (CR 702.39a): GRE (the attack trigger announces its target
// and resolves) → `game.ts` (the REGISTERED `confirmBlockers` mutation folds the
// requirement into the declaration) → the client's view (`projectPublicState`).
//
// Same harness discipline as `mustBlockAttackerPath.test.ts`.

import { describe, it, expect } from "vitest";
import { confirmBlockers } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import type { CardDefinition } from "../cards/types";
import { projectPublicState } from "../gameProjections";
import { applyMayPaySubmit } from "../gre/pendingChoiceSubmit";
import { emitAttackersDeclaredEvents } from "../gre/phases";
import { resolveTopOfStack, type GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

const PROVOKER: CardDefinition = {
    id: "test-only-provoker",
    rarity: "common",
    name: "Test Provoker",
    oracleText: "Provoke",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    staticAbilities: ["provoke"],
};

const runConfirmBlockers = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<{ gameId: Id<"games">; playerId: string }, void>(
        confirmBlockers as unknown as Handler<
            { gameId: Id<"games">; playerId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p2" }
    );

/** p1 attacks with a provoker; p2's lone creature is tapped. */
function declaredAttack(): GameState {
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(PROVOKER.id, {
                        id: "atk",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: false,
                        isAttacking: true,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "blk",
                        controllerId: "p2",
                        ownerId: "p2",
                        isSummoningSick: false,
                        isTapped: true,
                    }),
                ],
            }),
        ],
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    emitAttackersDeclaredEvents(state);
    return state;
}

function resolveInto(state: GameState, accept: boolean): void {
    resolveTopOfStack(state);
    applyMayPaySubmit(state, { playerId: "p1", accept });
    state.phase = "DECLARE_BLOCKERS";
    state.priorityPlayerId = "p2";
}

describe("Provoke through the real mutation (CR 702.39a)", () => {
    it("accepted: confirmBlockers folds the block and the client shows it, untapped", async () => {
        await withTemporaryDefinitionAsync(PROVOKER, async () => {
            const state = declaredAttack();
            resolveInto(state, true);
            const h = makeMutationCtx("p2", [gameStateSeed(state)]);
            await runConfirmBlockers(h.ctx);
            const saved = h.state();
            expect(saved.combat!.blockerAssignments).toEqual({ blk: ["atk"] });
            for (const viewer of ["p1", "p2"]) {
                const view = projectPublicState(saved, 2, viewer);
                expect(view.combat?.blockerAssignments).toEqual({
                    blk: ["atk"],
                });
            }
        });
    });

    it("declined: the tapped creature declares nothing", async () => {
        await withTemporaryDefinitionAsync(PROVOKER, async () => {
            const state = declaredAttack();
            resolveInto(state, false);
            const h = makeMutationCtx("p2", [gameStateSeed(state)]);
            await runConfirmBlockers(h.ctx);
            expect(h.state().combat!.blockerAssignments).toEqual({});
        });
    });
});
