// Casting the BACK face of a modal double-faced card from a zone other than
// the hand (CR 712.11b / 712.11c, issue #7398).
//
// CR 712.11c — "only the face that will be face up on the stack is evaluated
// to determine if it can be cast." That splits the licences for a non-hand
// cast in two, and this suite drives one of each through the legality gate
// (`getLegalActions`) and the real `announceCast` mutation:
//
//   * a GENERIC permission names the card and no characteristic of it — a
//     per-card graveyard grant, a graveyard play permission (Yawgmoth's
//     Will), an impulse or free exile grant, Bolas's Citadel's library top —
//     so the back face, evaluated alone, is still covered;
//   * an ability of the FRONT face — flashback, escape, retrace, the
//     intrinsic "you may cast this card from your graveyard", madness,
//     foretell — is one the back face does not have, so it licenses the
//     front face only.
//
// The gate is discriminated by TIMING: the instant-back probe is a {1}{W}
// creature // {R} instant, and p1 holds priority in p2's main phase, where
// only the back face is castable at all (CR 302.1 / 304.1).

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget, tapForPayment } from "../game";
import { tryGetDefinition } from "../cards";
import { modalBackFaceDefinitionId } from "../cards/modalDfc";
import { modalBackCastAltCostId } from "../gre/modalBackCast";
import { getLegalActions } from "../gre/rules";
import { castOptionAlternativeCosts } from "../gre/castPermissions";
import type { CardInstanceState, GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    MODAL_CREATURE_BACK_PROBE_ID,
    MODAL_INSTANT_BACK_PROBE_ID,
    modalCreatureBackProbe,
} from "../gre/__tests__/fixtures/modalBackProbe.fixture";
import {
    FRONT_FACE,
    GENERIC,
    inExile,
    inGraveyard,
    mdfcOf,
    position,
    yawgmothsWill,
} from "./modalBackNonHandPositions.fixture";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};
type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent";
    targetId: string;
};
type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string }[];
};
type Ctx = Parameters<typeof runMutation>[1];

const runAnnounceCast = (ctx: Ctx, alternativeCostId?: string) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "mdfc",
            ...(alternativeCostId ? { alternativeCostId } : {}),
        }
    );
const runSelectTarget = (ctx: Ctx, targetId: string) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", targetType: "permanent", targetId }
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

const cardIdOf = (c: CardInstanceState) => (c.card as { id?: string }).id;
const backAltOf = (cardId: string) =>
    modalBackCastAltCostId(tryGetDefinition(cardId)!);
const tappedIds = (state: GameState) =>
    state.players[0].battlefield
        .filter((c) => c.isTapped)
        .map((c) => c.id)
        .sort();

describe("CR 712.11c — a generic permission reaches the back face", () => {
    it.each(GENERIC)(
        "$name: the gate offers the instant back face off sorcery timing",
        ({ cardId, place }) => {
            const state = position(cardId, place);
            const card = mdfcOf(state);
            expect(getLegalActions(state, state.players[0], card)).toContain(
                "cast"
            );
        }
    );

    it.each(GENERIC)(
        "$name: announceCast puts the back face on the stack",
        async ({ cardId, place }) => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(position(cardId, place)),
            ]);
            await runAnnounceCast(harness.ctx, backAltOf(cardId));
            await runSelectTarget(harness.ctx, "giant");
            if (harness.state().stack.length === 0) {
                await runTapForPayment(harness.ctx, ["mountain0"]);
            }
            const stack = harness.state().stack;
            expect(stack).toHaveLength(1);
            expect(cardIdOf(stack[0])).toBe(modalBackFaceDefinitionId(cardId));
            expect(stack[0].types).toEqual(["Instant"]);
        }
    );
});

