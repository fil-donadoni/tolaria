// Integration test for the PRIORITY tap-for-mana path (`tapUntap`) paying a
// mana ability's own MANA cost leg — CR 605.1a / 601.2f.
//
// `tapSourceIntoPayment` (the tap-while-paying path) has always called
// `applyManaAbilityManaCost`; `tapUntap` never did. Every shipped "{N}, {T}:
// Add …" filter was therefore FREE RAMP when tapped with priority instead of
// mid-payment: Mana Cylix, Celestial Prism, Standing Stones, Chromatic Star,
// Chromatic Sphere, Barbed Sextant, Implements of Sacrifice, Fire Sprites.
//
// Both `tapUntap` branches are covered: the manaChoices branch (Mana Cylix —
// "{1}, {T}: Add one mana of any color") and the fixed-output branch (Fire
// Sprites — "{G}, {T}: Add {R}").
//
// Drives the REAL registered mutation `_handler` end-to-end through the stub
// `MutationCtx` (`gameMutationHarness.ts`), the same discipline as
// `tapUntapRestrictedManaAbility.test.ts` — not a reimplementation of the loop
// body.

import { describe, it, expect } from "vitest";
import { tapUntap } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { manaCylix } from "../cards/sets/pls/colorless";
import { fireSprites } from "../cards/sets/leg/green";
import { mountain } from "../cards/sets/lea";
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

/** Mana Cylix on the battlefield with `pool` floating for its controller. */
function cylixState(pool: Partial<GameState["players"][0]["manaPool"]>) {
    const cylix = makeInstance(manaCylix.id, {
        id: "cylix",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [cylix],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("tapUntap — a mana ability's own mana cost (CR 605.1a / 601.2f)", () => {
    describe("manaChoices branch — Mana Cylix ({1}, {T}: Add one mana of any color)", () => {
        it("deducts the {1} from the pool, so the tap is a FILTER not a ramp", async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(cylixState({ C: 1 })),
            ]);
            // Single ability, `manaChoices: ANY_SINGLE_COLOR` — index 1 = {U}.
            await runTapUntap(stub.ctx, {
                cardInstanceId: "cylix",
                manaChoiceIndex: 1,
            });

            const state = stub.state();
            const player = state.players[0];
            expect(player.manaPool.U).toBe(1);
            // The {1} was paid with the floating {C}: net zero mana, one colour
            // converted. Pre-fix this read C: 1 — a free extra mana every tap.
            expect(player.manaPool.C ?? 0).toBe(0);
            const card = player.battlefield.find((c) => c.id === "cylix")!;
            expect(card.isTapped).toBe(true);
            expect(card.manaPaidThisTap).toEqual({ C: 1 });
        });

        it("rejects the activation with an empty pool and NO other mana source", async () => {
            const stub = makeMutationCtx("p1", [gameStateSeed(cylixState({}))]);
            await expect(
                runTapUntap(stub.ctx, {
                    cardInstanceId: "cylix",
                    manaChoiceIndex: 1,
                })
            ).rejects.toThrow(/Not enough mana/);
            // CR 601.2 — a rejected activation leaves the source untouched.
            const card = stub
                .state()
                .players[0].battlefield.find((c) => c.id === "cylix")!;
            expect(card.isTapped).toBe(false);
        });

        // CR 601.2g / 605.3a — the auto-tap convenience every other costed play
        // has. An empty pool is NOT a precondition: the engine taps a land to
        // float the {1} first (the legal sequence — a mana ability can be
        // activated to pay for another, CR 605.3a), then pays it.
        it("auto-taps a land to fund the {1} instead of rejecting", async () => {
            const cylix = makeInstance(manaCylix.id, {
                id: "cylix",
                controllerId: "p1",
                ownerId: "p1",
            });
            const forest = makeInstance(mountain.id, {
                id: "mtn",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [cylix, forest],
                        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

            await runTapUntap(stub.ctx, {
                cardInstanceId: "cylix",
                manaChoiceIndex: 1, // {U}
            });

            const player = stub.state().players[0];
            const rock = player.battlefield.find((c) => c.id === "cylix")!;
            const land = player.battlefield.find((c) => c.id === "mtn")!;
            expect(rock.isTapped).toBe(true);
            // The Mountain was tapped by the engine and its {R} consumed by the
            // filter's {1} — a filter, not a ramp: exactly one mana floats.
            expect(land.isTapped).toBe(true);
            expect(player.manaPool.U).toBe(1);
            expect(player.manaPool.R ?? 0).toBe(0);
            expect(rock.manaPaidThisTap).toEqual({ R: 1 });
            // CR 106.4 — the auto-tapped land's mana is spent, so it can't be
            // untapped for a refund.
            expect(land.manaCommitted).toBe(true);
        });

        it("untapping refunds the {1} it paid (CR 106.4)", async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(cylixState({ C: 1 })),
            ]);
            await runTapUntap(stub.ctx, {
                cardInstanceId: "cylix",
                manaChoiceIndex: 1,
            });
            await runTapUntap(stub.ctx, { cardInstanceId: "cylix" });

            const player = stub.state().players[0];
            // Whole activation reversed: produced {U} withdrawn, paid {C} back.
            expect(player.manaPool.U ?? 0).toBe(0);
            expect(player.manaPool.C ?? 0).toBe(1);
            const card = player.battlefield.find((c) => c.id === "cylix")!;
            expect(card.isTapped).toBe(false);
            expect(card.manaPaidThisTap).toBeUndefined();
        });
    });

    describe("fixed-output branch — Fire Sprites ({G}, {T}: Add {R})", () => {
        function spritesState(g: number): GameState {
            const sprites = makeInstance(fireSprites.id, {
                id: "sprites",
                controllerId: "p1",
                ownerId: "p1",
            });
            // CR 302.6 — controlled since before this turn, so the {T} is legal.
            sprites.isSummoningSick = undefined;
            sprites.enteredOnTurn = undefined;
            return makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [sprites],
                        manaPool: {
                            W: 0,
                            U: 0,
                            B: 0,
                            R: 0,
                            G: g,
                            C: 0,
                        },
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
        }

        it("deducts the {G} and adds the {R}", async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(spritesState(1)),
            ]);
            await runTapUntap(stub.ctx, { cardInstanceId: "sprites" });

            const player = stub.state().players[0];
            expect(player.manaPool.R).toBe(1);
            expect(player.manaPool.G ?? 0).toBe(0);
        });

        it("rejects the activation with an empty pool and no other source", async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(spritesState(0)),
            ]);
            await expect(
                runTapUntap(stub.ctx, { cardInstanceId: "sprites" })
            ).rejects.toThrow(/Not enough mana/);
        });
    });
});
