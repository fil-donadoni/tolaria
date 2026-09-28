// The Weight Fit report reads a Minimal Pair as one unit (issue #4794, PRD
// #4792, ADR 0148).
//
// `minimalPairFitOutcomes` and `formatMinimalPairSection` (`verdicts/fit.ts`)
// take a complete Minimal Pair's two verdicts and read them against whichever
// Eval Pairs the caller hands in as ONE argument — both halves satisfied,
// one, neither, or not fitted at all — rather than as two loose constraints.
// Fixture: the canonical instant-in-main / instant-at-opponent's-end-step
// pair (ADR 0148's own worked example).
//
// The satisfaction bar is `report.ts`'s own ordering bar (`SATISFIED_EPS`,
// strictly positive) — the SAME bar a re-derived `VerdictReport`'s
// `satisfied`/`violated` use, since `minimalPairFitOutcomes` is meant to read
// exactly that report's `pairs`, not the fit's own `FIT_MARGIN`-scaled
// first-order outcomes.
import { describe, expect, it } from "vitest";
import {
    SATISFIED_EPS,
    formatMinimalPairSection,
    formatPromotionReport,
    minimalPairFitOutcomes,
    minimalPairTally,
    verdictIdOf,
    type Discriminant,
    type MinimalPairFitOutcome,
    type PromotionPlan,
    type Verdict,
} from "../verdicts";

const STEP: Discriminant = { kind: "step", detail: "opponent's end step" };
const ABOVE = SATISFIED_EPS * 10;
const BELOW = -SATISFIED_EPS * 10;

const candidates = [
    { key: '{"kind":"pass"}', description: "pass, holding up the instant" },
    { key: '{"kind":"cast-spell"}', description: "cast the instant now" },
];

/** A full `Verdict`, id computed the same way the store does. */
function makeVerdict(
    judgement: Omit<Verdict, "id" | "author" | "createdAt" | "source">
): Verdict {
    return {
        ...judgement,
        id: verdictIdOf(judgement),
        author: "test:author",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "authored",
    };
}

/** "Don't cast the instant in your own main phase" — wrong NOW, not always. */
const anchor = makeVerdict({
    spec: { cards: [], phase: "PRECOMBAT_MAIN", turn: 1 },
    seat: "me",
    candidates,
    answer: { kind: "forbidden", forbiddenIndexes: [1] },
    classification: { kind: "conditional", discriminant: STEP },
});

/** The right-hand half: casting it AT the opponent's end step is right. */
const half = makeVerdict({
    spec: { cards: [], phase: "END_STEP", turn: 1 },
    seat: "me",
    candidates,
    answer: { kind: "right", rightIndexes: [1] },
    pairOf: { anchorId: anchor.id, discriminant: STEP },
});

describe("minimalPairFitOutcomes reads a Minimal Pair as one unit (issue #4794)", () => {
    it("finds the one complete pair among the two verdicts, both satisfied", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                { verdictId: anchor.id, delta: ABOVE },
                { verdictId: half.id, delta: ABOVE },
            ]
        );
        expect(outcomes).toEqual([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchor: "satisfied",
                half: "satisfied",
            },
        ]);
    });

    it("reads ONE satisfied when only the anchor clears the bar — the fit learned 'never', not 'not now'", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                { verdictId: anchor.id, delta: ABOVE },
                { verdictId: half.id, delta: BELOW },
            ]
        );
        expect(outcomes[0]).toMatchObject({
            anchor: "satisfied",
            half: "unsatisfied",
        });
    });

    it("reads ONE satisfied the other way when only the half clears the bar", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                { verdictId: anchor.id, delta: BELOW },
                { verdictId: half.id, delta: ABOVE },
            ]
        );
        expect(outcomes[0]).toMatchObject({
            anchor: "unsatisfied",
            half: "satisfied",
        });
    });

    it("a verdict is satisfied only when EVERY pair it yielded clears the bar", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                // The anchor yields two pairs here (a third candidate would
                // do it for real; this asserts the AND without building one).
                { verdictId: anchor.id, delta: ABOVE },
                { verdictId: anchor.id, delta: BELOW },
                { verdictId: half.id, delta: ABOVE },
            ]
        );
        expect(outcomes[0].anchor).toBe("unsatisfied");
    });

    it("a verdict absent from the pairs handed in reads as NOT FITTED, never as satisfied or unsatisfied — the timing-pair shape", () => {
        // Neither half yields a pair here: exactly what a TIMING pair looks
        // like (`evalPairs.ts`) — the fit never scores "pass" against a
        // deferrable action, so ADR 0148's own worked example never reaches
        // `pairs` at all. Reading that as "unsatisfied" would flag it "look
        // at the board" for a pair the fit was never asked about.
        const outcomes = minimalPairFitOutcomes([anchor, half], []);
        expect(outcomes[0]).toMatchObject({
            anchor: "not-fitted",
            half: "not-fitted",
        });
    });

    it("one half not fitted and the other satisfied is still NOT read as 'one satisfied'", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [{ verdictId: anchor.id, delta: ABOVE }]
        );
        expect(outcomes[0]).toMatchObject({
            anchor: "satisfied",
            half: "not-fitted",
        });
    });

    it("skips a verdict with no classification and one with no complete half", () => {
        const unclassified = makeVerdict({
            spec: { cards: [], phase: "PRECOMBAT_MAIN", turn: 9 },
            seat: "me",
            candidates,
            answer: { kind: "right", rightIndexes: [0] },
        });
        const orphanAnchor = makeVerdict({
            spec: { cards: [], phase: "PRECOMBAT_MAIN", turn: 10 },
            seat: "me",
            candidates,
            answer: { kind: "forbidden", forbiddenIndexes: [1] },
            classification: {
                kind: "conditional",
                discriminant: { kind: "card", detail: "Terror" },
            },
        });
        const outcomes = minimalPairFitOutcomes(
            [anchor, half, unclassified, orphanAnchor],
            [
                { verdictId: anchor.id, delta: ABOVE },
                { verdictId: half.id, delta: ABOVE },
                { verdictId: unclassified.id, delta: ABOVE },
                { verdictId: orphanAnchor.id, delta: ABOVE },
            ]
        );
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0].anchorId).toBe(anchor.id);
    });
});

