// The Mercadian Masques DEPLETION LANDS, end to end — CR 614.1c / 122.6 /
// 605.1a / 701.21, issue #2712.
//
//   This land enters tapped with two depletion counters on it.
//   {T}, Remove a depletion counter from this land: Add {G}{G}. If there are
//   no depletion counters on this land, sacrifice it.
//
// Three engine seams meet on this cycle, and each of them was a hole:
//
//  1. `entersWith.counters` on a LAND. `cards/entersWith.ts` documented
//     `settleEnteredLand` as a real entry site whose applier was LATENT — "no
//     shipped Land declares the clause yet". Hickory Woodlot is the first, so
//     the latent path becomes load-bearing here.
//  2. The FIXED `cost.removeCounter` leg on a TAP MANA ability. The stack
//     activation path (`gre/activation.ts`) has always paid it; neither
//     tap-for-mana path did, so the land would have added {G}{G} forever
//     without ever spending a counter — the exact defect the Mechanics
//     Registry records for Pentad Prism, whose mana ability is a documented
//     `useStack: true` simplification BECAUSE "`activateManaAbility` has no
//     `removeCounter` cost leg".
//  3. The conditional self-sacrifice. A mana ability is stackless and carries
//     no `effects[]` (CR 605.3a), so "If there are no depletion counters on
//     this land, sacrifice it" is a declarative RIDER
//     (`sacrificesSourceWhenNoCountersRemain`) read AFTER the cost is paid —
//     the `drawsCardOnTap` / `dealsDamageToControllerOnTap` shape.
//
// Driven through the REAL entry points: the registered `tapUntap` mutation
// `_handler` via the stub `MutationCtx` for the priority tap, the exported
// `tapSourceIntoPayment` primitive for the payment tap, and `applyPlayLand`
// for the entry. Not one hand-rolled state edit — every seam above lives
// inside those functions' branch selection.

import { describe, it, expect } from "vitest";
import { tapSourceIntoPayment, tapUntap } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { applyPlayLand } from "../gre/playLand";
import { projectPublicState } from "../gameProjections";
import {
    getActivatedManaAbility,
    getManaTapOptionsDetailed,
    isUntappedManaSource,
    manaTapSacrificesSource,
    mayBeSacrificedForMana,
} from "../gre/constants";
import {
    hickoryWoodlot,
    peatBog,
    remoteFarm,
    sandstoneNeedle,
    saprazzanSkerry,
} from "../cards/sets/mmq/colorless";
import type { CardDefinition } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const DEPLETION = "depletion";

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

/** One depletion land already on p1's battlefield, untapped, with `counters`
 *  depletion counters on it — the state a real game reaches the turn AFTER the
 *  land was played (it enters tapped). */
function boardWith(
    def: CardDefinition,
    counters: number
): { state: GameState; player: PlayerState; land: CardInstanceState } {
    const land = makeInstance(def.id, {
        id: "woodlot",
        controllerId: "p1",
        ownerId: "p1",
        ...(counters > 0 ? { counters: { [DEPLETION]: counters } } : {}),
    });
    const player = makePlayer("p1", { battlefield: [land] });
    player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const state = makeState({
        players: [player, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, player, land: player.battlefield[0]! };
}

describe("depletion lands — entry (CR 614.1c / 122.1, issue #2712)", () => {
    it("Hickory Woodlot enters TAPPED with two depletion counters, and both survive the wire", () => {
        const inHand = makeInstance(hickoryWoodlot.id, {
            id: "woodlot",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [inHand] }), makePlayer("p2")],
        });

        const entered = applyPlayLand(state, state.players[0], "woodlot");

        expect(entered).not.toBeNull();
        expect(entered!.isTapped).toBe(true);
        expect(entered!.counters?.[DEPLETION]).toBe(2);
        // CR 614.1c — a self-replacement, not a trigger: nothing on the stack,
        // nobody gets priority over the placement.
        expect(state.stack).toEqual([]);

        // The client sees only the projection, and it is what renders the
        // counter badge and gates the tap affordance.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0]!.battlefield.find(
            (c) => c.id === "woodlot"
        )!;
        expect(slim.isTapped).toBe(true);
        expect(slim.counters?.[DEPLETION]).toBe(2);
    });
});