describe("CR 712.11c — an ability of the FRONT face does not reach the back face", () => {
    // Madness is the one front-face licence with no timing gate (CR 702.35a
    // — the window is instant-speed), so its front face is castable here and
    // the gate cannot tell the faces apart; `announceCast` below can.
    it.each(FRONT_FACE.filter((row) => row.ability !== "madness"))(
        "$name: the gate refuses — only the sorcery-speed front face is licensed",
        ({ cardId, place }) => {
            const state = position(cardId, place);
            const card = mdfcOf(state);
            expect(
                getLegalActions(state, state.players[0], card)
            ).not.toContain("cast");
            // The discriminating half: the licence itself works — on p1's
            // own turn the front face is castable from there.
            const own = position(cardId, place, "p1");
            expect(getLegalActions(own, own.players[0], mdfcOf(own))).toContain(
                "cast"
            );
        }
    );

    it.each(FRONT_FACE)(
        "$name: announceCast refuses the back face",
        async ({ cardId, place }) => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(position(cardId, place, "p1")),
            ]);
            await expect(
                runAnnounceCast(harness.ctx, backAltOf(cardId))
            ).rejects.toThrow(/CR 712\.11c/);
            expect(harness.state().stack).toHaveLength(0);
        }
    );
});

describe("CR 712.11c — what the back face pays outside the hand", () => {
    it("a free exile grant waives the back face's own mana cost", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                position(
                    MODAL_INSTANT_BACK_PROBE_ID,
                    inExile({ castFromExileWithoutPayingManaCost: true })
                )
            ),
        ]);
        await runAnnounceCast(
            harness.ctx,
            backAltOf(MODAL_INSTANT_BACK_PROBE_ID)
        );
        await runSelectTarget(harness.ctx, "giant");
        const state = harness.state();
        expect(state.stack).toHaveLength(1);
        expect(tappedIds(state)).toEqual([]);
    });

    it("Bolas's Citadel charges the BACK face's mana value in life", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                position(MODAL_CREATURE_BACK_PROBE_ID, GENERIC[4].place, "p1")
            ),
        ]);
        const life = harness.state().players[0].life;
        await runAnnounceCast(
            harness.ctx,
            modalBackCastAltCostId(modalCreatureBackProbe)
        );
        const state = harness.state();
        expect(cardIdOf(state.stack[0])).toBe(
            modalBackFaceDefinitionId(MODAL_CREATURE_BACK_PROBE_ID)
        );
        // {2}{G} — mana value 3, not the {W} front face's 1.
        expect(state.players[0].life).toBe(life - 3);
        expect(tappedIds(state)).toEqual([]);
    });

    it("a filtered graveyard permission is asked of the back face itself", async () => {
        // Lurrus's shape: a permanent spell with mana value 2 or less, once
        // per turn. The {W} front face (MV 1) is covered; the {2}{G} back
        // face (MV 3) is not, and CR 712.11c evaluates only the face cast.
        const lurrus = (state: GameState, card: CardInstanceState) => {
            inGraveyard()(state, card);
            state.graveyardPlayPermissionThisTurn = [
                {
                    actions: ["cast"],
                    cardTypes: ["Creature"],
                    maxManaValue: 2,
                    oncePerTurn: true,
                    sourceId: "lurrus",
                    playerId: "p1",
                },
            ];
        };
        const backId = modalBackCastAltCostId(modalCreatureBackProbe);
        const filtered = position(MODAL_CREATURE_BACK_PROBE_ID, lurrus, "p1");
        expect(
            castOptionAlternativeCosts(
                filtered,
                filtered.players[0],
                mdfcOf(filtered),
                "graveyard"
            ).map((alt) => alt.id)
        ).not.toContain(backId);
        const harness = makeMutationCtx("p1", [gameStateSeed(filtered)]);
        await expect(runAnnounceCast(harness.ctx, backId)).rejects.toThrow(
            /CR 712\.11c/
        );
        // The discriminating half: an unfiltered permission offers it.
        const open = position(
            MODAL_CREATURE_BACK_PROBE_ID,
            (state, card) => {
                inGraveyard()(state, card);
                yawgmothsWill(state);
            },
            "p1"
        );
        expect(
            castOptionAlternativeCosts(
                open,
                open.players[0],
                mdfcOf(open),
                "graveyard"
            ).map((alt) => alt.id)
        ).toContain(backId);
    });
});
