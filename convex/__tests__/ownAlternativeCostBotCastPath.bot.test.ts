// Issue #4900 — the Bot's pitch-evoke cast, end to end across the
// GRE → game.ts boundary (CR 118.9 / 702.74a / 601.2h).
//
// `own-alternative-cost-cast.bot.test.ts` pins the enumerator and the search's
// own payment. This drives what the executor and the driver then SEND: the
// enumerated Move's `announceCast` (with its `alternativeCostId`) through the
// registered mutation's handler, the hand-leg park the server raises, and the
// owed-payment seam's answer to it (`pickForOwedPayment` →
// `selectCastAlternativeHandCost`). It asserts the live game ends where the
// search predicted it would: the same card exiled, the spell on the stack,
// evoked. A drift between the two pickers is a Bot that values pitching one
// card and then pitches another.
//
// Harness: the stub `MutationCtx` (`gameMutationHarness.fixture.ts`), the seam
// `alurenCastPath.test.ts` established.

import { describe, expect, it } from "vitest";
import { announceCast, selectCastAlternativeHandCost } from "../game";
import { solitude } from "../cards/sets/mh2/white.cards";
import { savannahLions, serraAngel } from "../cards/sets/lea/white.cards";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../gre/moves";
import { applyMoveForSearch } from "../gre/applyMove";
import { nextOwedPayment } from "../gre/owedPayment";
import { pickForOwedPayment } from "../gre/paymentPicks";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

/** p1 has no lands and holds Solitude plus TWO white cards, so the evoke's
 *  "exile a white card" is a real choice: the server parks it rather than
 *  auto-resolving it. p2's Grizzly Bears gives Solitude's ETB a target — an
 *  evoke with none is pruned (`evokeCastIsWasteful`). */
function pitchState(): GameState {
    const inHand = (id: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    inHand("solitude", solitude().id),
                    inHand("angel", serraAngel().id),
                    inHand("lions", savannahLions().id),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};
type HandCostArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceIds: string[];
};

describe("Bot pitch-evoke cast, GRE → game.ts (issue #4900, CR 118.9 / 702.74a)", () => {
    it("the live cast exiles the card the search charged and puts an evoked Solitude on the stack", async () => {
        const state = pitchState();
        const move = enumerateMoves(state, "p1").find(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "solitude"
        );
        expect(move?.alternativeCostId).toBe("evoke");
        expect(move?.tapPlan).toEqual([]);

        // What the search believes the cast costs.
        const predicted = applyMoveForSearch(state, "p1", move!);
        const predictedExile = predicted.players[0].exile.map((c) => c.id);
        expect(predictedExile).toEqual(["lions"]);

        // What the executor sends (`executeMove`'s cast-spell branch): the
        // announcement with the chosen alternative cost, no targets, no taps.
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<AnnounceArgs, void>(
            announceCast as unknown as Handler<AnnounceArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "solitude",
                alternativeCostId: move!.alternativeCostId,
            }
        );

        // The hand leg is parked; the driver's owed-payment seam answers it.
        const parked = harness.state();
        const owed = nextOwedPayment(parked, "p1");
        expect(owed?.kind).toBe("cast:alternativeCostHandChoice");
        const submission = pickForOwedPayment(parked, "p1", owed!);
        expect(submission?.mutation).toBe("selectCastAlternativeHandCost");
        if (submission?.mutation !== "selectCastAlternativeHandCost") return;
        await runMutation<HandCostArgs, void>(
            selectCastAlternativeHandCost as unknown as Handler<
                HandCostArgs,
                void
            >,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceIds: submission.cardInstanceIds,
            }
        );

        const after = harness.state();
        const p1 = after.players[0];
        expect(after.pendingCast).toBeUndefined();
        expect(p1.exile.map((c) => c.id)).toEqual(predictedExile);
        expect(p1.hand.map((c) => c.id)).toEqual(["angel"]);
        expect(after.stack.map((s) => s.id)).toEqual(["solitude"]);
        expect(after.stack[0].evoked).toBe(true);
    });
});
