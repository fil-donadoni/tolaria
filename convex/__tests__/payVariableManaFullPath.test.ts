// Full-path integration for the variable-amount mana payment (CR 107.3f, issue
// #1701): GRE -> game.ts -> wire projection, on the card that needs it.
//
//   107.3f  Sometimes X appears in the text of a spell or ability but not in a
//           mana cost, alternative cost, additional cost, or activation cost.
//           If the value of X isn't defined, the controller of the spell or
//           ability chooses the value of X at the appropriate time (either as
//           it's put on the stack or as it resolves).
//
// Decree of Justice's cycling trigger is the as-it-resolves half: the card was
// never cast, so the CR 107.3a announcement machinery (`chosenX`) was never
// travelled and the {X} is nominated as the trigger resolves, then paid.
//
// Everything runs through the REAL seams — `activateAbilityOnState` (the
// `activateAbility` mutation's own state function) for the cycling, the real
// `collectTriggers` / `resolveTopOfStack` for the trigger, the REGISTERED
// `submitNumberChoice` `_handler` over the stub `MutationCtx` for the answer,
// and `projectPublicState` for the surface assertion. A hand-built view would
// prove nothing about what the client actually receives.

import { describe, it, expect } from "vitest";
import { activateAbilityOnState, submitNumberChoice } from "../game";
import { decreeOfJustice } from "../cards/sets/scg/white";
import { resolveTopOfStack, numberChoiceRange } from "../gre/state";
import type { GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type NumberChoiceArgs = {
    gameId: Id<"games">;
    playerId: string;
    amount: number;
};

const runSubmitNumberChoice = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<NumberChoiceArgs, "gameId">
) =>
    runMutation<NumberChoiceArgs, void>(
        submitNumberChoice as unknown as Handler<NumberChoiceArgs, void>,
        ctx,
        { gameId: GAME_ID, ...args }
    );

/** Decree of Justice in p1's hand, with `pool` floating. The cycling cost
 *  ({2}{W}) comes out of the same pool as the nomination, exactly as it does
 *  in a real game. */
function boardWithDecree(pool: Record<string, number>): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(decreeOfJustice.id, {
                        id: "decree",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                manaPool: pool,
            }),
            makePlayer("p2"),
        ],
    });
}

/** Cycles the Decree and resolves down to the suspended nomination. */
function cycleAndSuspend(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "decree",
        abilityId: "cycling",
    });
    // The cycled trigger (CR 702.29c) sits above the cycling ability; resolving
    // it suspends on the nomination, so the loop stops there rather than
    // draining the stack.
    while (state.stack.length > 0 && !state.pendingChoices?.length) {
        if (resolveTopOfStack(state) === null && state.pendingChoices?.length) {
            break;
        }
    }
}

/** The Soldier tokens on p1's battlefield. Identified by their SUBTYPE, not by
 *  a `card.name`: a token instance carries a synthesized definition id, never a
 *  name field, so a name filter silently matches nothing and every assertion
 *  built on it passes vacuously. */
const soldiers = (state: GameState) =>
    state.players[0].battlefield.filter(
        (c) => c.isToken && c.subtypes?.includes("Soldier")
    );

describe("Decree of Justice's cycled {X} (CR 107.3f / 702.29c, issue #1701)", () => {
    it("suspends on a paying number-pick whose ceiling is the live pool, then creates that many Soldiers through the real mutation", async () => {
        // {2}{W} pays the cycling; {W}{W}{W} is left to nominate from.
        const state = boardWithDecree({ W: 4, C: 2 });
        cycleAndSuspend(state);

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("number-pick");
        expect(head.playerId).toBe("p1");
        expect(head.paysMana).toBe(true);
        // The ceiling is what is LEFT after the cycling cost, read through the
        // one authority the submit re-checks against.
        expect(numberChoiceRange(head, state.players[0])).toEqual({
            min: 0,
            max: 3,
        });

        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 3 });

        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        // CR 107.3f — the amount was PAID …
        expect(
            Object.values(after.players[0].manaPool).reduce((s, n) => s + n, 0)
        ).toBe(0);
        // … and the SAME amount is what the `createToken` count read.
        expect(soldiers(after)).toHaveLength(3);

        // SURFACE (the reducer, not a hand-built view): the tokens the client
        // is shown are 1/1 white Soldiers, and there are three of them.
        const projected = projectPublicState(after, 1, "p1");
        const wireSoldiers = projected.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Soldier")
        );
        expect(wireSoldiers).toHaveLength(3);
        expect(wireSoldiers[0]).toMatchObject({ power: 1, toughness: 1 });
    });

    it("nominating 0 is the decline — no mana spent, no Soldiers, no second prompt", async () => {
        const state = boardWithDecree({ W: 4, C: 2 });
        cycleAndSuspend(state);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 0 });

        const after = stub.state();
        // One action ended the decision: the queue is empty, not holding a
        // follow-up accept/decline question (Arena parity, issue #2244).
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(
            Object.values(after.players[0].manaPool).reduce((s, n) => s + n, 0)
        ).toBe(3);
        expect(soldiers(after)).toHaveLength(0);
        // The cycling itself still happened — the nomination belongs to the
        // TRIGGER, not to the cycling ability, which is still on the stack
        // below it waiting to draw (CR 702.29a/c).
        expect(after.players[0].graveyard.some((c) => c.id === "decree")).toBe(
            true
        );
        expect(after.stack).toHaveLength(1);
    });

    it("the mutation refuses an amount above the live pool, and the window stays answerable", async () => {
        const state = boardWithDecree({ W: 4, C: 2 });
        cycleAndSuspend(state);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 4 })
        ).rejects.toThrow(/between 0 and 3/);

        // Nothing was written, so the choice is still there to answer — a
        // rejected submission must never freeze the game (ADR 0047).
        const after = stub.state();
        expect(after.pendingChoices?.[0]?.kind).toBe("number-pick");
        await runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 2 });
        expect(soldiers(stub.state())).toHaveLength(2);
    });

    it("refuses the nomination from the seat that does not own the choice", async () => {
        const state = boardWithDecree({ W: 4, C: 2 });
        cycleAndSuspend(state);
        const stub = makeMutationCtx("p2", [gameStateSeed(state)]);

        await expect(
            runSubmitNumberChoice(stub.ctx, { playerId: "p2", amount: 3 })
        ).rejects.toThrow();
        expect(soldiers(stub.state())).toHaveLength(0);
    });
});
