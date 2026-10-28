// Casting the BACK face of a modal double-faced card through the full
// `game.ts` mutation path (CR 712.11b, issue #7200).
//
// `castMode.bot.test.ts` proves the census stamps the back face in both
// search executors. This drives `announceCast` → `selectTarget` →
// `tapForPayment`, the real commit, and then the resolution, because the
// headline behaviours live at the two ends of the stack:
//
//   * CR 712.11b / 712.11c — the face is chosen BEFORE the card reaches the
//     stack, and only that face is evaluated: the price paid is the back
//     face's own mana cost, and the target asked for is the back face's.
//   * CR 712.8f — on the stack, and on the battlefield after a permanent back
//     face resolves, the object has only the back face's characteristics.
//   * CR 712.8a — an instant back face that resolves into the graveyard is its
//     FRONT face there.
//
// Same harness discipline as `splitCardCastPath.test.ts`: a stub
// `MutationCtx` driving the REGISTERED mutation's own `_handler`.

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget, tapForPayment } from "../game";
import { hillGiant } from "../cards/sets/lea/red.cards";
import { forest, mountain, plains } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { modalBackFaceDefinitionId } from "../cards/modalDfc";
import { modalBackCastAltCostId } from "../gre/modalBackCast";
import { independentCastOptionsFor } from "../gre/castMode";
import { resolveTopOfStack } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { tryGetDefinition } from "../cards";
import type { CardInstanceState, GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    MODAL_CREATURE_BACK_PROBE_ID,
    MODAL_INSTANT_BACK_PROBE_ID,
    modalCreatureBackProbe,
    modalInstantBackProbe,
} from "../gre/__tests__/fixtures/modalBackProbe.fixture";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const CREATURE_BACK_ID = modalBackFaceDefinitionId(
    MODAL_CREATURE_BACK_PROBE_ID
);
const INSTANT_BACK_ID = modalBackFaceDefinitionId(MODAL_INSTANT_BACK_PROBE_ID);
/** CR 712.12 — a LAND back face, from the catalogue: Witch Enchanter //
 *  Witch-Blessed Meadow. */
const WITCH_ENCHANTER = "62061e7c-cf19-4f03-b8fa-2bdba62d6b0b";

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};
type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
};
type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string }[];
};
type Ctx = Parameters<typeof runMutation>[1];

const runAnnounceCast = (
    ctx: Ctx,
    args: Omit<AnnounceCastArgs, "gameId" | "playerId">
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

const runSelectTarget = (
    ctx: Ctx,
    args: Omit<SelectTargetArgs, "gameId" | "playerId">
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

const runTapForPayment = (ctx: Ctx, landIds: string[]) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            payments: landIds.map((cardInstanceId) => ({ cardInstanceId })),
        }
    );

const land = (cardId: string, id: string) =>
    makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });

/** p1 holds `cardId` with a Plains, a Mountain and three Forests — enough for
 *  either face of either probe, so the lands that end up TAPPED say which
 *  face was paid for. p2 has a Hill Giant to aim at. */
