// Full-path integration for the CR 508.1g / 701.43d optional attack cost,
// driven through the REGISTERED `game.ts` mutations (`toggleAttacker` →
// `toggleExert` → `confirmAttackers`) rather than a hand-called finalize.
//
// The GRE unit tests (`convex/gre/__tests__/exert.test.ts`) prove the primitive
// and the offer authority; the card test (`cards/sets/akh/__tests__/red.test.ts`)
// proves the linked trigger. Neither can prove the MUTATION path, which is
// where the choice is actually made — and where three things must agree that
// nothing else relates: the offer authority the toggle validates against, the
// declaration fold that can drop an attacker AFTER its cost was chosen, and the
// window closing at `combat.confirmed`.
//
// Same harness discipline as `combatDeclarationCap.test.ts`: a stub
// `MutationCtx` driving each registered mutation's own `_handler`.

import { describe, it, expect } from "vitest";
import { toggleAttacker, toggleExert, confirmAttackers } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { glorybringer } from "../cards/sets/akh/red";
import { grizzlyBears } from "../cards/sets/lea/green";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type SeatArgs = { gameId: Id<"games">; playerId: string };
type CardArgs = SeatArgs & { cardInstanceId: string };

const runToggleAttacker = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<CardArgs, void>(
        toggleAttacker as unknown as Handler<CardArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

const runToggleExert = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<CardArgs, void>(
        toggleExert as unknown as Handler<CardArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

const runConfirmAttackers = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<SeatArgs, void>(
        confirmAttackers as unknown as Handler<SeatArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

function declareAttackersState(): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(glorybringer.id, {
                        id: "glory",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: false,
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "bears",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: false,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "victim",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

describe("exert as an optional attack cost through the real mutations (CR 508.1g / 701.43d)", () => {
    it("toggles on, toggles off, and pays only what is still chosen at confirm", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState()),
        ]);

        await runToggleAttacker(h.ctx, "glory");
        await runToggleExert(h.ctx, "glory");
        expect(h.state().combat!.exertedIds).toEqual(["glory"]);

        // CR 508.1g — the choice is revisable until the declaration is locked.
        await runToggleExert(h.ctx, "glory");
        expect(h.state().combat!.exertedIds).toBeUndefined();

        await runToggleExert(h.ctx, "glory");
        await runConfirmAttackers(h.ctx);

        const after = h.state();
        const glory = after.players[0].battlefield.find(
            (c) => c.id === "glory"
        );
        expect(glory?.skipNextUntap).toBe(true);
        // CR 607.2h — the linked "when you do" trigger reached the stack, with
        // its only legal target locked in (CR 603.3d).
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].triggeredAbilityId).toBe(
            "glorybringer-exert-damage"
        );
    });

    it("refuses a creature that offers no exert (CR 701.43d — the offer is the static ability's)", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState()),
        ]);
        await runToggleAttacker(h.ctx, "bears");
        await expect(runToggleExert(h.ctx, "bears")).rejects.toThrow(
            /not a declared attacker you may exert/
        );
    });

    it("refuses a creature that is not declared as an attacker (CR 508.1g — 'the chosen creatures')", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState()),
        ]);
        await expect(runToggleExert(h.ctx, "glory")).rejects.toThrow(
            /not a declared attacker you may exert/
        );
    });

    it("drops the cost when the attacker is deselected (CR 508.1g — no cost for a non-attacker)", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState()),
        ]);
        await runToggleAttacker(h.ctx, "glory");
        await runToggleExert(h.ctx, "glory");
        await runToggleAttacker(h.ctx, "glory");
        expect(h.state().combat!.exertedIds).toBeUndefined();

        await runConfirmAttackers(h.ctx);
        const glory = h
            .state()
            .players[0].battlefield.find((c) => c.id === "glory");
        expect(glory?.skipNextUntap).toBeUndefined();
    });

    it("closes the window once the declaration is confirmed (CR 508.1g happens AS attackers are declared)", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState()),
        ]);
        await runToggleAttacker(h.ctx, "glory");
        await runConfirmAttackers(h.ctx);
        await expect(runToggleExert(h.ctx, "glory")).rejects.toThrow();
    });
});
