// Integration test for the `tapUntap` untap-refund bug found in the issue
// #1559 (Delighted Halfling) PR review: `getActivatedManaAbility` returns
// only the FIRST matching mana ability on a card
// (`convex/gre/constants.ts`), but Delighted Halfling has TWO distinct mana
// abilities — a plain `{T}: Add {C}.` (found first) and a SEPARATE,
// restricted `{T}: Add one mana of any color. Spend this mana only to cast a
// legendary spell...` ability. Untapping after tapping for the SECOND
// ability used to reverse the wrong pool: it decremented the fungible
// `manaPool` (which was never credited) while the actual deposit sat
// untouched in `player.restrictedMana` — a state with no legal MTG
// equivalent (the mana is both "never produced" and "still floating").
//
// `tapUntap` is a registered Convex mutation exactly like `tapForPayment` —
// same harness discipline as `tapForPaymentBatch.test.ts`: drive the REAL
// `_handler` end-to-end (including `saveGameState`) via the stub
// `MutationCtx` (`gameMutationHarness.ts`), not a hand-rolled reimplementation
// of the tap/untap loop body.

import { describe, it, expect } from "vitest";
import { tapUntap } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { delightedHalfling } from "../cards/sets/ltr";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<TapUntapArgs, "gameId" | "playerId">
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

function halflingState(): GameState {
    const halfling = makeInstance(delightedHalfling.id, {
        id: "halfling",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [halfling] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("tapUntap — Delighted Halfling's SECOND mana ability (issue #1559 review)", () => {
    it("tapping the legendary-spell ability floats RESTRICTED mana, not the fungible pool", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(halflingState())]);
        // Unified mana-tap option list: index 0 is the first ability's fixed
        // {C}; indices 1-5 are the second ability's manaChoices
        // [{W},{U},{B},{R},{G}] in declared order — index 5 = {G}.
        await runTapUntap(stub.ctx, {
            cardInstanceId: "halfling",
            manaChoiceIndex: 5,
        });

        const state = stub.state();
        const card = state.players[0].battlefield.find(
            (c) => c.id === "halfling"
        )!;
        expect(card.isTapped).toBe(true);
        expect(card.chosenMana).toEqual({ G: 1 });
        // Restricted mana never touches the fungible pool.
        expect(state.players[0].manaPool.G ?? 0).toBe(0);
        expect(state.players[0].restrictedMana).toEqual([
            expect.objectContaining({
                color: "G",
                amount: 1,
                restriction: "legendary-spell",
                cantBeCounteredRider: true,
            }),
        ]);
    });

    it("untapping reverses the RESTRICTED deposit, not the (uncredited) fungible pool", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(halflingState())]);
        await runTapUntap(stub.ctx, {
            cardInstanceId: "halfling",
            manaChoiceIndex: 5,
        });
        expect(stub.state().players[0].restrictedMana).toHaveLength(1);

        // Untap toggle: card is already tapped, no manaChoiceIndex needed.
        await runTapUntap(stub.ctx, { cardInstanceId: "halfling" });

        const state = stub.state();
        const card = state.players[0].battlefield.find(
            (c) => c.id === "halfling"
        )!;
        expect(card.isTapped).toBe(false);
        expect(card.chosenMana).toBeUndefined();
        // The bug (pre-fix): `getActivatedManaAbility` always resolves to the
        // FIRST ability (the unrestricted {C} one), so the untap branch never
        // finds a `manaRestriction` to reverse and this stays stuck at 1 —
        // the mana is corrupted into existing nowhere (not reversed here, and
        // never credited to the fungible pool either).
        expect(state.players[0].restrictedMana).toBeUndefined();
        expect(state.players[0].manaPool.G ?? 0).toBe(0);
    });
});
