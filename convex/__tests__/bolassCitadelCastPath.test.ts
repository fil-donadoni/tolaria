// Bolas's Citadel — the FULL `game.ts` mutation path for a cast off the top of
// the library whose mana cost the permission REPLACES with life (issue #2398,
// CR 601.3 / 118.9-analog / 119.4 / 107.3b / 601.2b).
//
// The per-card test (`convex/cards/sets/war/__tests__/black.test.ts`) covers the
// legality gate, the wire projection and `libraryTopCastLifeCost`; the client
// test covers the pile reducer. NONE of those drives `announceCast` /
// `finalizeTargetSelection`, which is where the card's HEADLINE behaviour lives:
// the life leaving, the card moving library → stack, `locateCastSource`'s
// library branch, and the two CR announcement restrictions the replacement
// brings with it. Review round 1 of PR #2575 proved the gap by zeroing BOTH
// life accumulators (`game.ts` ~6640 / ~8060) and watching all 41 existing
// tests stay green.
//
// Same harness discipline as `upToXTargetCastLegality.test.ts` /
// `selectTargetsBatch.test.ts`: this project has no convex-test harness, so the
// established seam for `game.ts` integration coverage is a stub `MutationCtx`
// driving the REGISTERED mutation's own `_handler` (`gameMutationHarness.ts`) —
// never a hand-rolled reimplementation of the announcement loop.

import { describe, it, expect } from "vitest";
import { announceCast, confirmTargets, selectTarget } from "../game";
import { bolassCitadel } from "../cards/sets/war/black";
import { fireball, lightningBolt } from "../cards/sets/lea/red";
import { grizzlyBears } from "../cards/sets/lea/green";
import { island, mountain } from "../cards/sets/lea/colorless";
import { gush } from "../cards/sets/mmq/blue";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
    alternativeCostId?: string;
};

const runAnnounceCast = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<AnnounceCastArgs, "gameId" | "playerId">
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
    targetPlayerId?: string;
};

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<SelectTargetArgs, "gameId" | "playerId">
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

/** Fireball's requirement is `{ min: 1 }` with no max (CR 601.2c — "any number
 *  of targets"), so a single pick never auto-finalizes; the caster ends the
 *  selection explicitly, exactly as the board's Done button does. */
const runConfirmTargets = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<{ gameId: Id<"games">; playerId: string }, void>(
        confirmTargets as unknown as Handler<
            { gameId: Id<"games">; playerId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

/** p1 controls a Bolas's Citadel with `topCardId` on top of their library (id
 *  `top`), plus `mountains` untapped Mountains — deliberately ENOUGH mana to
 *  pay several printed costs, so a test that sees a spell cast proves the LIFE
 *  path only if the life total moved. `islands` adds untapped Islands, which is
 *  what makes Gush's "return two Islands" alternative cost genuinely PAYABLE:
 *  without them `canPayAlternativeCost` rejects the announcement first and the
 *  CR 601.2b test passes for the wrong reason. */
function citadelState(
    topCardId: string,
    mountains = 3,
    islands = 0
): GameState {
    const battlefield: CardInstanceState[] = [
        makeInstance(bolassCitadel.id, {
            id: "citadel",
            controllerId: "p1",
            ownerId: "p1",
        }),
        ...Array.from({ length: mountains }, (_, i) =>
            makeInstance(mountain.id, {
                id: `mountain-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        ),
        ...Array.from({ length: islands }, (_, i) =>
            makeInstance(island.id, {
                id: `island-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        ),
    ];
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield,
                library: [
                    makeInstance(topCardId, {
                        id: "top",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("announceCast — a library-top cast pays LIFE instead of mana (CR 118.9-analog / 119.4, issue #2398)", () => {
    it("no-target commit path: Grizzly Bears (MV 2) off the top costs 2 life and moves library → stack", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(citadelState(grizzlyBears.id)),
        ]);

        await runAnnounceCast(harness.ctx, { cardInstanceId: "top" });

        const after = harness.state();
        const p1 = after.players[0];
        // The whole point of the card: the mana cost was replaced, so the life
        // — not the untapped Mountains — is what paid for the spell.
        expect(p1.life).toBe(18);
        expect(p1.battlefield.filter((c) => c.isTapped)).toHaveLength(0);
        // `locateCastSource`'s library branch found it, and the commit removed
        // it from the library rather than from a hand it was never in.
        expect(p1.library).toHaveLength(0);
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].id).toBe("top");
    });

    it("targeted commit path: Lightning Bolt (MV 1) off the top costs 1 life once the target is chosen, not at announcement", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(citadelState(lightningBolt.id)),
        ]);

        await runAnnounceCast(harness.ctx, { cardInstanceId: "top" });

        // CR 601.2c → 601.2h — targets are chosen BEFORE costs are paid, so
        // the life must still be untouched while the cast sits in
        // `pendingTarget`.
        const announced = harness.state();
        expect(announced.pendingTarget?.cardInstanceId).toBe("top");
        expect(announced.players[0].life).toBe(20);
        expect(announced.players[0].library).toHaveLength(1);

        await runSelectTarget(harness.ctx, {
            targetType: "player",
            targetId: "p2",
        });

        const after = harness.state();
        expect(after.players[0].life).toBe(19);
        expect(after.players[0].library).toHaveLength(0);
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].id).toBe("top");
    });

    it("charges nothing extra without the permission — the same card in the library is not castable at all", async () => {
        const state = citadelState(grizzlyBears.id);
        // Citadel leaves play: the permission is re-derived live, so the top
        // card stops being a legal cast source (`assertLegalAction`).
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "citadel"
        );
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runAnnounceCast(harness.ctx, { cardInstanceId: "top" })
        ).rejects.toThrow();
        expect(harness.state().players[0].life).toBe(20);
    });
});

