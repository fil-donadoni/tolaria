// Full-path integration: the Miracle reveal and cast (CR 702.94a) driven
// through the REGISTERED `game.ts` mutations over the stub `MutationCtx`
// (`gameMutationHarness.fixture.ts`) — `submitMiracleReveal` answers the
// private reveal window, `submitResolutionChoice` answers the linked
// trigger's Cast/Decline — with the state each one saves re-read and
// projected for both seats, the way the clients see it.

import { describe, it, expect } from "vitest";
import { submitMiracleReveal, submitResolutionChoice } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import { registerTokenDefinition, getCardByName } from "../cards";
import { resolveTopOfStack } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import type { EffectOp } from "../cards/types";
import type { Id } from "../_generated/dataModel";
import { compiledDevastationTide } from "../oracle/__tests__/devastationTide.fixture";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const ISLAND = getCardByName("Island").id;
const BEARS = getCardByName("Balduvian Bears").id;

const TIDE_ID = "test-miracle-path-devastation-tide";
registerTokenDefinition({
    ...compiledDevastationTide(),
    id: TIDE_ID,
    rarity: "rare",
});
const DRAW_ID = "test-miracle-path-draw";
registerTokenDefinition({
    id: DRAW_ID,
    name: DRAW_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 } as EffectOp],
});

/** p1 resolves a draw spell with Devastation Tide on top: the first draw of
 *  the turn, so the resolution parks on the private reveal window. */
function windowOpen() {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(TIDE_ID, {
                        id: "tide",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
                battlefield: [0, 1].map((i) =>
                    makeInstance(ISLAND, {
                        id: `island-${i}`,
                        ownerId: "p1",
                        controllerId: "p1",
                        zone: "battlefield",
                    })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(BEARS, {
                        id: "p2-bears",
                        ownerId: "p2",
                        controllerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
    });
    pushSpell(state, DRAW_ID, "p1");
    resolveTopOfStack(state);
    return state;
}

describe("Miracle through game.ts (CR 702.94a / 608.2g)", () => {
    it("reveal → linked trigger → Cast for the miracle cost → the spell resolves", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(windowOpen())]);
        expect(stub.state().pendingChoices?.[0].kind).toBe("miracle-reveal");

        await runMutation(submitMiracleReveal, stub.ctx, {
            gameId: GAME_ID,
            playerId: "p1",
            reveal: true,
        });
        const afterReveal = stub.state();
        // The trigger is on the stack, visible to BOTH seats; the card is
        // now known to the opponent.
        expect(afterReveal.stack).toHaveLength(1);
        const oppView = projectPublicState(afterReveal, 2, "p2");
        expect(oppView.stack).toHaveLength(1);
        expect(
            oppView.players[0].hand.some((c) => c !== null && c.id === "tide")
        ).toBe(true);

        // Both pass; the trigger resolves to its Cast/Decline offer.
        resolveTopOfStack(afterReveal);
        const offer = afterReveal.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        const stub2 = makeMutationCtx("p1", [gameStateSeed(afterReveal, 3)]);
        await runMutation(submitResolutionChoice, stub2.ctx, {
            gameId: GAME_ID,
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        const cast = stub2.state();
        expect(cast.stack.map((s) => (s.card as { id?: string }).id)).toEqual([
            TIDE_ID,
        ]);
        expect(
            cast.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(2); // {1}{U}
        resolveTopOfStack(cast);
        expect(cast.players[1].hand.map((c) => c.id)).toContain("p2-bears");
    });

    it("declining through the mutation leaves the card hidden and the stack empty", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(windowOpen())]);
        await runMutation(submitMiracleReveal, stub.ctx, {
            gameId: GAME_ID,
            playerId: "p1",
            reveal: false,
        });
        const after = stub.state();
        expect(after.stack).toHaveLength(0);
        expect(
            projectPublicState(after, 2, "p2").players[0].hand.every(
                (c) => c === null
            )
        ).toBe(true);
    });

    it("refuses an answer from the seat that does not owe the window", async () => {
        const stub = makeMutationCtx("p2", [gameStateSeed(windowOpen())]);
        await expect(
            runMutation(submitMiracleReveal, stub.ctx, {
                gameId: GAME_ID,
                playerId: "p2",
                reveal: true,
            })
        ).rejects.toThrow();
    });
});
