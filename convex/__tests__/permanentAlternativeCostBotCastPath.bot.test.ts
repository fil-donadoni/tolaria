// Issue #4935 — the Bot's cast through an alternative cost with a PERMANENT
// leg (Fireblast's "sacrifice two Mountains", Gush's "return two Islands"),
// end to end across the GRE → game.ts boundary (CR 118.9 / 601.2h).
//
// `own-alternative-cost-cast.bot.test.ts` pins the enumerator and
// `ownAlternativeCostBotCastPath.bot.test.ts` the hand-leg pitch. This drives
// the permanent leg: the enumerated Move's `announceCast`, the targets, then
// the `selectSacrifice` calls the executor makes for `castCostPicks.sacrificeIds`
// against the park the server raises. It asserts the live game ends with the
// SAME permanents given up that the search charged — a drift is a Bot that
// values sacrificing one Mountain and then sacrifices another.
//
// Harness: the stub `MutationCtx` (`gameMutationHarness.fixture.ts`).

import { describe, expect, it } from "vitest";
import { announceCast, selectSacrifice, selectTargets } from "../game";
import { thaliaGuardianOfThraben } from "../cards/sets/dka/white.cards";
import { island, mountain } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../gre/moves";
import { applyMoveForSearch } from "../gre/applyMove";
import { nextOwedPayment } from "../gre/owedPayment";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import { getDefinition } from "../cards/index";

// Retired hand-written twin (ADR 0114): resolved through the registry seam.
const fireblast = () => getDefinition("b1eb5b2c-1f02-48a6-a287-88eb189d6780");

// Retired hand-written twin (ADR 0114): resolved through the registry seam.
const gush = () => getDefinition("e755bbef-bf34-49c0-ae72-d70e3599de52");

const GAME_ID = "game-1" as Id<"games">;

type CastMove = Extract<Move, { kind: "cast-spell" }>;
type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};
type TargetsArgs = {
    gameId: Id<"games">;
    playerId: string;
    targets: {
        targetType: string;
        targetId: string;
        targetPlayerId?: string;
    }[];
};
type SacrificeArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const onBattlefield = (id: string, cardId: string, tapped = true) =>
    makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: tapped,
    });
const inHand = (id: string, cardId: string) =>
    makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });

/** Three lands of one kind plus the spell in hand. All tapped (`mixed` false)
 *  they are interchangeable and the server auto-resolves the park at
 *  announcement; with `mixed`, land-b is UNTAPPED, the choice is real and the
 *  Move carries the picks the executor submits. Three lands never pay the
 *  printed cost of either spell, so the alternative cost is the only way in. */
function board(
    spellId: string,
    landId: string,
    spell: string,
    mixed: boolean
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [inHand(spell, spellId)],
                battlefield: [
                    onBattlefield("land-a", landId),
                    onBattlefield("land-b", landId, !mixed),
                    onBattlefield("land-c", landId),
                ],
                library: [
                    inHand("lib-1", mountain().id),
                    inHand("lib-2", mountain().id),
                    inHand("lib-3", mountain().id),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function altCastMove(state: GameState, spell: string): CastMove {
    const move = enumerateMoves(state, "p1").find(
        (m): m is CastMove =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === spell &&
            m.alternativeCostId !== undefined
    );
    expect(move, `${spell} alternative-cost cast enumerated`).toBeDefined();
    return move!;
}

/** The executor's cast sequence for the permanent leg: announce, targets, then
 *  one `selectSacrifice` per id the Move carries. */
async function driveLiveCast(state: GameState, move: CastMove) {
    const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
    await runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: move.cardInstanceId,
            alternativeCostId: move.alternativeCostId,
        }
    );
    if (move.targets.length > 0) {
        await runMutation<TargetsArgs, void>(
            selectTargets as unknown as Handler<TargetsArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                targets: move.targets.map((t) => ({
                    targetType: t.type,
                    targetId: t.id,
                    targetPlayerId: t.playerId,
                })),
            }
        );
    }
    const submitted = move.castCostPicks?.sacrificeIds ?? [];
    expect(nextOwedPayment(harness.state(), "p1")?.kind).toBe(
        submitted.length > 0 ? "cast:sacrificeSelection" : undefined
    );
    for (const cardInstanceId of submitted) {
        await runMutation<SacrificeArgs, void>(
            selectSacrifice as unknown as Handler<SacrificeArgs, void>,
            harness.ctx,
            { gameId: GAME_ID, playerId: "p1", cardInstanceId }
        );
    }
    return harness.state();
}

