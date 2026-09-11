import { describe, it, expect } from "vitest";
import type { EvalTerms, PositionBreakdown } from "@convex/gre";
import { ROOT_DECISION_MECHANISMS } from "@convex/gre/ai/decisionTelemetry";
import { EVAL_TERM_LABELS, EVAL_TERM_ORDER } from "../eval-term-labels";
import {
    MECHANISM_SENTENCES,
    NO_DIFFERENCE_PHRASE,
    MAX_COMPARISON_PHRASES,
    comparePositions,
    isSearchMechanism,
    significantDeltas,
} from "../decision-phrases";

/**
 * The plain-language half of the AI decision box (issue #3404, PRD #3397).
 *
 * What this guards is the reading a TESTER gets. The numeric trace is already
 * covered by the search's own tests; what nothing covered is whether the words
 * beside them say the right thing — and a comparison that names the wrong term,
 * or silently drops one, is worse than no comparison, because it reads as
 * evidence.
 *
 * Breakdowns are hand-built: the assertion is about the mapping from a delta to
 * a sentence, and a real `evaluateBreakdown` would make the deltas incidental.
 */

const ZERO_TERMS: EvalTerms = {
    life: 0,
    hand: 0,
    creatures: 0,
    permanents: 0,
    mana: 0,
    manaDevelopment: 0,
    flexibility: 0,
    library: 0,
    graveyard: 0,
    graveyardReach: 0,
};

/** A breakdown whose named terms carry the given values and whose every other
 *  term is zero, on both sides. */
function breakdown(
    self: Partial<EvalTerms> = {},
    opp: Partial<EvalTerms> = {}
): PositionBreakdown {
    return {
        self: { ...ZERO_TERMS, ...self },
        opp: { ...ZERO_TERMS, ...opp },
        margin: 0,
        danger: 0,
        total: 0,
    };
}

/** One floor's worth of a term — the smallest difference that earns a phrase.
 *
 *  Every fixture below places its deltas at a clear MULTIPLE of this rather
 *  than exactly on it: a threshold compared with `>=` is decided by float
 *  representation at the boundary (`10 * f - 9 * f` is not always `f`), and a
 *  test riding that boundary asserts the rounding, not the wording. */
function unit(key: keyof EvalTerms): number {
    return EVAL_TERM_LABELS[key].floor;
}

describe("mechanism sentences (issue #3404)", () => {
    it("gives every root mechanism exactly one sentence", () => {
        // `Record<RootDecisionMechanism, string>` is the primary guard (tsc).
        // This is its runtime twin, for the same reason `eval-term-labels` has
        // one: vitest transpiles, it does not typecheck.
        expect(Object.keys(MECHANISM_SENTENCES).sort()).toEqual(
            [...ROOT_DECISION_MECHANISMS].sort()
        );
        for (const m of ROOT_DECISION_MECHANISMS) {
            expect(MECHANISM_SENTENCES[m].length).toBeGreaterThan(0);
        }
    });

    it("names no engine vocabulary a tester would have to look up", () => {
        // The box exists because `OUTCOME_EPS` / "argmax" / "root edge" are
        // exactly what a tester cannot read. A sentence that leaks one is a
        // sentence that failed at its only job.
        const jargon = [
            "argmax",
            "OUTCOME_EPS",
            "epsilon",
            "root edge",
            "ISMCTS",
            "rollout",
            "mean reward",
        ];
        for (const m of ROOT_DECISION_MECHANISMS) {
            const sentence = MECHANISM_SENTENCES[m].toLowerCase();
            for (const word of jargon) {
                expect(sentence).not.toContain(word.toLowerCase());
            }
        }
    });

    it("separates the search's own picks from the tie-breaks that override it", () => {
        expect(isSearchMechanism("mean-reward")).toBe(true);
        expect(isSearchMechanism("material-tiebreak")).toBe(true);
        expect(isSearchMechanism("hold-trick")).toBe(false);
        expect(isSearchMechanism("free-development")).toBe(false);
    });
});

describe("comparison phrases (issue #3404)", () => {
    it("reads a negative creature delta as losing a creature", () => {
        const chosen = breakdown({ creatures: 6 * unit("creatures") });
        const alternative = breakdown({ creatures: 4 * unit("creatures") });
        expect(comparePositions(chosen, alternative)).toEqual([
            "loses a creature",
        ]);
    });

    it("reads the same delta the other way as gaining one", () => {
        const chosen = breakdown({ creatures: 4 * unit("creatures") });
        const alternative = breakdown({ creatures: 6 * unit("creatures") });
        expect(comparePositions(chosen, alternative)).toEqual([
            "gains a creature",
        ]);
    });

    it("attributes a delta on the opponent's terms to the opponent", () => {
        const chosen = breakdown({}, { creatures: 6 * unit("creatures") });
        const alternative = breakdown({}, { creatures: 4 * unit("creatures") });
        expect(comparePositions(chosen, alternative)).toEqual([
            "opponent loses a creature",
        ]);
    });

    it("says the position is much the same when nothing clears its floor", () => {
        const chosen = breakdown({ creatures: 100, life: 40 });
        const alternative = breakdown({
            creatures: 100 + unit("creatures") * 0.9,
            life: 40 - unit("life") * 0.9,
        });
        expect(comparePositions(chosen, alternative)).toEqual([
            NO_DIFFERENCE_PHRASE,
        ]);
    });

    it("ranks by how many floors a term moved, not by raw points", () => {
        // Life is measured in single-digit weights and creatures in Forge-scale
        // hundreds, so a raw-points ranking would put "loses a creature" first
        // on any pair at all — the creature delta is ~30 points against life's
        // ~32 for FOUR points of life. Ranked in floors, the life swing (4) is
        // the bigger move and reads first.
        const chosen = breakdown({ creatures: 500, life: 20 * unit("life") });
        const alternative = breakdown({
            creatures: 500 - 2 * unit("creatures"),
            life: 16 * unit("life"),
        });
        expect(comparePositions(chosen, alternative)).toEqual([
            "takes damage",
            "loses a creature",
        ]);
    });

    it("caps the reading at three phrases", () => {
        const chosen = breakdown({
            creatures: 1000,
            hand: 1000,
            life: 1000,
            mana: 1000,
            permanents: 1000,
        });
        const alternative = breakdown({
            creatures: 1000 - 9 * unit("creatures"),
            hand: 1000 - 8 * unit("hand"),
            life: 1000 - 7 * unit("life"),
            mana: 1000 - 6 * unit("mana"),
            permanents: 1000 - 5 * unit("permanents"),
        });
        const phrases = comparePositions(chosen, alternative);
        expect(phrases).toHaveLength(MAX_COMPARISON_PHRASES);
        expect(phrases).toEqual([
            "loses a creature",
            "spends a card",
            "takes damage",
        ]);
    });

    it("finds a difference on every term the evaluator has", () => {
        // The drift this mirrors is `eval-term-labels`' own (issue #2686): a
        // term added to `EvalTerms` and described nowhere renders as silence,
        // and silence in a comparison reads as "these positions are alike".
        for (const key of EVAL_TERM_ORDER) {
            const chosen = breakdown({ [key]: 10 * unit(key) });
            const alternative = breakdown({ [key]: 8 * unit(key) });
            const deltas = significantDeltas(chosen, alternative);
            expect(deltas.map((d) => d.key)).toEqual([key]);
            expect(comparePositions(chosen, alternative)).toEqual([
                EVAL_TERM_LABELS[key].loss,
            ]);
        }
    });
});