describe("depletion lands — priority tap (CR 605.1a / 122.6 / 701.21)", () => {
    it("the FIRST tap adds {G}{G} and spends one counter, leaving the land on the battlefield", async () => {
        const { state } = boardWith(hickoryWoodlot, 2);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, "woodlot");

        const after = stub.state();
        const player = after.players[0]!;
        expect(player.manaPool.G).toBe(2);
        const land = player.battlefield.find((c) => c.id === "woodlot");
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(true);
        expect(land!.counters?.[DEPLETION]).toBe(1);
        // CR 605.3a — a mana ability never uses the stack, sacrifice rider or
        // not.
        expect(after.stack).toEqual([]);
        expect(
            player.graveyard.find((c) => c.id === "woodlot")
        ).toBeUndefined();
    });

    it("the SECOND tap adds {G}{G} and SACRIFICES the land, the mana surviving it", async () => {
        const { state } = boardWith(hickoryWoodlot, 1);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, "woodlot");

        const after = stub.state();
        const player = after.players[0]!;
        // CR 605.1a — the mana is added as the ability resolves; the sacrifice
        // is the rest of that same resolution and cannot take it back.
        expect(player.manaPool.G).toBe(2);
        expect(
            player.battlefield.find((c) => c.id === "woodlot")
        ).toBeUndefined();
        const dead = player.graveyard.find((c) => c.id === "woodlot");
        expect(dead).toBeDefined();
        // CR 122.6 — the counter it spent is gone, not merely decremented to a
        // zero-valued entry.
        expect(dead!.counters?.[DEPLETION]).toBeUndefined();
    });

    it("untapping to refund unspent mana restores the counter (CR 106.4)", async () => {
        const { state } = boardWith(hickoryWoodlot, 2);
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapUntap(stub.ctx, "woodlot");
        // The whole activation is reversible while the mana is still floating:
        // the toggle must give the counter back, or a misclick costs half the
        // land. The FIXED tap branch had no counter restore at all.
        await runTapUntap(stub.ctx, "woodlot");

        const after = stub.state();
        const player = after.players[0]!;
        expect(player.manaPool.G).toBe(0);
        const land = player.battlefield.find((c) => c.id === "woodlot")!;
        expect(land.isTapped).toBe(false);
        expect(land.counters?.[DEPLETION]).toBe(2);
        expect(land.manaCounterRemoval).toBeUndefined();
    });
});

describe("depletion lands — payment tap (CR 605.1a / 122.6 / 701.21)", () => {
    it("pays the counter mid-payment and keeps the land while a counter remains", () => {
        const { state, player, land } = boardWith(hickoryWoodlot, 2);
        const tappedLandIds: string[] = [];

        tapSourceIntoPayment(state, player, land, undefined, tappedLandIds);

        expect(player.manaPool.G).toBe(2);
        expect(land.counters?.[DEPLETION]).toBe(1);
        expect(land.manaCounterRemoval).toEqual({ type: DEPLETION, count: 1 });
        // Reversible, so it is recorded for an aborted payment.
        expect(tappedLandIds).toEqual(["woodlot"]);
    });

    it("a SACRIFICED land is dropped from tappedLandIds, so an aborted payment cannot resurrect it", () => {
        const { state, player, land } = boardWith(hickoryWoodlot, 1);
        const tappedLandIds: string[] = [];

        tapSourceIntoPayment(state, player, land, undefined, tappedLandIds);

        expect(player.manaPool.G).toBe(2);
        expect(player.graveyard.find((c) => c.id === "woodlot")).toBeDefined();
        // CR 106.4 reverses a TAP, never a sacrifice: an id left here would
        // untap a permanent sitting in the graveyard and refund its mana.
        expect(tappedLandIds).toEqual([]);
    });
});