/** The permanents the cast gave up. `applyMoveForSearch` also RESOLVES the
 *  spell (and Gush draws), while the live cast stops with it on the stack, so
 *  only the battlefield is comparable between the two. */
const left = (s: GameState) => s.players[0].battlefield.map((c) => c.id);
const inHandOf = (s: GameState, id: string) =>
    s.players[0].hand.some((c) => c.id === id);

describe("Bot permanent-leg alternative cast, GRE → game.ts (issue #4935, CR 118.9)", () => {
    it("Fireblast with a real choice: the live sacrifice matches the search's", async () => {
        const state = board(fireblast().id, mountain().id, "fireblast", true);
        const move = altCastMove(state, "fireblast");
        expect(move.tapPlan).toEqual([]);
        expect(move.castCostPicks?.sacrificeIds).toHaveLength(2);

        const predicted = applyMoveForSearch(state, "p1", move);
        expect(left(predicted)).toHaveLength(1);
        expect(predicted.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(move.castCostPicks!.sacrificeIds!)
        );

        const live = await driveLiveCast(state, move);
        expect(left(live)).toEqual(left(predicted));
        expect(live.stack.map((i) => i.id)).toEqual(["fireblast"]);
    });

    it("Gush on interchangeable Islands: the RETURN leg goes to hand, live and in the search alike", async () => {
        const state = board(gush().id, island().id, "gush", false);
        const move = altCastMove(state, "gush");
        // Interchangeable Islands: auto-resolved at announcement, nothing to submit.
        expect(move.castCostPicks).toBeUndefined();

        const predicted = applyMoveForSearch(state, "p1", move);
        expect(left(predicted)).toHaveLength(1);
        const live = await driveLiveCast(state, move);
        expect(left(live)).toEqual(left(predicted));
        for (const id of ["land-a", "land-b", "land-c"]) {
            if (left(live).includes(id)) continue;
            expect(inHandOf(live, id)).toBe(true);
            expect(inHandOf(predicted, id)).toBe(true);
        }
        expect(live.stack.map((i) => i.id)).toEqual(["gush"]);
    });

    // CR 601.2b (issue #10401) — a graveyard play permission states no cost,
    // so the card's own alternative cost is the one alternative applied: the
    // Move the Bot enumerates out of the graveyard is one `announceCast`
    // takes, and the live sacrifice is the search's.
    it("Fireblast out of the graveyard under a graveyard play permission: enumerated, announced, and charged alike", async () => {
        const state = board(fireblast().id, mountain().id, "fireblast", true);
        const p1 = state.players[0];
        const spell = p1.hand.pop()!;
        spell.zone = "graveyard";
        p1.graveyard.push(spell);
        // Without the permission the graveyard card is no cast at all.
        expect(
            enumerateMoves(state, "p1").filter(
                (m) =>
                    m.kind === "cast-spell" && m.cardInstanceId === "fireblast"
            )
        ).toEqual([]);
        state.graveyardPlayPermissionThisTurn = [
            {
                playerId: "p1",
                sourceId: "yawgmoths-will",
                actions: ["play-land", "cast"],
            },
        ];

        const move = altCastMove(state, "fireblast");
        expect(move.castFromZone).toBe("graveyard");
        expect(move.tapPlan).toEqual([]);
        expect(move.castCostPicks?.sacrificeIds).toHaveLength(2);

        const predicted = applyMoveForSearch(state, "p1", move);
        expect(left(predicted)).toHaveLength(1);

        const live = await driveLiveCast(state, move);
        expect(left(live)).toEqual(left(predicted));
        expect(live.stack.map((i) => i.id)).toEqual(["fireblast"]);
        expect(live.players[0].graveyard.map((c) => c.id)).not.toContain(
            "fireblast"
        );
    });

    it("a cost tax on the alternative cost (Thalia) fails closed instead of dropping the cast mid-search", () => {
        const state = board(fireblast().id, mountain().id, "fireblast", false);
        state.players[0].battlefield.forEach((c) => (c.isTapped = false));
        state.players[1].battlefield.push(
            makeInstance(thaliaGuardianOfThraben().id, {
                id: "thalia",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        const taxed = enumerateMoves(state, "p1").filter(
            (m): m is CastMove =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "fireblast" &&
                m.alternativeCostId !== undefined
        );
        expect(taxed).toEqual([]);
    });
});