describe("announceCast — CR 107.3b: the only legal choice for X is 0 on a cast that pays neither its mana cost nor an alternative cost including X", () => {
    it("rejects an announced X > 0 for Fireball off the top of the library", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(citadelState(fireball.id)),
        ]);

        // Before the clamp this SUCCEEDED: `castRawManaCost` returns `{}`, so
        // `normalizeManaCost({}, { chosenX: 5 })` owed no mana, and the only
        // charge was 1 life (the off-stack mana value, CR 202.3e).
        await expect(
            runAnnounceCast(harness.ctx, { cardInstanceId: "top", chosenX: 5 })
        ).rejects.toThrow(/only legal choice for X is 0/);
        // Fail-closed: nothing was paid and nothing moved.
        expect(harness.state().players[0].life).toBe(20);
        expect(harness.state().players[0].library).toHaveLength(1);
        expect(harness.state().pendingTarget).toBeUndefined();
    });

    it("accepts the cast with X omitted and prices it at X = 0 (1 life for {X}{R})", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(citadelState(fireball.id)),
        ]);

        await runAnnounceCast(harness.ctx, { cardInstanceId: "top" });

        const pt = harness.state().pendingTarget;
        expect(pt?.cardInstanceId).toBe("top");
        // The forced value is carried explicitly, never left `undefined` for a
        // downstream consumer to re-derive from a cost that no longer has an X.
        expect(pt?.chosenX).toBe(0);

        await runSelectTarget(harness.ctx, {
            targetType: "player",
            targetId: "p2",
        });
        await runConfirmTargets(harness.ctx);

        // CR 202.3e — X is 0 off the stack, so the mana value Citadel charges
        // for is 1 ({X}{R}), not 1 + whatever X the caster wished for.
        expect(harness.state().players[0].life).toBe(19);
        expect(harness.state().stack[0].chosenX).toBe(0);
    });

    it("still demands an X for the SAME card cast from the hand (the clamp is scoped to the replaced cost)", async () => {
        const state = citadelState(grizzlyBears.id);
        state.players[0].hand = [
            makeInstance(fireball.id, {
                id: "hand-fireball",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ];
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runAnnounceCast(harness.ctx, { cardInstanceId: "hand-fireball" })
        ).rejects.toThrow(/Must choose X/);
    });
});

describe("announceCast — CR 601.2b: no alternative cost may ride along with the library-top cast", () => {
    it("rejects Gush's 'return two Islands' alternative cost off the top of the library — even though the cost is PAYABLE", async () => {
        // Two untapped Islands: `canPayAlternativeCost` is satisfied, so the
        // rejection can only come from the CR 601.2b gate and not from the
        // affordability check that runs before it. The assertion is on the
        // specific message for the same reason.
        const state = citadelState(gush.id, 0, 2);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runAnnounceCast(harness.ctx, {
                cardInstanceId: "top",
                alternativeCostId: "return-two-islands",
            })
        ).rejects.toThrow(/Can't apply an alternative cost/);
        expect(harness.state().players[0].life).toBe(20);
        expect(harness.state().players[0].library).toHaveLength(1);
        // The Islands stayed put: nothing was paid on the way to the throw.
        expect(harness.state().players[0].battlefield).toHaveLength(3);
    });

    it("the SAME alternative cost is accepted for the same card in HAND (the gate is the replacement, not the card)", async () => {
        const state = citadelState(grizzlyBears.id, 0, 2);
        state.players[0].hand = [
            makeInstance(gush.id, {
                id: "hand-gush",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ];
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "hand-gush",
            alternativeCostId: "return-two-islands",
        });

        // CR 118.9 — the Islands went back to hand and the spell is on the
        // stack: the new gate did not leak onto an ordinary hand cast.
        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].id).toBe("hand-gush");
        expect(
            after.players[0].battlefield.filter((c) => c.id !== "citadel")
        ).toHaveLength(0);
    });
});
