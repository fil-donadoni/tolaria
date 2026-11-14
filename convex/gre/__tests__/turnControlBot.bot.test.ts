// The Bot under Turn Control (CR 723.5, ADR 0181).
//
// Two seams, both read through the Acting Player map: the rollout policy's
// notion of whose interest a mover serves (`selectRolloutMove`), which is what
// `controlledSeatPick` rides, and the server's forced advance, which must act
// AS the seat the Bot answers for and stay silent for a seat it does not.
import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/build";
import { findBladeScenario } from "../ai/blade/registry";
import { runBladeScenario } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { botOwedWindow, forceAdvanceOwedInput } from "../forceAdvance";
import { enumerateMoves } from "../moves";
import { makeRng } from "../rng";
import { controlledSeatPick, selectRolloutMove } from "../search";
import type { GameState } from "../state";

/** The opponent's turn, controlled by "me": they hold a Lightning Bolt, a
 *  Mountain to pay for it, and the only creature on the board. */
const BOLT_POSITION: BladeScenario = {
    label: "turn control bot test — the opponent's Bolt",
    spec: {
        cards: [
            { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            { name: "Mountain", owner: "opp", zone: "battlefield" },
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Mountain", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 6,
        activePlayer: "opp",
        priority: "opp",
        turnControl: { controlled: "opp", controller: "me" },
        landCount: 0,
        libraryCount: 20,
    },
    bot: "me",
    budget: { iterations: 1 },
    tier: "must",
    expect: { predicate: () => true, describe: "unused" },
};

function position(): { state: GameState; me: string; opp: string } {
    const state = buildBladeState(BOLT_POSITION);
    return { state, me: state.players[0].id, opp: state.players[1].id };
}

const boltTarget = (
    move: ReturnType<typeof controlledSeatPick>
): { type: string; id: string } | undefined =>
    move?.kind === "cast-spell" ? move.targets?.[0] : undefined;

describe("controlledSeatPick (CR 723.5)", () => {
    it("plays the controlled seat's cards in the CONTROLLER's interest", () => {
        const { state, me, opp } = position();
        for (const seed of [1, 2, 3]) {
            const move = controlledSeatPick(state, opp, me, seed);
            // The opponent's own Bears: the only permanent a Bolt can hit.
            expect(boltTarget(move)?.type).toBe("permanent");
        }
    });

    it("returns null when the seat owes no decision", () => {
        const { state, me, opp } = position();
        expect(controlledSeatPick(state, me, me, 1)).toBeNull();
        state.gameOver = { winnerId: me, loserId: opp, reason: "life" };
        expect(controlledSeatPick(state, opp, me, 1)).toBeNull();
    });
});

describe("the registry's Turn Control positions", () => {
    // The two `must` entries, run exactly as the blade shards run them, so the
    // proof that breaks the rollout policy's interest reds THEM too.
    it.each([
        "turn control: spends the controlled player's turn instead of developing their board",
        "turn control: turns the controlled player's removal on their own creature",
    ])("%s", (label) => {
        const scenario = findBladeScenario(label);
        expect(scenario).toBeDefined();
        const result = runBladeScenario(scenario!);
        expect(result.failureMessage).toBe("");
        expect(result.ok).toBe(true);
    });
});

describe("selectRolloutMove — a mover's interest is its Acting Player's (CR 723.5)", () => {
    it("the same seat, the same moves: controlled, it is played against itself; free, for itself", () => {
        const { state, me, opp } = position();
        const moves = enumerateMoves(state, opp);

        const controlled = selectRolloutMove(state, opp, me, moves, makeRng(1));
        expect(boltTarget(controlled)?.type).toBe("permanent");

        // No Turn Control: the opponent is an opponent again, and a competent
        // one does not burn its own creature.
        state.turnControls = undefined;
        const free = selectRolloutMove(state, opp, me, moves, makeRng(1));
        expect(boltTarget(free)?.type).not.toBe("permanent");
    });
});

describe("forceAdvanceOwedInput under Turn Control (CR 723.5, 723.6)", () => {
    it("the controlling Bot owes the controlled seat's window and declines it AS that seat", () => {
        const { state, me, opp } = position();
        expect(botOwedWindow(state, me)?.input).toEqual({
            kind: "priority",
            playerId: opp,
        });
        const result = forceAdvanceOwedInput(state, me);
        expect(result.outcome).toBe("advanced");
        expect(result.steps.map((s) => s.action)).toEqual(["pass"]);
        // It was the controlled seat that passed: priority is now the Bot's.
        expect(result.state.priorityPlayerId).toBe(me);
        expect(result.state.gameOver).toBeUndefined();
    });

    it("a controlled Bot owes nothing: its own seat's window is another player's to answer", () => {
        const { state, opp } = position();
        // Read from the CONTROLLED seat's side: `opp` is the Bot here.
        expect(botOwedWindow(state, opp)).toBeNull();
        const result = forceAdvanceOwedInput(state, opp);
        expect(result.steps).toEqual([]);
        expect(result.state.priorityPlayerId).toBe(opp);
    });
});
