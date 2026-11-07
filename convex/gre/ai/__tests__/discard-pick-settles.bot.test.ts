// A mandatory hand pick its script discards is played out, and a loyalty minus
// with nothing to take is a no-op (issue #8480).
//
// Each player chooses the card, then discards it (CR 701.9b). The search has no
// decision node for that pick, so with no forced answer a line stopped there and
// was scored one Op into the resolution: the loyalty raised, no card gone, and
// no opposing turn. Liliana's plus read as free however much it threw away.
//
// A loyalty cost (CR 606.4) buys only the resolution, so a minus that resolves
// to nothing is dominated by `pass`. A plus is a payoff of its own.
//
// Cards are FIXTURES; nothing under test reads a card name.
import { describe, expect, it } from "vitest";
import { advanceToDecision, applyMoveInSearch, rollout } from "../../search";
import { enumerateMoves, type Move } from "../../moves";
import type { GameState, PendingChoice } from "../../state";
import { findBladeScenario } from "../blade/registry";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { forcedChoiceAnswer } from "../choiceCandidates";
import { isDominatedNoOpMove } from "../dominance";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { makeRng } from "../../rng";

const OWN_CARD =
    "discard: Liliana of the Veil holds her +1 when it only costs her own card";
const OPPONENT_CARDS =
    "discard: Liliana of the Veil takes a card with her +1 when her hand is empty";
const CASTABLE_PLAN =
    "standing resource: Liliana of the Veil keeps the Serra Angel and her loyalty";

function position(label: string): {
    state: GameState;
    bot: string;
    opp: string;
} {
    const state = buildBladeState(findBladeScenario(label)!);
    return {
        state,
        bot: seatPlayerId(state, "me"),
        opp: seatPlayerId(state, "opp"),
    };
}

function loyaltyMove(state: GameState, bot: string, abilityId: string): Move {
    const move = enumerateMoves(state, bot).find(
        (m) => m.kind === "activate-ability" && m.abilityId === abilityId
    );
    if (!move) throw new Error(`${abilityId} not offered`);
    return move;
}

/** Plays the plus off the stack, passing every priority it needs. */
function resolvePlus(state: GameState, bot: string): void {
    applyMoveInSearch(
        state,
        bot,
        loyaltyMove(state, bot, "liliana-veil-plus1")
    );
    for (let i = 0; i < 8 && state.stack.length > 0; i++) {
        const pid = advanceToDecision(state);
        if (!pid) break;
        applyMoveInSearch(state, pid, { kind: "pass" });
    }
}

function handSize(state: GameState, playerId: string): number {
    return state.players.find((p) => p.id === playerId)!.hand.length;
}

describe("a hand pick its script discards is played out (CR 701.9b)", () => {
    it("settles the plus on the Bot's own only card", () => {
        const { state, bot, opp } = position(OWN_CARD);
        resolvePlus(state, bot);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.stack).toEqual([]);
        expect(handSize(state, bot)).toBe(0);
        expect(handSize(state, opp)).toBe(0);
    });

    it("settles the plus on one card of the opponent's three", () => {
        const { state, bot, opp } = position(OPPONENT_CARDS);
        resolvePlus(state, bot);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(handSize(state, opp)).toBe(2);
    });

    it("carries a rollout to the Bot's next turn instead of stopping mid-resolution", () => {
        const { state, bot } = position(OWN_CARD);
        const turn = state.turn;
        applyMoveInSearch(
            state,
            bot,
            loyaltyMove(state, bot, "liliana-veil-plus1")
        );
        rollout(state, bot, makeRng(1), DEFAULT_EVAL_WEIGHTS);
        expect(state.turn).toBe(turn + 2);
        expect(state.activePlayerId).toBe(bot);
    });

    it("leaves a hand pick its script does not discard to the old stop", () => {
        const { state, bot } = position(OWN_CARD);
        const answer = forcedChoiceAnswer(state, {
            kind: "choose-hand-card",
            stackItemId: "absent",
            step: 0,
            choiceId: "c1",
            playerId: bot,
            zone: "hand",
            count: 1,
            prompt: "pick",
        } as PendingChoice);
        expect(answer).toBeNull();
    });
});

describe("a loyalty minus that does nothing is dominated (CR 606.4)", () => {
    const readAbility = (state: GameState, bot: string, abilityId: string) =>
        enumerateMoves(state, bot)
            .filter(
                (m) =>
                    m.kind === "activate-ability" && m.abilityId === abilityId
            )
            .map((m) => isDominatedNoOpMove(state, bot, m));

    it("proves the minus with no creature to take, never the plus", () => {
        const { state, bot } = position(CASTABLE_PLAN);
        expect(readAbility(state, bot, "liliana-veil-minus2")).toEqual([
            true,
            true,
        ]);
        expect(readAbility(state, bot, "liliana-veil-plus1")).toEqual([false]);
    });

    it("does not prove the minus while a player has a creature to give up", () => {
        const { state, bot, opp } = position(CASTABLE_PLAN);
        const body = state.players.find((p) => p.id === bot)!.hand[0];
        const opponent = state.players.find((p) => p.id === opp)!;
        opponent.battlefield.push({
            ...body,
            controllerId: opp,
            ownerId: opp,
        });
        const onOpponent = enumerateMoves(state, bot).find(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "liliana-veil-minus2" &&
                m.targets.some((t) => t.id === opp)
        );
        expect(onOpponent).toBeDefined();
        expect(isDominatedNoOpMove(state, bot, onOpponent!)).toBe(false);
    });
});