describe("minimalPairTally (issue #4794 review — shared by the section and the Promotion headline)", () => {
    it("counts each shape once, not-fitted kept apart from unsatisfied", () => {
        const pairs: MinimalPairFitOutcome[] = [
            {
                anchorId: "a1",
                halfId: "h1",
                discriminant: STEP,
                anchor: "satisfied",
                half: "satisfied",
            },
            {
                anchorId: "a2",
                halfId: "h2",
                discriminant: STEP,
                anchor: "satisfied",
                half: "unsatisfied",
            },
            {
                anchorId: "a3",
                halfId: "h3",
                discriminant: STEP,
                anchor: "unsatisfied",
                half: "unsatisfied",
            },
            {
                anchorId: "a4",
                halfId: "h4",
                discriminant: STEP,
                anchor: "not-fitted",
                half: "not-fitted",
            },
        ];
        expect(minimalPairTally(pairs)).toEqual({
            both: 1,
            one: 1,
            neither: 1,
            notFitted: 1,
        });
    });
});

describe("formatMinimalPairSection (issue #4794)", () => {
    it("names the Discriminant no term reads when one half is satisfied", () => {
        const text = formatMinimalPairSection([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchor: "satisfied",
                half: "unsatisfied",
            },
        ]);
        expect(text).toContain("both satisfied         : 0");
        expect(text).toContain("one satisfied          : 1");
        expect(text).toContain("neither satisfied      : 0");
        expect(text).toContain("not fitted             : 0");
        expect(text).toContain(
            "Discriminant no term reads: step: opponent's end step"
        );
        expect(text).toContain("step       1");
    });

    it("counts unsatisfied pairs by Discriminant kind and lists 'other' phrases verbatim with counts", () => {
        const other: Discriminant = {
            kind: "other",
            detail: "the graveyard is already full of removal",
        };
        const text = formatMinimalPairSection([
            {
                anchorId: "a1",
                halfId: "h1",
                discriminant: STEP,
                anchor: "satisfied",
                half: "unsatisfied",
            },
            {
                anchorId: "a2",
                halfId: "h2",
                discriminant: other,
                anchor: "unsatisfied",
                half: "unsatisfied",
            },
            {
                anchorId: "a3",
                halfId: "h3",
                discriminant: other,
                anchor: "unsatisfied",
                half: "unsatisfied",
            },
        ]);
        expect(text).toContain("step       1");
        expect(text).toContain("other      2");
        expect(text).toContain("2x  the graveyard is already full of removal");
    });

    it("flags a pair with NEITHER half satisfied for a look at the board, separately from a missing term", () => {
        const text = formatMinimalPairSection([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchor: "unsatisfied",
                half: "unsatisfied",
            },
        ]);
        expect(text).toContain("neither satisfied      : 1");
        expect(text).toContain(
            `Minimal Pairs with NEITHER half satisfied (1) — a look at the board, not a missing term`
        );
        // Not read as "one satisfied" — the two are reported separately.
        expect(text).not.toContain("Discriminant no term reads");
    });

    it("reports a not-fitted pair on its own, excluded from the unsatisfied-by-kind tally", () => {
        const text = formatMinimalPairSection([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchor: "not-fitted",
                half: "not-fitted",
            },
        ]);
        expect(text).toContain("not fitted             : 1");
        expect(text).toContain(
            "unsatisfied Minimal Pairs by Discriminant kind (0)"
        );
        expect(text).toContain(
            "Minimal Pairs NOT FITTED (1) — a timing pair or a rebuild error; the search checks these, never the fit"
        );
        // A not-fitted pair is not "neither satisfied — a look at the board":
        // the fit never rejected it, it never saw it.
        expect(text).not.toContain("NEITHER half satisfied");
        expect(text).not.toContain("Discriminant no term reads");
    });

    it("prints nothing under 'other' phrases and no by-kind row when every pair is satisfied", () => {
        const text = formatMinimalPairSection([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchor: "satisfied",
                half: "satisfied",
            },
        ]);
        expect(text).toContain(
            "unsatisfied Minimal Pairs by Discriminant kind (0)"
        );
        expect(text).toContain("(none)");
        expect(text).not.toContain("other Discriminant phrases");
    });
});

describe("the Promotion delta carries the Minimal Pair section (issue #4794)", () => {
    const plan: PromotionPlan = {
        lock: { verdictIds: [], packHash: "0".repeat(64) },
        entries: [],
        added: [],
        dropped: [],
        noop: false,
    };

    it("prints the headline count and the full section beside the unsatisfied pairs", () => {
        const text = formatPromotionReport({
            plan,
            lockedBefore: 0,
            newPairs: [],
            unsatisfied: [],
            minimalPairs: [
                {
                    anchorId: anchor.id,
                    halfId: half.id,
                    discriminant: STEP,
                    anchor: "satisfied",
                    half: "unsatisfied",
                },
            ],
            movement: [],
        });
        expect(text).toContain(
            "minimal pairs          : 1 (both 0 / one 1 / neither 0 / not fitted 0)"
        );
        expect(text).toContain(
            "Minimal Pairs (1) — both halves satisfied / one / neither / not fitted (ADR 0148)"
        );
        expect(text).toContain(
            "Discriminant no term reads: step: opponent's end step"
        );
    });
});