function position(cardId: string): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(cardId, {
                        id: "mdfc",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    land(plains().id, "plains0"),
                    land(mountain().id, "mountain0"),
                    ...[0, 1, 2].map((i) => land(forest().id, `forest${i}`)),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(hillGiant().id, {
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
}

const tappedIds = (state: GameState) =>
    state.players[0].battlefield
        .filter((c) => c.isTapped)
        .map((c) => c.id)
        .sort();

const cardIdOf = (c: CardInstanceState) => (c.card as { id?: string }).id;

describe("CR 712.11b — the back face is a cast option BESIDE the front", () => {
    it("offers the back face of a nonland-backed card, at the back face's cost", () => {
        const state = position(MODAL_CREATURE_BACK_PROBE_ID);
        const options = independentCastOptionsFor(state.players[0].hand[0]);
        expect(options.map((o) => o.id)).toEqual([
            modalBackCastAltCostId(modalCreatureBackProbe),
        ]);
        expect(options[0].mana).toEqual({ X: 2, G: 1 });
    });

    it("offers NO cast of a land back face (CR 305.1 — it is played, CR 712.12)", () => {
        const state = position(WITCH_ENCHANTER);
        expect(tryGetDefinition(WITCH_ENCHANTER)?.backFace?.types).toContain(
            "Land"
        );
        expect(independentCastOptionsFor(state.players[0].hand[0])).toEqual([]);
    });
});

describe("announceCast of a modal BACK face (CR 712.11b, issue #7200)", () => {
    it("a creature back face goes on the stack as that face and resolves back face up", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(position(MODAL_CREATURE_BACK_PROBE_ID)),
        ]);
        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "mdfc",
            alternativeCostId: modalBackCastAltCostId(modalCreatureBackProbe),
        });
        await runTapForPayment(harness.ctx, ["forest0", "forest1", "forest2"]);

        const onStack = harness.state();
        expect(onStack.stack).toHaveLength(1);
        // CR 712.8f — on the stack, only the face that's up.
        const item = onStack.stack[0];
        expect(cardIdOf(item)).toBe(CREATURE_BACK_ID);
        expect(item.types).toEqual(["Creature"]);
        expect(item.power).toBe(4);
        // CR 712.11c — the {2}{G} back face was the price, not the {W} front.
        expect(tappedIds(onStack)).toEqual(["forest0", "forest1", "forest2"]);
        // SURFACE — the client sees the back face, through the projection.
        const projectedStack = projectPublicState(onStack, 1, "p1");
        expect(cardIdOf(projectedStack.stack[0] as CardInstanceState)).toBe(
            CREATURE_BACK_ID
        );

        resolveTopOfStack(onStack);
        const permanent = onStack.players[0].battlefield.find(
            (c) => c.id === "mdfc"
        )!;
        // CR 712.8f — "a modal double-faced permanent … has only the
        // characteristics of the face that's up."
        expect(cardIdOf(permanent)).toBe(CREATURE_BACK_ID);
        expect(permanent.transformed).toBe(true);
        expect(permanent.power).toBe(4);
        expect(permanent.toughness).toBe(4);
        expect(permanent.staticAbilities).toContain("trample");
        const projected = projectPublicState(onStack, 1, "p1");
        const seen = projected.players[0].battlefield.find(
            (c) => c.id === "mdfc"
        )!;
        expect(cardIdOf(seen as CardInstanceState)).toBe(CREATURE_BACK_ID);
    });

    it("the front face is still the printed cast, at the front's cost", async () => {
        // The discriminating pair: a seam that always cast the back face
        // would pass the test above on its own.
        const harness = makeMutationCtx("p1", [
            gameStateSeed(position(MODAL_CREATURE_BACK_PROBE_ID)),
        ]);
        await runAnnounceCast(harness.ctx, { cardInstanceId: "mdfc" });
        await runTapForPayment(harness.ctx, ["plains0"]);
        const after = harness.state();
        expect(cardIdOf(after.stack[0])).toBe(MODAL_CREATURE_BACK_PROBE_ID);
        expect(after.stack[0].transformed).toBeUndefined();
        expect(tappedIds(after)).toEqual(["plains0"]);
    });

    it("an instant back face targets as that face, and is its FRONT face in the graveyard", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(position(MODAL_INSTANT_BACK_PROBE_ID)),
        ]);
        await runAnnounceCast(harness.ctx, {
            cardInstanceId: "mdfc",
            alternativeCostId: modalBackCastAltCostId(modalInstantBackProbe),
        });
        // CR 712.11c — the target requirement asked for is the back face's
        // ("any target"); the front face, a 2/2 creature, has none.
        expect(harness.state().pendingTarget).toBeDefined();
        await runSelectTarget(harness.ctx, {
            targetType: "permanent",
            targetId: "giant",
        });
        await runTapForPayment(harness.ctx, ["mountain0"]);

        const state = harness.state();
        expect(cardIdOf(state.stack[0])).toBe(INSTANT_BACK_ID);
        expect(state.stack[0].types).toEqual(["Instant"]);
        expect(tappedIds(state)).toEqual(["mountain0"]);

        resolveTopOfStack(state);
        const giant = state.players[1].battlefield.find(
            (c) => c.id === "giant"
        );
        // The back face's effect ran: 3 damage on the 3/3, marked or already
        // lethal (CR 704.5g) depending on whether SBAs ran in between.
        expect(giant === undefined || giant.damageMarked === 3).toBe(true);
        // CR 712.8a — in the graveyard it has only its front face's
        // characteristics: the 2/2 Soldier, not the Instant.
        const inGraveyard = state.players[0].graveyard.find(
            (c) => c.id === "mdfc"
        )!;
        expect(cardIdOf(inGraveyard)).toBe(MODAL_INSTANT_BACK_PROBE_ID);
        expect(inGraveyard.transformed).toBeUndefined();
        expect(inGraveyard.transformedFrom).toBeUndefined();
        expect(inGraveyard.types).toEqual(["Creature"]);
        expect(inGraveyard.power).toBe(2);
    });
});
