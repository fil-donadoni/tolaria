// CR 704.3 / CR 608.2 (issue #2478) — no state-based-action sweep runs while a
// resolution is suspended on a Pending Choice: that moment is not a priority
// window. The sweep waits for the answer. The CR 704.5j legend drain and the
// as-enters finalize (which sweeps with choices still queued, CR 707.6) are
// unaffected.
import { describe, expect, it } from "vitest";
import { passPriority, submitResolutionChoice } from "../../game";
import { projectPublicState } from "../../gameProjections";
import type { Id } from "../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards/index";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { sweepUnlessResolutionSuspended } from "../pendingChoiceResume";
import { refreshExpectedInput } from "../expectedInput";
import { checkStateBasedActions } from "../sba";
import { resolveTopOfStack, type GameState } from "../state";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";

const GAME_ID = "game-1" as Id<"games">;
const traumaticCritique = getDefinition("2a812fa7-4599-4e25-97db-20ffc6bc0b26");
const jasmineBoreal = getDefinition("db6ef678-4ce9-48d6-aa4f-2afd9a1ad724");

const zoneOf = (state: GameState, id: string): string | undefined => {
    for (const p of state.players) {
        if (p.battlefield.some((c) => c.id === id)) return "battlefield";
        if (p.graveyard.some((c) => c.id === id)) return "graveyard";
    }
    return undefined;
};

/** Traumatic Critique (X damage to any target, draw two, discard one) aimed at
 *  a 2/2 with X = 2: the first Op marks lethal damage, the discard `choice`
 *  suspends the resolution. Both players have passed once. */
function critiqueAtBears(): GameState {
    const lib = [0, 1].map((i) =>
        makeInstance(grizzlyBears().id, {
            id: `lib${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    const hand = makeInstance(grizzlyBears().id, {
        id: "h0",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const victim = makeInstance(grizzlyBears().id, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { library: lib, hand: [hand] }),
            makePlayer("p2", { battlefield: [victim] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const item = pushSpell(state, traumaticCritique.id, "p1", [
        { type: "permanent", id: "victim" },
    ]);
    item.chosenX = 2;
    state.passCount = 1;
    refreshExpectedInput(state);
    return state;
}

describe("a suspended resolution is not a priority window (CR 704.3 / 608.2)", () => {
    it("passPriority: the lethally damaged creature stays visible while the discard prompt is open, and dies on the answer", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(critiqueAtBears())]);
        await runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            passPriority as unknown as Handler<never, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );

        const suspended = stub.state();
        const head = suspended.pendingChoices![0];
        expect(head.kind).toBeDefined();
        // Surface assertion: through the real reducer the client reads.
        const view = projectPublicState(suspended, 1, "p2");
        expect(view.players[1].battlefield.some((c) => c.id === "victim")).toBe(
            true
        );
        expect(zoneOf(suspended, "victim")).toBe("battlefield");

        await runMutation<Record<string, unknown>, void>(
            submitResolutionChoice as unknown as Handler<
                Record<string, unknown>,
                void
            >,
            stub.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h0"],
            }
        );
        expect(zoneOf(stub.state(), "victim")).toBe("graveyard");
        expect(stub.state().pendingChoices).toBeUndefined();
    });

    it("the post-answer sweep is skipped while a further choice is queued, and runs once it completes", () => {
        const state = critiqueAtBears();
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        sweepUnlessResolutionSuspended(state);
        expect(zoneOf(state, "victim")).toBe("battlefield");

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        sweepUnlessResolutionSuspended(state);
        expect(zoneOf(state, "victim")).toBe("graveyard");
    });
});

describe("CR 704.5j legend drain with the post-answer sweep gated", () => {
    it("two separate same-name legendary pairs resolve one prompt at a time and terminate", () => {
        const legend = (id: string, controller: string) =>
            makeInstance(jasmineBoreal.id, {
                id,
                controllerId: controller,
                ownerId: controller,
            });
        // The legend rule is per controller (CR 704.5j): one pair each.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [legend("a1", "p1"), legend("a2", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [legend("b1", "p2"), legend("b2", "p2")],
                }),
            ],
        });
        checkStateBasedActions(state);

        let guard = 0;
        while ((state.pendingChoices?.length ?? 0) > 0) {
            if (++guard > 4) throw new Error("legend drain did not terminate");
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [head.candidateIds![0]],
            });
            sweepUnlessResolutionSuspended(state);
        }
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield).toHaveLength(1);
    });
});

describe("trigger-placement prompts are not a suspended resolution (CR 117.5 / 603.3b)", () => {
    it("a player at 0 life loses even while the controller still owes a trigger ordering", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: -2 })],
        });
        state.pendingChoices = [
            {
                stackItemId: "trigger-batch",
                step: 0,
                choiceId: "trigger-order-p1",
                playerId: "p1",
                kind: "trigger-order",
                candidateIds: ["t1", "t2"],
                count: 2,
                prompt: "Order your triggered abilities.",
            },
        ];
        sweepUnlessResolutionSuspended(state);
        expect(state.gameOver).toBeTruthy();
    });
});
