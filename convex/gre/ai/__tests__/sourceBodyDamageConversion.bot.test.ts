// Issue #3376 — the two halves of the risk-free-attack fix.
//
// `costShrinksSource` / `isSourceBodyDamageConversion`: a ping paid out of
// the source's own body (counters that ARE its power/toughness) is dropped
// from the rollout's ε draw and the tree below the root. A counter that is not
// part of the body (a spore counter) is not a shrink.
//
// `rollout(…, since)`: a WON leaf pays for the game time it took, so a sooner
// win outranks a later one (reward only — the margin stays material).
// CR 500.1 (the turn's steps), CR 704.5a (a player at 0 life loses).

import { describe, expect, it } from "vitest";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import {
    applyMoveInSearch,
    isSourceBodyDamageConversion,
    rollout,
} from "../../search";
import { cloneGameState } from "../../clone";
import { makeRng } from "../../rng";
import { PHASE_ORDER } from "../../phases";
import type { GameState } from "../../state";
import { costShrinksSource, effectiveAbilityOf } from "../abilityTiming";
import { buildBladeBaseState } from "../blade/baseState";
import { instanceIdsForName } from "../blade/matcher";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

type Counters = Record<string, number>;

function position(name: string, counters: Counters) {
    const base = buildBladeBaseState();
    const meId = base.players[0]!.id;
    const state = buildStateFromScenario(
        base,
        {
            cards: [
                {
                    name,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        meId
    );
    const oppId = state.players.find((p) => p.id !== meId)!.id;
    const [sourceId] = instanceIdsForName(state, name);
    const source = state.players
        .find((p) => p.id === meId)!
        .battlefield.find((c) => c.id === sourceId)!;
    // The ping aimed at the opponent's face — the variant the ε draw kept
    // drawing.
    const shot = enumerateMoves(state, meId).find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === source.id &&
            m.targets?.some((t) => t.id === oppId) === true
    );
    expect(shot, `${name} offers a shot at the opponent`).toBeDefined();
    return { state, meId, oppId, source, shot: shot! };
}

describe("costShrinksSource (issue #3376)", () => {
    it("a +1/+1 counter paid off a counter-bodied creature shrinks it", () => {
        const { state, source, shot } = position("Walking Ballista", {
            "+1/+1": 2,
        });
        const ability = effectiveAbilityOf(source, shot.abilityId)!;
        expect(costShrinksSource(state, source, ability)).toBe(true);
    });

    it("the LAST such counter — the source dies (CR 704.5f) — shrinks it", () => {
        const { state, source, shot } = position("Walking Ballista", {
            "+1/+1": 1,
        });
        const ability = effectiveAbilityOf(source, shot.abilityId)!;
        expect(costShrinksSource(state, source, ability)).toBe(true);
    });

    it("spore counters are not the body: no shrink", () => {
        const { state, source, shot } = position("Thorn Thallid", {
            spore: 3,
        });
        const ability = effectiveAbilityOf(source, shot.abilityId)!;
        expect(costShrinksSource(state, source, ability)).toBe(false);
    });
});

describe("isSourceBodyDamageConversion — where the prune applies (issue #3376)", () => {
    it("prunes the bot's own body-funded shot on an empty stack", () => {
        const { state, meId, shot } = position("Walking Ballista", {
            "+1/+1": 2,
        });
        expect(isSourceBodyDamageConversion(state, meId, meId, shot)).toBe(
            true
        );
    });

    it("keeps the OPPONENT's shot in the tree", () => {
        const { state, meId, oppId, shot } = position("Walking Ballista", {
            "+1/+1": 2,
        });
        expect(isSourceBodyDamageConversion(state, meId, oppId, shot)).toBe(
            false
        );
    });

    it("keeps a shot made in response — a non-empty stack", () => {
        const { state, meId, shot } = position("Walking Ballista", {
            "+1/+1": 2,
        });
        // The first shot on the stack; one +1/+1 counter left to shoot again
        // in response to it.
        applyMoveInSearch(state, meId, shot);
        expect(state.stack.length).toBeGreaterThan(0);
        expect(isSourceBodyDamageConversion(state, meId, meId, shot)).toBe(
            false
        );
    });

    it("keeps a shot paid in counters that are not the body", () => {
        const { state, meId, shot } = position("Thorn Thallid", { spore: 3 });
        expect(isSourceBodyDamageConversion(state, meId, meId, shot)).toBe(
            false
        );
    });
});

describe("rollout(…, since) — a sooner win outranks a later one (issue #3376)", () => {
    const leafAt = (lose: "opp" | "me", since?: GameState) => {
        const { state, meId, oppId } = position("Walking Ballista", {
            "+1/+1": 2,
        });
        const loser = lose === "opp" ? oppId : meId;
        state.players.find((p) => p.id === loser)!.life = 0;
        const clock = since && {
            turn: since.turn,
            step: PHASE_ORDER.indexOf(since.phase),
        };
        return rollout(
            cloneGameState(state),
            meId,
            makeRng(1),
            DEFAULT_EVAL_WEIGHTS,
            clock
        );
    };
    const clockOf = (turn: number) =>
        ({ turn, phase: "PRECOMBAT_MAIN" }) as GameState;

    it("a win now scores the plain leaf; a win a turn later scores lower", () => {
        const plain = leafAt("opp");
        const now = leafAt("opp", clockOf(5));
        const later = leafAt("opp", clockOf(4));
        expect(now).toEqual(plain);
        expect(later.reward).toBeLessThan(now.reward);
        // Still a win: above every open leaf (CR 704.5a).
        expect(later.reward).toBeGreaterThanOrEqual(
            1 - DEFAULT_EVAL_WEIGHTS.terminalBand
        );
        // The tie-break margin stays pure material.
        expect(later.margin).toBe(now.margin);
    });

    it("a loss is untouched by the clock", () => {
        expect(leafAt("me", clockOf(4))).toEqual(leafAt("me"));
    });
});
