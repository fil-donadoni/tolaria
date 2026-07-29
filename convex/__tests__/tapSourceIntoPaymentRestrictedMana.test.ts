// Integration test for the issue #1559 PR review's Blocking 3 finding:
// `tapSourceIntoPayment` (the payment-tap primitive shared by `tapForPayment`,
// `tapForActivationPayment` and the attack-tax taps) deposited ALL tapped
// mana straight into the fungible `manaPool`, ignoring both `manaRestriction`
// (CR 106.6) and the "can't be countered" rider — so a restricted source
// (Delighted Halfling, Mishra's Workshop, Adarkar Unicorn) was fully
// unrestricted on the DEFAULT cast path (auto-tap / click-to-pay), the exact
// path taken whenever the source is tapped DURING a cast payment rather than
// floated ahead of time via the standalone `tapUntap`.
//
// Same harness discipline as `tapForPaymentBatch.test.ts` — drives the REAL
// registered mutation `_handler`s end-to-end via the stub `MutationCtx`
// (`gameMutationHarness.ts`).

import { describe, it, expect } from "vitest";
import { tapForPayment, untapForPayment } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { delightedHalfling } from "../cards/sets/ltr";
import { theOneRing } from "../cards/sets/ltr/colorless";
import { mishrasWorkshop } from "../cards/sets/atq/colorless";
import { grizzlyBears } from "../cards/sets/lea/green";
import { buildAutoTapSources } from "../gre/autoTap";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string; manaChoiceIndex?: number }[];
};
type UntapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const runTapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    payments: TapForPaymentArgs["payments"]
) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", payments }
    );

const runUntapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<UntapForPaymentArgs, void>(
        untapForPayment as unknown as Handler<UntapForPaymentArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

/** Halfling on the battlefield + `cast` (a legendary or non-legendary spell)
 *  pending, costing `manaCost` (overridden — the printed cost is irrelevant,
 *  mirrors `tapForPaymentBatch.test.ts`'s `mountainState` pattern). */
function halflingCastState(
    castCardId: string,
    manaCost: PendingCast["manaCost"]
): GameState {
    const halfling = makeInstance(delightedHalfling.id, {
        id: "halfling",
        controllerId: "p1",
        ownerId: "p1",
    });
    const cast = makeInstance(castCardId, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost,
        tappedLandIds: [],
    };
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [halfling], hand: [cast] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
}

describe("tapForPayment — Delighted Halfling's restricted mana on the PAYMENT path (issue #1559 review, Blocking 3)", () => {
    it("paying a LEGENDARY spell's cost with the legendary-spell ability commits the cast and stamps the uncounterable rider", async () => {
        // {X:1} — tiny override so ONE {G} from the legendary ability fully
        // covers it (mirrors theOneRing's real printed {X}{4} shape, just
        // smaller for the test).
        const stub = makeMutationCtx("p1", [
            gameStateSeed(halflingCastState(theOneRing.id, { X: 1 })),
        ]);
        // manaChoiceIndex 5 = {G}, the legendary-spell ability's LAST choice
        // (index 0 = the first ability's fixed {C}; 1-5 = the manaChoices
        // [{W},{U},{B},{R},{G}] on the second, restricted ability).
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "halfling", manaChoiceIndex: 5 },
        ]);

        const state = stub.state();
        // The cast committed: restricted mana WAS eligible (The One Ring is a
        // Legendary Artifact) and covered the {X:1} generic requirement.
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        // The uncounterable rider rode along with the spend (CR 106.6).
        expect(state.stack[0].dynamicCantBeCountered).toBe(true);
        // Nothing leaked into the fungible pool, and the restricted unit was
        // fully consumed by payment.
        expect(state.players[0].manaPool.G ?? 0).toBe(0);
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("the SAME tap cannot pay for a NON-legendary spell — restriction is enforced on the payment path, cast stays pending", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(halflingCastState(grizzlyBears.id, { X: 1 })),
        ]);
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "halfling", manaChoiceIndex: 5 },
        ]);

        const state = stub.state();
        // Bug (pre-fix): the mana landed straight in the fungible pool with no
        // restriction at all, so this cast would have auto-committed despite
        // Grizzly Bears not being legendary. Fixed: the mana is restricted, so
        // it can't pay this cost — the cast stays pending, uncommitted.
        expect(state.pendingCast).toBeDefined();
        expect(state.stack).toHaveLength(0);
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

    it("untapForPayment reverses the restricted deposit (not the fungible pool) before the cast commits", async () => {
        // A cost the {G} alone can't fully cover, so the cast stays pending
        // after ONE tap and the source is still reversible.
        const stub = makeMutationCtx("p1", [
            gameStateSeed(halflingCastState(theOneRing.id, { X: 2 })),
        ]);
        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "halfling", manaChoiceIndex: 5 },
        ]);
        expect(stub.state().pendingCast).toBeDefined();
        expect(stub.state().players[0].restrictedMana).toHaveLength(1);

        await runUntapForPayment(stub.ctx, "halfling");

        const state = stub.state();
        expect(state.players[0].restrictedMana).toBeUndefined();
        expect(state.players[0].manaPool.G ?? 0).toBe(0);
        const card = state.players[0].battlefield.find(
            (c) => c.id === "halfling"
        )!;
        expect(card.isTapped).toBe(false);
        expect(card.chosenMana).toBeUndefined();
    });
});

describe("auto-tap solver — per-OPTION restriction filtering (issue #1559 review, Blocking 3)", () => {
    it("Delighted Halfling offers its free {C} ability but NOT its legendary-spell-restricted one", () => {
        const halfling = makeInstance(delightedHalfling.id, {
            id: "halfling",
            controllerId: "p1",
        });
        const sources = buildAutoTapSources([halfling]);
        expect(sources).toHaveLength(1);
        const [source] = sources;
        expect(source.cardId).toBe("halfling");
        // Only the unrestricted {C} option — the 5 legendary-spell {W/U/B/R/G}
        // options are all filtered out, not the whole source. Index 0 is kept
        // (against the FULL unified 6-option list) since 2+ options still
        // need one submitted, even though only this one survives filtering.
        expect(source.options).toEqual([
            { manaChoiceIndex: 0, mana: { C: 1 } },
        ]);
    });

    it("Mishra's Workshop (wholly restricted, single ability) is excluded entirely", () => {
        const workshop = makeInstance(mishrasWorkshop.id, {
            id: "workshop",
            controllerId: "p1",
        });
        const sources = buildAutoTapSources([workshop]);
        expect(sources).toHaveLength(0);
    });
});
