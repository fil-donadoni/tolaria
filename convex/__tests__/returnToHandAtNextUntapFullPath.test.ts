// Undiscovered Paradise, end to end — CR 605.1a / 605.3b / 502.3 / 106.4,
// issue #5509.
//
//   {T}: Add one mana of any color. During your next untap step, as you untap
//   your permanents, return this land to its owner's hand.
//
// The card is the COMPILED definition (no hand-written twin): its mana ability
// carries the stackless Effect Script `manaAbilityEffects:
// [returnToHandAtNextUntap $source]`. Driven through the real entry points —
// the registered `tapUntap` / `untapForPayment` / `cancelCast` mutation
// handlers and the exported `tapSourceIntoPayment` primitive — then the real
// turn loop (`advancePhase`) to the activator's next untap step.

import { describe, it, expect } from "vitest";
import {
    cancelActivation,
    cancelCast,
    tapSourceIntoPayment,
    tapUntap,
    untapForPayment,
} from "../game";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { advancePhase } from "../gre/phases";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const PARADISE = "paradise";
/** The first of the five colour options (`{W}`). */
const WHITE = 0;

type TapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (ctx: Parameters<typeof runMutation>[1], playerId = "p1") =>
    runMutation<TapArgs, void>(
        tapUntap as unknown as Handler<TapArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId,
            cardInstanceId: PARADISE,
            manaChoiceIndex: WHITE,
        }
    );

/** Undiscovered Paradise untapped on p1's battlefield, p1 active with priority
 *  in the main phase. `controller` = who controls it (its owner is p1). */
function board(controller: "p1" | "p2" = "p1"): GameState {
    const land = makeInstance(getCardByName("Undiscovered Paradise").id, {
        id: PARADISE,
        controllerId: controller,
        ownerId: "p1",
    });
    const p1 = makePlayer("p1", {
        battlefield: controller === "p1" ? [land] : [],
    });
    const p2 = makePlayer("p2", {
        battlefield: controller === "p2" ? [land] : [],
    });
    for (const p of [p1, p2])
        p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    return makeState({
        players: [p1, p2],
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        activePlayerId: controller,
        priorityPlayerId: controller,
    });
}

function paradiseOf(state: GameState) {
    for (const p of state.players) {
        const onField = p.battlefield.find((c) => c.id === PARADISE);
        if (onField) return { zone: "battlefield", player: p.id } as const;
        if (p.hand.some((c) => c.id === PARADISE))
            return { zone: "hand", player: p.id } as const;
    }
    return undefined;
}

/** Runs the turn loop until `playerId`'s NEXT untap step has run (the first
 *  later turn of theirs is in its upkeep), asserting the land stays put on
 *  every step before it. */
function playToNextUntapOf(state: GameState, playerId: string): void {
    const startTurn = state.turn;
    for (let i = 0; i < 64; i++) {
        advancePhase(state);
        if (state.activePlayerId === playerId && state.turn > startTurn) return;
        expect(paradiseOf(state)?.zone).toBe("battlefield");
    }
    throw new Error("never reached the next untap step");
}

