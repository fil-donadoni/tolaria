// Full-path integration for a split HALF cast from a zone other than the hand
// (CR 709.3, issue #3344): the legality gate, the announced option, and what
// the real `announceCast` mutation actually CHARGES.
//
// The gate half is `splitCast.test.ts` and the Bot half is
// `splitCastNonHand.bot.test.ts`. This file exists for the crossing neither can
// see: `getLegalActions` prices a cast through `castRawManaCost`, and
// `announceCast` prices the ANNOUNCED OPTION through `chosenAltCost.mana` — two
// different expressions, and while they disagreed the gate offered a cast that
// then parked unpayable or committed at the wrong price. The seam that makes
// them one answer is `castAlternativeCostForZone`, and the only way to prove it
// is to run the mutation and count the mana and the life it spent.
//
// Stand // Deliver: Stand is {W}, Deliver is {2}{U}, and the CARD in any zone
// but the stack is {2}{U}{W} with mana value 4 (CR 709.4b). Every number below
// is one of those three, and which one it is, is the whole point.

import { describe, it, expect } from "vitest";
import { announceCast, selectTargets } from "../../game";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import { getPlayer, type GameState } from "../state";
import { splitCastAltCostId } from "../splitCast";
import { splitHalfDefinitionId } from "../../cards/splitCard";
import { getLegalActions } from "../rules";
import { lifeDeath } from "../../cards/sets/apc/multicolor";

const STAND_DELIVER = getCardByName("Stand // Deliver");
const CITADEL = getCardByName("Bolas's Citadel").id;
const HILL_GIANT = getCardByName("Hill Giant").id;

const LEFT = splitCastAltCostId(STAND_DELIVER, "left");
const RIGHT = splitCastAltCostId(STAND_DELIVER, "right");
const LEFT_ID = splitHalfDefinitionId(STAND_DELIVER.id, "left");

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

const announce = (
    harness: ReturnType<typeof makeMutationCtx>,
    args: Omit<AnnounceArgs, "gameId" | "playerId">
) =>
    runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        { ...BASE, ...args }
    );

/** CR 601.2c — both halves TARGET, so the announcement parks on
 *  `pendingTarget` and the pick is a separate mutation, exactly as the client
 *  and the Bot's executor send it. The commit (and therefore the payment this
 *  file is about) happens on THIS call. */
const pickGiant = (harness: ReturnType<typeof makeMutationCtx>) =>
    runMutation<Record<string, unknown>, void>(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        {
            ...BASE,
            targets: [{ targetType: "permanent", targetId: "giant" }],
        }
    );

/** Stand // Deliver in `zone`, a Hill Giant on p2's board (a legal target for
 *  both halves), and floating mana rather than untapped lands so the payment
 *  half COMMITS instead of parking for `tapForPayment` — what is asserted here
 *  is the amount charged, never the tap UI. */
