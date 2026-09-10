// CR 601.2g / 605.1a / 106.6 (issue #3384) — a source whose COSTED mana option
// is not its FIRST one, on both automatic seams.
//
// Arena of Glory is the shipped carrier: "{T}: Add {R}" first, then "{R}, {T},
// Exert this land: Add {R}{R}" with the CR 106.6 haste rider. Every automatic
// mana-funding seam used to key off `getActivatedManaAbility` — the FIRST mana
// ability — so:
//
//   1. `tapUntap` pre-funded the free option (no mana leg → no taps planned)
//      while `applyManaAbilityManaCost` charged the option the player actually
//      chose, and the mismatch surfaced as an uncaught "Not enough mana to
//      activate this ability" that rolled the whole mutation back;
//   2. `buildAutoTapSources` dropped every option that exerts its source or
//      charges mana of its own, unconditionally — so the {R}{R} option, and
//      the haste rider the card exists for, were unreachable automatically.
//
// Both halves are walked through the REAL registered mutation handlers
// (`gameMutationHarness.ts`), the GRE resolution, and the wire projection the
// client is the only consumer of.

import { describe, it, expect } from "vitest";
import { tapUntap, autoTapForPayment } from "../game";
import { projectPublicState } from "../gameProjections";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { arenaOfGlory } from "../cards/sets/mh3/colorless";
import { mountain } from "../cards/sets/lea";
import { grizzlyBears } from "../cards/sets/lea/green";
import { lightningBolt } from "../cards/sets/lea/red";
import { resolveTopOfStack } from "../gre/state";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** Index of "{R}, {T}, Exert this land: Add {R}{R}" in the unified mana-tap
 *  option list — Arena of Glory is a plain Land with no basic subtype, so the
 *  list is exactly its two declared abilities in order. */
const EXERT_OPTION_INDEX = 1;

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};
type AutoTapArgs = { gameId: Id<"games">; playerId: string };