describe("Undiscovered Paradise — priority tap (CR 605.1a / 605.3b / 502.3)", () => {
    it("adds the mana off the stack, keeps the land through both turns, and returns it at p1's next untap step", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(board())]);

        await runTapUntap(stub.ctx);

        const after = stub.state();
        expect(after.players[0]!.manaPool.W).toBe(1);
        // CR 605.3b — a mana ability never uses the stack.
        expect(after.stack).toEqual([]);
        const land = after.players[0]!.battlefield.find(
            (c) => c.id === PARADISE
        )!;
        expect(land.isTapped).toBe(true);
        expect(land.returnToHandAtUntapOf).toBe("p1");
        // Wire format — the projection keeps the land (and the mark is
        // server-side bookkeeping the client never needs to read).
        const view = projectPublicState(after, 1, "p1");
        expect(
            view.players[0]!.battlefield.some((c) => c.id === PARADISE)
        ).toBe(true);

        playToNextUntapOf(after, "p1");
        expect(paradiseOf(after)).toEqual({ zone: "hand", player: "p1" });
    });

    it("CR 106.4 — untapping it to refund the floating mana drops the pending return", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(board())]);

        await runTapUntap(stub.ctx);
        await runTapUntap(stub.ctx);

        const after = stub.state();
        expect(after.players[0]!.manaPool.W).toBe(0);
        const land = after.players[0]!.battlefield.find(
            (c) => c.id === PARADISE
        )!;
        expect(land.isTapped).toBe(false);
        expect(land.returnToHandAtUntapOf).toBeUndefined();
        playToNextUntapOf(after, "p1");
        expect(paradiseOf(after)?.zone).toBe("battlefield");
    });

    it("CR 502.3 — 'your' untap step is the ACTIVATOR's, the hand its OWNER's: p2 taps p1's stolen Paradise, p1's untap leaves it, p2's returns it to p1's hand", async () => {
        const stub = makeMutationCtx("p2", [gameStateSeed(board("p2"))]);

        await runTapUntap(stub.ctx, "p2");

        const after = stub.state();
        const land = after.players[1]!.battlefield.find(
            (c) => c.id === PARADISE
        )!;
        expect(land.returnToHandAtUntapOf).toBe("p2");
        // p1's untap step comes first — it must not consume p2's mark.
        playToNextUntapOf(after, "p1");
        expect(paradiseOf(after)).toEqual({
            zone: "battlefield",
            player: "p2",
        });
        playToNextUntapOf(after, "p2");
        expect(paradiseOf(after)).toEqual({ zone: "hand", player: "p1" });
    });
});

describe("Undiscovered Paradise — payment tap and its reversals (CR 605.3a / 106.4)", () => {
    function castPaymentState(): GameState {
        const state = board();
        const player = state.players[0]!;
        const land = player.battlefield[0]!;
        tapSourceIntoPayment(state, player, land, WHITE, []);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { W: 2 },
            tappedLandIds: [PARADISE],
        };
        return state;
    }

    it("tapping it to pay a cost arms the return", () => {
        const state = castPaymentState();
        expect(state.players[0]!.manaPool.W).toBe(1);
        expect(state.players[0]!.battlefield[0]!.returnToHandAtUntapOf).toBe(
            "p1"
        );
    });

    it("untapping the one land out of the payment drops it", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(castPaymentState())]);

        await runMutation<TapArgs, void>(
            untapForPayment as unknown as Handler<TapArgs, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1", cardInstanceId: PARADISE }
        );

        const land = stub.state().players[0]!.battlefield[0]!;
        expect(land.isTapped).toBe(false);
        expect(land.returnToHandAtUntapOf).toBeUndefined();
    });

    it("cancelling an ACTIVATION it paid for drops it (`untapSourceFromPayment`)", async () => {
        const state = board();
        const player = state.players[0]!;
        tapSourceIntoPayment(state, player, player.battlefield[0]!, WHITE, []);
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "artifact",
            abilityId: "artifact-ability",
            manaCost: { W: 2 },
            tappedLandIds: [PARADISE],
            tapSource: false,
            sacrificeSource: false,
        };
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            cancelActivation as unknown as Handler<
                { gameId: Id<"games">; playerId: string },
                void
            >,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );

        const land = stub.state().players[0]!.battlefield[0]!;
        expect(land.isTapped).toBe(false);
        expect(land.returnToHandAtUntapOf).toBeUndefined();
    });

    it("cancelling the whole cast drops it too", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(castPaymentState())]);

        await runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            cancelCast as unknown as Handler<
                { gameId: Id<"games">; playerId: string },
                void
            >,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );

        const land = stub.state().players[0]!.battlefield[0]!;
        expect(land.isTapped).toBe(false);
        expect(land.returnToHandAtUntapOf).toBeUndefined();
    });
});
