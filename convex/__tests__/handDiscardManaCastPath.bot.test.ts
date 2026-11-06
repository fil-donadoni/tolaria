// A "Discard your hand, Sacrifice this" mana ability paying for the spell it
// would otherwise discard (CR 601.2a / 601.2g), end to end across the
// GRE → game.ts boundary.
//
// CR 601.2g: mana abilities are activated with the spell already on the stack,
// so a hand holding only that spell discards nothing. The engine keeps the card
// in hand until the cast commits, which makes every layer here capable of
// getting it wrong on its own: the census hides the cast, the planner cannot
// name the source, the search leaves it on the battlefield, and the server's
// discard takes the spell with it.
//
// Harness: the stub `MutationCtx` (`gameMutationHarness.fixture.ts`).

import { describe, expect, it } from "vitest";
import { announceCast, tapForPayment } from "../game";
import { lionsEyeDiamond } from "../cards/sets/mir/colorless.cards";
import { plains } from "../cards/sets/lea/colorless.cards";
import { serraAngel } from "../cards/sets/lea/white.cards";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { projectPublicState } from "../gameProjections";
import { applyMoveForSearch } from "../gre/applyMove";
import { enumerateMoves, planManaPayment, type Move } from "../gre/moves";
import { getLegalActions } from "../gre/rules";
import { searchCastManaSpent } from "../gre/searchTapPlan";
import type { CardInstanceState, GameState, PlayerState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string; manaChoiceIndex?: number }[];
};

function owned(
    cardId: string,
    id: string,
    zone: "battlefield" | "hand"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
}

/** Two Plains and the Diamond on p1's battlefield, `hand` in p1's hand, in p1's
 *  precombat main with priority: {3}{W}{W} is payable only through the Diamond. */
function board(hand: CardInstanceState[]): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    owned(plains().id, "plains-a", "battlefield"),
                    owned(plains().id, "plains-b", "battlefield"),
                    owned(lionsEyeDiamond().id, "diamond", "battlefield"),
                ],
                hand,
            }),
            makePlayer("p2"),
        ],
    });
    state.phase = "PRECOMBAT_MAIN";
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    return state;
}

const angelOnly = () => board([owned(serraAngel().id, "angel", "hand")]);
const angelAndBears = () =>
    board([
        owned(serraAngel().id, "angel", "hand"),
        owned(grizzlyBears().id, "bears", "hand"),
    ]);

function castOfAngel(state: GameState): Extract<Move, { kind: "cast-spell" }> {
    const move = enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "angel"
    );
    if (!move) throw new Error("no cast-spell Move for the Angel");
    return move;
}

async function announce(
    harness: ReturnType<typeof makeMutationCtx>,
    cardInstanceId: string
): Promise<void> {
    await runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );
}

async function pay(
    harness: ReturnType<typeof makeMutationCtx>,
    payments: TapForPaymentArgs["payments"]
): Promise<void> {
    await runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        harness.ctx,
        { gameId: GAME_ID, playerId: "p1", payments }
    );
}

const ids = (cards: readonly { id: string }[]) => cards.map((c) => c.id).sort();