const runTapUntap = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<TapUntapArgs, "gameId" | "playerId">
) =>
    runMutation<TapUntapArgs, void>(
        tapUntap as unknown as Handler<TapUntapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

const runAutoTap = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<AutoTapArgs, void>(
        autoTapForPayment as unknown as Handler<AutoTapArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

/** Arena of Glory plus `funders` Mountains, empty pool, priority held. */
function arenaBoard(
    funders: number,
    spell?: { cardId: string; pendingCast: PendingCast }
): GameState {
    const arena = makeInstance(arenaOfGlory.id, {
        id: "arena",
        controllerId: "p1",
        ownerId: "p1",
    });
    const lands = Array.from({ length: funders }, (_, i) =>
        makeInstance(mountain.id, {
            id: `mountain-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const hand = spell
        ? [
              makeInstance(spell.cardId, {
                  id: "spell",
                  controllerId: "p1",
                  ownerId: "p1",
                  zone: "hand",
              }),
          ]
        : [];
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [arena, ...lands],
                hand,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        ...(spell ? { pendingCast: spell.pendingCast } : {}),
    });
}

/** A pending cast of `cardId` for a generic-only cost — the printed cost is
 *  irrelevant here and overridden exactly as the issue #3354 payment tests do:
 *  what is under test is WHICH option the planner reaches for. */
const castOf = (
    cardId: string,
    generic: number
): { cardId: string; pendingCast: PendingCast } => ({
    cardId,
    pendingCast: {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { X: generic },
        tappedLandIds: [],
    },
});

const arenaOn = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "arena")!;

describe("tapUntap pre-funds the CHOSEN option, not the first (CR 601.2g, issue #3384)", () => {
    it("auto-taps another source to fund the costed second option", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(arenaBoard(1))]);

        await runTapUntap(stub.ctx, {
            cardInstanceId: "arena",
            manaChoiceIndex: EXERT_OPTION_INDEX,
        });

        const state = stub.state();
        const player = state.players[0];
        // The Mountain was tapped to float the {R} the exert option charges…
        expect(
            player.battlefield.find((c) => c.id === "mountain-0")!.isTapped
        ).toBe(true);
        // …and that {R} went straight into the cost, not into the pool.
        expect(player.manaPool.R ?? 0).toBe(0);
        expect(arenaOn(state).manaPaidThisTap).toEqual({ R: 1 });
        // CR 106.6 — the produced {R}{R} floats tagged with its haste rider.
        expect(player.restrictedMana).toEqual([
            { color: "R", amount: 2, hasteRider: true },
        ]);
        // CR 701.43a — the exert leg was paid exactly once.
        expect(arenaOn(state).isTapped).toBe(true);
        expect(arenaOn(state).skipNextUntap).toBe(true);
        expect(arenaOn(state).exertedThisTap).toBe(true);
    });

    it("rejects cleanly with no other untapped source, leaving the board untouched", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(arenaBoard(0))]);

        await expect(
            runTapUntap(stub.ctx, {
                cardInstanceId: "arena",
                manaChoiceIndex: EXERT_OPTION_INDEX,
            })
        ).rejects.toThrow(/Not enough mana/);

        // CR 601.2 — a rejected activation changes nothing: not the tap, not
        // the exert, not the pool.
        const state = stub.state();
        expect(arenaOn(state).isTapped).toBe(false);
        expect(arenaOn(state).skipNextUntap).toBeUndefined();
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("the untap toggle refunds the mana leg AND reverses the exert (CR 106.4 / 701.43b)", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(arenaBoard(1))]);
        await runTapUntap(stub.ctx, {
            cardInstanceId: "arena",
            manaChoiceIndex: EXERT_OPTION_INDEX,
        });

        await runTapUntap(stub.ctx, { cardInstanceId: "arena" });

        const state = stub.state();
        const player = state.players[0];
        expect(arenaOn(state).isTapped).toBe(false);
        expect(arenaOn(state).skipNextUntap).toBeUndefined();
        // The produced mana is gone and the {R} the cost took is back — a
        // toggle that reversed only one of the two would be a mana burner or
        // a mana mint. The auto-tapped Mountain stays tapped, exactly as it
        // would had the player floated the {R} by hand (CR 605.3a).
        expect(player.restrictedMana).toBeUndefined();
        expect(player.manaPool.R ?? 0).toBe(1);
        expect(
            player.battlefield.find((c) => c.id === "mountain-0")!.isTapped
        ).toBe(true);
        expect(arenaOn(state).manaPaidThisTap).toBeUndefined();
    });

    it("the tap crosses the WIRE — the client's only view of the board", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(arenaBoard(1))]);
        await runTapUntap(stub.ctx, {
            cardInstanceId: "arena",
            manaChoiceIndex: EXERT_OPTION_INDEX,
        });

        const projected = projectPublicState(stub.state(), 1, "p1");
        const me = projected.players.find((p) => p.id === "p1")!;
        expect(me.battlefield.find((c) => c.id === "arena")!.isTapped).toBe(
            true
        );
        expect(
            me.battlefield.find((c) => c.id === "mountain-0")!.isTapped
        ).toBe(true);
        expect(me.restrictedMana).toEqual([
            { color: "R", amount: 2, hasteRider: true },
        ]);
    });
});

describe("auto-tap reaches the costed option for a CREATURE spell (CR 106.6, issue #3384)", () => {
    it("prefers it over the free option and the creature resolves with haste", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(arenaBoard(1, castOf(grizzlyBears.id, 2))),
        ]);

        await runAutoTap(stub.ctx);

        const state = stub.state();
        // Same MINIMAL tap count either way (Mountain + Arena); the rider is
        // what breaks the tie, and the exert leg is paid as part of the plan.
        expect(arenaOn(state).skipNextUntap).toBe(true);
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].dynamicHasteFromMana).toBe(true);

        resolveTopOfStack(state);
        const bears = state.players[0].battlefield.find(
            (c) => c.id === "spell"
        )!;
        expect(bears.zone).toBe("battlefield");
        expect(bears.staticAbilities).toContain("haste");
        // SURFACE — the grant is derived, so it must survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players
                .find((p) => p.id === "p1")!
                .battlefield.find((c) => c.id === "spell")!.staticAbilities
        ).toContain("haste");
    });

    it("a NONCREATURE spell still takes the free option — no exert, no rider", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(arenaBoard(1, castOf(lightningBolt.id, 2))),
        ]);

        await runAutoTap(stub.ctx);

        const state = stub.state();
        // The plan may not spend a resource the payment buys nothing with:
        // Arena taps for its plain {R} and keeps its next untap step.
        expect(arenaOn(state).isTapped).toBe(true);
        expect(arenaOn(state).skipNextUntap).toBeUndefined();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].dynamicHasteFromMana).toBeUndefined();
    });
});
