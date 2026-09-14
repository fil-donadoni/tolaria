// Full-path integration for the BARE numeric nomination (CR 107.1b, issue
// #1421): GRE -> game.ts -> wire projection.
//
//   107.1b  Most of the time, the Magic game uses only integers... If a player
//           is asked to choose a number, they must choose a non-negative
//           integer unless the effect says otherwise.
//
// The Op has no shipping card yet — Void waits on issue #2150's hand-zone
// access, and a half card is never shipped (PRD #1063). So the subject is a
// registered synthetic DSL sorcery, the `dash.test.ts` precedent for an engine
// capability whose consumer has not landed: it proves the SEAMS, which is what
// a card would prove anyway.
//
// Everything runs through the REAL seams — `pushSpell` / `resolveTopOfStack`
// for the suspension, the REGISTERED `submitNumberChoice` `_handler` over the
// stub `MutationCtx` for the answer, and `projectPublicState` for the surface
// assertion. A hand-built view would prove nothing about what the client
// actually receives.

import { describe, it, expect } from "vitest";
import { submitNumberChoice } from "../game";
import { resolveTopOfStack, numberChoiceRange } from "../gre/state";
import type { GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { makePlayer, makeState, pushSpell } from "../cards/__tests__/setup";
import { registerTokenDefinition } from "../cards";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type NumberChoiceArgs = {
    gameId: Id<"games">;
    playerId: string;
    amount: number;
};

const runSubmitNumberChoice = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<NumberChoiceArgs, "gameId">
) =>
    runMutation<NumberChoiceArgs, void>(
        submitNumberChoice as unknown as Handler<NumberChoiceArgs, void>,
        ctx,
        { gameId: GAME_ID, ...args }
    );

/** "Choose a number. You gain that much life." — the minimal shape that makes
 *  the nominated value observable on the board, so an amount that never
 *  reached the reading Op cannot pass. */
const OPEN_ID = "test-fullpath-choosenumber-open";
registerTokenDefinition({
    id: OPEN_ID,
    name: OPEN_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "chooseNumber",
            player: "controller",
            prompt: "Choose a number",
            bind: "$n",
        },
        { op: "gainLife", player: "controller", amount: { ref: "$n" } },
    ],
});

/** The same, with an authored floor of 2 — the one bound an open nomination
 *  can still carry. */
const FLOORED_ID = "test-fullpath-choosenumber-floored";
registerTokenDefinition({
    id: FLOORED_ID,
    name: FLOORED_ID,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "chooseNumber",
            player: "controller",
            prompt: "Choose a number",
            min: 2,
            bind: "$n",
        },
        { op: "gainLife", player: "controller", amount: { ref: "$n" } },
    ],
});

/** p1 with `pool` floating, the script on the stack, resolved down to the
 *  suspended nomination. The pool is deliberately non-empty: a BARE nomination
 *  must be unaffected by it, and a regression that reused the paying sibling's
 *  ceiling would cap the answer at its size. */
function suspended(defId: string, pool: Record<string, number>): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { manaPool: pool }), makePlayer("p2")],
    });
    pushSpell(state, defId, "p1");
    resolveTopOfStack(state);
    return state;
}

describe("chooseNumber through the real mutation (CR 107.1b, issue #1421)", () => {
    it("suspends OPEN-ENDED and accepts an amount far above the pool, spending nothing", async () => {
        const state = suspended(OPEN_ID, { W: 2 });
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("number-pick");
        expect(head.playerId).toBe("p1");
        expect(head.paysMana).toBeUndefined();
        // CR 107.1b — "any number" is unbounded above; the pool is not a
        // ceiling for a nomination that pays nothing.
        expect(numberChoiceRange(head, state.players[0])).toEqual({
            min: 0,
            max: Number.POSITIVE_INFINITY,
        });

        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 11 });

        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(after.players[0].manaPool.W).toBe(2); // nothing paid
        expect(after.players[0].life).toBe(31); // the reading Op got 11
        expect(after.stack).toHaveLength(0);

        // SURFACE (the reducer, not a hand-built view): the prompt is gone
        // from what the client is shown, and the life total the nomination
        // produced is the projected one.
        const projected = projectPublicState(after, 1, "p1");
        expect(projected.pendingChoices ?? []).toHaveLength(0);
        expect(projected.players[0].life).toBe(31);
    });

    it("carries the open range to BOTH seats' projections, with no answer to leak", async () => {
        const state = suspended(FLOORED_ID, {});
        for (const seat of ["p1", "p2"] as const) {
            const view = projectPublicState(state, 1, seat);
            const head = view.pendingChoices![0];
            expect(head.kind).toBe("number-pick");
            expect(head.prompt).toBe("Choose a number");
            // The floor survives the projection — the client renders the
            // affordance off exactly this — and the ceiling still reads open.
            expect(
                numberChoiceRange(
                    head,
                    view.players.find((p) => p.id === "p1")
                )
            ).toEqual({ min: 2, max: Number.POSITIVE_INFINITY });
        }
        // Nothing nominated yet, so nothing committed for the opponent to read
        // out of the resolving item (issues #1977 / #1982).
        expect(
            projectPublicState(state, 1, "p2").stack[0].collectedChoices ?? {}
        ).toEqual({});
    });

    it("the mutation enforces the authored FLOOR, and the window stays answerable", async () => {
        const state = suspended(FLOORED_ID, {});
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 1 })
        ).rejects.toThrow(/at least 2/);
        // A refused submission must never freeze the window (ADR 0047).
        expect(stub.state().pendingChoices).toHaveLength(1);
        await runSubmitNumberChoice(stub.ctx, { playerId: "p1", amount: 2 });
        expect(stub.state().players[0].life).toBe(22);
    });

    it("refuses the nomination from the seat that does not own the choice", async () => {
        const state = suspended(OPEN_ID, {});
        const stub = makeMutationCtx("p2", [gameStateSeed(state)]);
        await expect(
            runSubmitNumberChoice(stub.ctx, { playerId: "p2", amount: 3 })
        ).rejects.toThrow();
        expect(stub.state().pendingChoices).toHaveLength(1);
    });
});
