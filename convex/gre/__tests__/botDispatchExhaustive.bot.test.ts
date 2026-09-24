// Bot dispatch exhaustiveness (issue #4441, PRD #4437). Every Move kind the
// search can be handed is either applied or refused LOUDLY — never a silent
// no-op that leaves a choice at the queue head and spins the playout on it
// (ADR 0047: the Bot never freezes and never ignores).
//
// The compile-time half is the `assertNever` tail on each dispatch: removing
// an arm reds `check:ts`. This file pins the runtime half — the two Move kinds
// the search applier used to fall through on, and the tails themselves when a
// value the type never admitted reaches them.
import { describe, expect, it } from "vitest";
import { applyMoveInSearch } from "../search";
import type { Move } from "../moves";
import type { PendingChoice } from "../state";
import { makeState } from "../../cards/__tests__/setup";
import { moveCardRefs } from "../ai/interchangeable";
import { isProbeEligibleMove } from "../ai/dominance";
import { heuristicChoicePrior } from "../ai/choicePriors";

const UNADMITTED = { kind: "not-a-move-kind" } as unknown as Move;

describe("applyMoveInSearch — the two Brain-answered Move kinds (issue #4441)", () => {
    it("refuses a name-card Move loudly instead of applying nothing", () => {
        const state = makeState();
        expect(() =>
            applyMoveInSearch(state, "p1", {
                kind: "name-card",
                cardName: "Plains",
            })
        ).toThrow(/"name-card" is answered by the Brain, never in-tree/);
    });

    it("refuses a mulligan-bottom Move loudly instead of applying nothing", () => {
        const state = makeState();
        expect(() =>
            applyMoveInSearch(state, "p1", {
                kind: "mulligan-bottom",
                stackItemId: "s",
                step: 0,
                choiceId: "p1",
                cardInstanceIds: [],
            })
        ).toThrow(/"mulligan-bottom" is answered by the Brain, never in-tree/);
    });
});

describe("assertNever tails refuse a kind the type never admitted (issue #4441)", () => {
    it("search applier", () => {
        expect(() => applyMoveInSearch(makeState(), "p1", UNADMITTED)).toThrow(
            /Unhandled Move kind in applyMoveInSearch/
        );
    });

    it("interchangeability card-ref rewrite", () => {
        expect(() => moveCardRefs(UNADMITTED)).toThrow(
            /Unhandled Move kind in mapMoveCardRefs/
        );
    });

    it("dominance probe eligibility", () => {
        expect(() =>
            isProbeEligibleMove(makeState(), "p1", UNADMITTED)
        ).toThrow(/Unhandled Move kind in isProbeEligibleMove/);
    });

    it("choice prior", () => {
        const choice = {
            kind: "not-a-choice-kind",
            playerId: "p1",
        } as unknown as PendingChoice;
        expect(() =>
            heuristicChoicePrior(makeState(), choice, {
                move: { kind: "may-pay", accept: true } as Move,
            })
        ).toThrow(/Unhandled PendingChoiceKind in heuristicChoicePrior/);
    });
});