describe("depletion lands — a land with no counters is not a mana source", () => {
    // Normally unreachable (the rider eats the land as its last counter goes),
    // but an effect that strips counters outright — Vampire Hexmage, Thief of
    // Blood — leaves the land on the battlefield and inert. Every consumer of
    // the mana-source predicates must see that, or the bot's mana proxy counts
    // a land it cannot tap and the client offers a click the server rejects.
    it("offers no tap option, resolves no mana ability, and counts as no source", () => {
        const { state, player, land } = boardWith(hickoryWoodlot, 0);
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));

        expect(getActivatedManaAbility(land)).toBeNull();
        expect(getManaTapOptionsDetailed(land, "p1", battlefields)).toEqual([]);
        expect(isUntappedManaSource(land, player.battlefield)).toBe(false);
    });

    it("still offers the option while a counter remains", () => {
        const { state, player, land } = boardWith(hickoryWoodlot, 1);
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));

        expect(getActivatedManaAbility(land)).not.toBeNull();
        expect(
            getManaTapOptionsDetailed(land, "p1", battlefields).length
        ).toBeGreaterThan(0);
        expect(isUntappedManaSource(land, player.battlefield)).toBe(true);
    });
});

describe("depletion lands — the search's coarse mana model", () => {
    // `applyTapPlan` (search.ts / applyMove.ts) asks these two whether tapping
    // a source for mana removes it from the battlefield. Answering "no" leaves
    // a depleted land sitting tapped in every simulated future, so the bot
    // plans around mana it no longer has.
    it("mayBeSacrificedForMana admits the conditional shape", () => {
        const { land } = boardWith(hickoryWoodlot, 2);
        expect(mayBeSacrificedForMana(land)).toBe(true);
    });

    it("manaTapSacrificesSource is false on the first tap and true on the last", () => {
        const twoLeft = boardWith(hickoryWoodlot, 2);
        const battlefieldsTwo = twoLeft.state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        expect(
            manaTapSacrificesSource(
                twoLeft.land,
                "p1",
                battlefieldsTwo,
                undefined
            )
        ).toBe(false);

        const oneLeft = boardWith(hickoryWoodlot, 1);
        const battlefieldsOne = oneLeft.state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        expect(
            manaTapSacrificesSource(
                oneLeft.land,
                "p1",
                battlefieldsOne,
                undefined
            )
        ).toBe(true);
    });
});

describe("depletion lands — the whole cycle", () => {
    const CYCLE: [CardDefinition, "W" | "U" | "B" | "R" | "G"][] = [
        [remoteFarm, "W"],
        [saprazzanSkerry, "U"],
        [peatBog, "B"],
        [sandstoneNeedle, "R"],
        [hickoryWoodlot, "G"],
    ];

    it.each(CYCLE)(
        "$name taps for two of its own colour, twice, then dies",
        async (def, color) => {
            const first = boardWith(def, 2);
            const stubFirst = makeMutationCtx("p1", [
                gameStateSeed(first.state),
            ]);
            await runTapUntap(stubFirst.ctx, "woodlot");
            const afterFirst = stubFirst.state().players[0]!;
            expect(afterFirst.manaPool[color]).toBe(2);
            expect(
                afterFirst.battlefield.find((c) => c.id === "woodlot")!
                    .counters?.[DEPLETION]
            ).toBe(1);

            const last = boardWith(def, 1);
            const stubLast = makeMutationCtx("p1", [gameStateSeed(last.state)]);
            await runTapUntap(stubLast.ctx, "woodlot");
            const afterLast = stubLast.state().players[0]!;
            expect(afterLast.manaPool[color]).toBe(2);
            expect(
                afterLast.graveyard.find((c) => c.id === "woodlot")
            ).toBeDefined();
        }
    );
});