describe("a hand-discarding mana ability pays for the last card in hand (CR 601.2a / 601.2g)", () => {
    describe("the Move", () => {
        it("the census and the planner both reach it when the spell is the whole hand", () => {
            const state = angelOnly();
            const p1 = state.players[0];
            expect(getLegalActions(state, p1, p1.hand[0])).toContain("cast");
            expect(castOfAngel(state).tapPlan).toEqual([
                { cardInstanceId: "plains-a" },
                { cardInstanceId: "plains-b" },
                { cardInstanceId: "diamond", manaChoiceIndex: 0 },
            ]);
        });

        it("the castability gate survives the wire projection", () => {
            const projected = projectPublicState(angelOnly(), 1, "p1");
            const me = projected.players[0] as unknown as PlayerState;
            expect(
                getLegalActions(
                    projected as unknown as GameState,
                    me,
                    me.hand[0]
                )
            ).toContain("cast");
        });

        it("neither reaches it while the discard would cost another card", () => {
            const state = angelAndBears();
            const p1 = state.players[0];
            const angel = p1.hand[0];
            expect(getLegalActions(state, p1, angel)).not.toContain("cast");
            expect(
                planManaPayment(
                    state,
                    p1,
                    { X: 3, W: 2 },
                    {
                        cardInstanceId: angel.id,
                        cardDef: serraAngel(),
                    }
                )
            ).toBeNull();
        });

        it("an activation's plan does not reach it: no spell has left the hand", () => {
            const state = angelOnly();
            state.players[0].hand = [];
            expect(
                planManaPayment(state, state.players[0], { X: 3 })
            ).toBeNull();
        });

        it("the lands pay first: the source stays out of a plan they cover", () => {
            const state = angelOnly();
            for (const id of ["plains-c", "plains-d", "plains-e"]) {
                state.players[0].battlefield.push(
                    owned(plains().id, id, "battlefield")
                );
            }
            expect(
                castOfAngel(state).tapPlan.map((tap) => tap.cardInstanceId)
            ).not.toContain("diamond");
        });

        it("a colour only it makes reaches for it, one activation paying the whole cost", () => {
            const state = board([owned(grizzlyBears().id, "bears", "hand")]);
            const bears = enumerateMoves(state, "p1").find(
                (m): m is Extract<Move, { kind: "cast-spell" }> =>
                    m.kind === "cast-spell" && m.cardInstanceId === "bears"
            );
            // {1}{G}: index 4 is {G}{G}{G}, and its surplus pays the {1}.
            expect(bears?.tapPlan).toEqual([
                { cardInstanceId: "diamond", manaChoiceIndex: 4 },
            ]);
        });
    });

    describe("the search", () => {
        it("sacrifices the source rather than leaving it tapped on the battlefield (CR 701.21a)", () => {
            const state = angelOnly();
            const p1 = applyMoveForSearch(state, "p1", castOfAngel(state))
                .players[0];
            expect(ids(p1.battlefield)).not.toContain("diamond");
            expect(ids(p1.graveyard)).toEqual(["diamond"]);
            expect(p1.hand).toEqual([]);
        });

        it("reads the source's whole yield as mana the spell was paid with (CR 601.2h)", () => {
            const state = angelOnly();
            expect(
                searchCastManaSpent(state, "p1", castOfAngel(state).tapPlan)
            ).toEqual({ W: 5 });
        });
    });

    describe("the server", () => {
        it("the Move's own tap plan commits the spell and discards nothing", async () => {
            const state = angelOnly();
            const move = castOfAngel(state);
            const predicted = applyMoveForSearch(state, "p1", move);

            const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
            await announce(harness, "angel");
            expect(harness.state().pendingCast?.cardInstanceId).toBe("angel");
            await pay(harness, move.tapPlan);

            const after = harness.state();
            const p1 = after.players[0];
            expect(after.pendingCast).toBeUndefined();
            expect(after.stack.map((s) => s.id)).toEqual(["angel"]);
            expect(p1.hand).toEqual([]);
            expect(ids(p1.graveyard)).toEqual(["diamond"]);
            // The search's world and the live one agree on what the cast cost.
            expect(ids(p1.graveyard)).toEqual(
                ids(predicted.players[0].graveyard)
            );
        });

        it("a payment that does cost a card discards the rest of the hand, never the spell", async () => {
            // Five Plains clear the gate; the Diamond is then the player's own
            // pick of source, which is what makes the discard a real one.
            const state = angelAndBears();
            for (const id of ["plains-c", "plains-d", "plains-e"]) {
                state.players[0].battlefield.push(
                    owned(plains().id, id, "battlefield")
                );
            }
            const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
            await announce(harness, "angel");
            await pay(harness, [
                { cardInstanceId: "plains-a" },
                { cardInstanceId: "plains-b" },
                { cardInstanceId: "diamond", manaChoiceIndex: 0 },
            ]);

            const after = harness.state();
            const p1 = after.players[0];
            expect(after.stack.map((s) => s.id)).toEqual(["angel"]);
            expect(p1.hand).toEqual([]);
            expect(ids(p1.graveyard)).toEqual(["bears", "diamond"]);
        });
    });
});