function board(opts: {
    zone: "graveyard" | "library";
    pool?: Partial<Record<"W" | "U", number>>;
    citadel?: boolean;
    life?: number;
}): GameState {
    const card = makeInstance(STAND_DELIVER.id, {
        id: "split",
        controllerId: "p1",
        ownerId: "p1",
        zone: opts.zone,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                ...(opts.zone === "graveyard"
                    ? { graveyard: [card] }
                    : { library: [card] }),
                manaPool: {
                    W: opts.pool?.W ?? 0,
                    U: opts.pool?.U ?? 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: 0,
                },
                ...(opts.citadel
                    ? {
                          battlefield: [
                              makeInstance(CITADEL, {
                                  id: "citadel",
                                  controllerId: "p1",
                                  ownerId: "p1",
                              }),
                          ],
                      }
                    : {}),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "giant",
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
    if (opts.life !== undefined) state.players[0].life = opts.life;
    if (opts.zone === "graveyard") {
        // CR 305.1-analog / 601 — Yawgmoth's Will's BROAD permission is
        // turn-scoped state written by `grantGraveyardPlay`, not a battlefield
        // scan; setting it is what routes the card through the permission
        // branch rather than `getLegalActions`'s zone-blind fallback.
        state.graveyardPlayPermissionThisTurn = [
            { playerId: "p1", zones: ["spell", "land"] },
        ];
    }
    return state;
}

describe("CR 709.3 — announceCast commits a split HALF from a non-hand zone (issue #3344)", () => {
    it("Yawgmoth's Will charges the HALF's printed cost, not the combined one", async () => {
        // {W} in the pool pays for Stand and could never pay the card's own
        // {2}{U}{W} — which is exactly what this branch used to price.
        const state = board({ zone: "graveyard", pool: { W: 1 } });
        expect(
            getLegalActions(
                state,
                getPlayer(state, "p1"),
                state.players[0].graveyard[0]
            )
        ).toContain("cast");

        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await announce(harness, {
            cardInstanceId: "split",
            alternativeCostId: LEFT,
        });
        await pickGiant(harness);

        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["split"]);
        // CR 709.3b — the object on the stack IS the half.
        expect((after.stack[0].card as { id?: string }).id).toBe(LEFT_ID);
        // The {W} was spent and nothing else was owed.
        expect(getPlayer(after, "p1").manaPool.W).toBe(0);
    });

    it("refuses a PRINTED announcement from the graveyard (CR 709.3)", async () => {
        const state = board({
            zone: "graveyard",
            pool: { W: 1, U: 3 },
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            announce(harness, { cardInstanceId: "split" })
        ).rejects.toThrow(/one half at a time/);
    });

    it("Bolas's Citadel charges life equal to the HALF's mana value (CR 709.4b)", async () => {
        // Stand's mana value is 1 and the card's is 4. A caster on 3 life can
        // pay for Stand and could not pay the combined amount at all.
        const state = board({
            zone: "library",
            citadel: true,
            life: 3,
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await announce(harness, {
            cardInstanceId: "split",
            alternativeCostId: LEFT,
        });
        await pickGiant(harness);

        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["split"]);
        expect((after.stack[0].card as { id?: string }).id).toBe(LEFT_ID);
        // 3 − 1: the half's mana value, and no mana was ever owed (the
        // permission replaced the whole cost).
        expect(getPlayer(after, "p1").life).toBe(2);
    });

    it("an UNTARGETED half off a Citadel still pays its life (CR 119.4, PR review finding 2)", async () => {
        // Life // Death's "Life" half takes no target, so it commits in
        // `announceCast`'s alternative-cost branch rather than in
        // `finalizeTargetSelection` — and that branch's life accumulator had no
        // library-top leg, because until CR 709.3's half became the one
        // announcement allowed to ride the substitution nothing could reach it.
        // The half was cast for free.
        const card = makeInstance(lifeDeath.id, {
            id: "lifedeath",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [card],
                    battlefield: [
                        makeInstance(CITADEL, {
                            id: "citadel",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {}),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await announce(harness, {
            cardInstanceId: "lifedeath",
            alternativeCostId: splitCastAltCostId(lifeDeath, "left"),
        });

        const after = harness.state();
        expect(after.stack.map((s) => s.id)).toEqual(["lifedeath"]);
        // "Life" is {G}, mana value 1 — the card's own is 3.
        expect(getPlayer(after, "p1").life).toBe(19);
    });

    it("refuses the half the life total cannot cover (CR 119.4, PR review finding 3)", async () => {
        // `getLegalActions` reports a card-level "cast" as soon as ONE half is
        // payable (Stand costs 1 life), so the caster can still ASK for the
        // other. Which half was announced is known only in the mutation, and
        // without its own check the announcement drove the life total to −2.
        const state = board({ zone: "library", citadel: true, life: 1 });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        expect(
            getLegalActions(
                state,
                getPlayer(state, "p1"),
                state.players[0].library[0]
            )
        ).toContain("cast");
        await expect(
            announce(harness, {
                cardInstanceId: "split",
                alternativeCostId: RIGHT,
            })
        ).rejects.toThrow(/Not enough life/);
        // The payable half is untouched by the refusal.
        await announce(harness, {
            cardInstanceId: "split",
            alternativeCostId: LEFT,
        });
        await pickGiant(harness);
        expect(getPlayer(harness.state(), "p1").life).toBe(0);
    });

    it("the OTHER half off the same library top costs its own 3 life", async () => {
        const state = board({
            zone: "library",
            citadel: true,
            life: 10,
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await announce(harness, {
            cardInstanceId: "split",
            alternativeCostId: RIGHT,
        });
        await pickGiant(harness);
        // Deliver is {2}{U}, mana value 3 — the discriminating half. A single
        // combined answer would charge 4 for both.
        expect(getPlayer(harness.state(), "p1").life).toBe(7);
    });
});
