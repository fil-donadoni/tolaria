/**
 * The 1-ply policy probe settles a choice the OPPONENT owns (issue #4896).
 *
 * `policyProbeState` resolves the mover's own announcement one resolution
 * deep, and settles a resolution that suspends on a Pending Choice (CR 608.2)
 * so the probe sees the effect and not the cost alone. It used to settle only
 * the MOVER's own choices: a spell whose resolution asks the opponent — an
 * edict's sacrifice (CR 701.21a), a discard the opponent picks (CR 701.9b) —
 * was scored mid-resolution, the card spent and the mana tapped and none of
 * the effect, so the rollout policy never cast one and every Eval Pair the
 * Weight Fit reads priced it below passing.
 *
 * The opponent's answer is now taken as the one WORST for the mover among the
 * candidates the search would consider (`choiceCandidates`): a lower bound on
 * what the announcement buys, never a guess in the mover's favour.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { cloneGameState } from "../../clone";
import { enumerateMoves, type Move } from "../../moves";
import {
    applyMoveInSearch,
    policyProbeState,
    policyValue,
    settleStackForBreakdown,
} from "../../search";
import { resolveTopOfStack } from "../../state";
import { buildPositionFromSpec } from "../blade/build";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

type SpecCard = ScenarioSpec["cards"][number];

function position(cards: SpecCard[]): GameState {
    return buildPositionFromSpec({
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    });
}

function moveOf(state: GameState, pick: (m: Move) => boolean): Move {
    const me = state.activePlayerId;
    const move = enumerateMoves(state, me).find(pick);
    if (!move) throw new Error("no such move in this position");
    return move;
}

/** The exact number the rollout policy and the Eval Pair bridge read. */
function policyOf(state: GameState, pick: (m: Move) => boolean): number {
    const me = state.activePlayerId;
    const move = moveOf(state, pick);
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, me, move);
    return policyValue(probe, me, move, DEFAULT_EVAL_WEIGHTS, me);
}

const isPass = (m: Move) => m.kind === "pass";

/** Cast `name` AT THE OPPONENT: a player-targeted spell also enumerates a
 *  cast at its own caster, which is a different move. */
function castOf(state: GameState, name: string): (m: Move) => boolean {
    const id = getCardByName(name).id;
    const card = state.players
        .flatMap((p) => p.hand)
        .find((c) => (c.card as { id?: string }).id === id);
    if (!card) throw new Error(`${name} is not in a hand`);
    const opp = state.players.find((p) => p.id !== state.activePlayerId)!.id;
    return (m) =>
        m.kind === "cast-spell" &&
        m.cardInstanceId === card.id &&
        (m.targets ?? []).every((t) => t.type !== "player" || t.id === opp);
}

const angel: SpecCard = {
    name: "Serra Angel",
    owner: "opp",
    zone: "battlefield",
    summoningSick: false,
};
const twoCardHand: SpecCard[] = [
    { name: "Grizzly Bears", owner: "opp", zone: "hand" },
    { name: "Hill Giant", owner: "opp", zone: "hand" },
];

const ROWS: { spell: string; opponent: SpecCard[] }[] = [
    { spell: "Chainer's Edict", opponent: [angel] },
    { spell: "Mind Rot", opponent: twoCardHand },
    { spell: "Innocent Blood", opponent: [angel] },
];

describe("Eval Pairs — an own spell whose resolution asks the opponent (issue #4896)", () => {
    for (const { spell, opponent } of ROWS) {
        it(`${spell} cast beats passing: the probe sees the opponent's answer, not the cost alone`, () => {
            const s = position([
                { name: spell, owner: "me", zone: "hand" },
                ...opponent,
            ]);
            expect(policyOf(s, castOf(s, spell))).toBeGreaterThan(
                policyOf(s, isPass)
            );
        });
    }
});

describe("the opponent's answer is settled, adversarially", () => {
    it("the probe finishes the resolution: nothing on the stack, no choice queued", () => {
        const s = position([
            { name: "Mind Rot", owner: "me", zone: "hand" },
            ...twoCardHand,
        ]);
        const me = s.activePlayerId;
        const move = moveOf(s, castOf(s, "Mind Rot"));
        const probe = cloneGameState(s);
        applyMoveInSearch(probe, me, move);
        const settled = policyProbeState(probe, move, DEFAULT_EVAL_WEIGHTS, me);
        expect(settled.stack).toHaveLength(0);
        expect(settled.pendingChoices?.length ?? 0).toBe(0);
        expect(settled.players[1].hand).toHaveLength(0);
    });

    it("takes the answer WORST for the mover: an edict costs the opponent its least valuable creature", () => {
        const s = position([
            { name: "Chainer's Edict", owner: "me", zone: "hand" },
            angel,
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ]);
        const me = s.activePlayerId;
        const move = moveOf(s, castOf(s, "Chainer's Edict"));
        const probe = cloneGameState(s);
        applyMoveInSearch(probe, me, move);
        const settled = policyProbeState(probe, move, DEFAULT_EVAL_WEIGHTS, me);
        expect(settled.stack).toHaveLength(0);
        const oppBoard = settled.players[1].battlefield.map(
            (c) => (c.card as { id?: string }).id
        );
        expect(oppBoard).toContain(getCardByName("Serra Angel").id);
        expect(oppBoard).not.toContain(getCardByName("Grizzly Bears").id);
    });

    it("a discard sheds the opponent's least valuable cards: it keeps its best", () => {
        const s = position([
            { name: "Mind Rot", owner: "me", zone: "hand" },
            ...twoCardHand,
            { name: "Serra Angel", owner: "opp", zone: "hand" },
        ]);
        const me = s.activePlayerId;
        const move = moveOf(s, castOf(s, "Mind Rot"));
        const probe = cloneGameState(s);
        applyMoveInSearch(probe, me, move);
        const settled = policyProbeState(probe, move, DEFAULT_EVAL_WEIGHTS, me);
        expect(settled.stack).toHaveLength(0);
        expect(
            settled.players[1].hand.map((c) => (c.card as { id?: string }).id)
        ).toEqual([getCardByName("Serra Angel").id]);
    });

    it("every other settle caller still stops at the opponent's choice", () => {
        const s = position([
            { name: "Chainer's Edict", owner: "me", zone: "hand" },
            angel,
        ]);
        const me = s.activePlayerId;
        const move = moveOf(s, castOf(s, "Chainer's Edict"));
        const mid = cloneGameState(s);
        applyMoveInSearch(mid, me, move);
        resolveTopOfStack(mid);
        expect(mid.pendingChoices?.[0]?.playerId).not.toBe(me);
        const report = { complete: true };
        const stopped = settleStackForBreakdown(
            cloneGameState(mid),
            me,
            DEFAULT_EVAL_WEIGHTS,
            0,
            undefined,
            0,
            report
        );
        expect(report.complete).toBe(false);
        expect(stopped.stack).toHaveLength(1);
    });
});
