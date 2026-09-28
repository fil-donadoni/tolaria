// The Weight Fit report reads a Minimal Pair as one unit (issue #4794, PRD
// #4792, ADR 0148).
//
// `minimalPairFitOutcomes` and `formatMinimalPairSection` (`verdicts/fit.ts`)
// take a complete Minimal Pair's two verdicts and read them against whichever
// Eval Pairs the caller hands in as ONE argument — both halves satisfied,
// one, or neither — rather than as two loose constraints. Fixture: the
// canonical instant-in-main / instant-at-opponent's-end-step pair (ADR 0148's
// own worked example).
import { describe, expect, it } from "vitest";
import {
    FIT_MARGIN,
    formatMinimalPairSection,
    minimalPairFitOutcomes,
    verdictIdOf,
    type Discriminant,
    type Verdict,
} from "../verdicts";

const STEP: Discriminant = { kind: "step", detail: "opponent's end step" };

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
    it("finds the one complete pair among the two verdicts", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                { verdictId: anchor.id, delta: FIT_MARGIN + 50 },
                { verdictId: half.id, delta: FIT_MARGIN + 50 },
            ]
        );
        expect(outcomes).toEqual([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchorSatisfied: true,
                halfSatisfied: true,
            },
        ]);
    });

    it("reads ONE satisfied when only the anchor clears the margin — the fit learned 'never', not 'not now'", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                { verdictId: anchor.id, delta: FIT_MARGIN + 50 },
                { verdictId: half.id, delta: FIT_MARGIN - 50 },
            ]
        );
        expect(outcomes[0]).toMatchObject({
            anchorSatisfied: true,
            halfSatisfied: false,
        });
    });

    it("reads ONE satisfied the other way when only the half clears the margin", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                { verdictId: anchor.id, delta: FIT_MARGIN - 50 },
                { verdictId: half.id, delta: FIT_MARGIN + 50 },
            ]
        );
        expect(outcomes[0]).toMatchObject({
            anchorSatisfied: false,
            halfSatisfied: true,
        });
    });

    it("a verdict is satisfied only when EVERY pair it yielded clears the margin", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [
                // The anchor yields two pairs here (a third candidate would
                // do it for real; this asserts the AND without building one).
                { verdictId: anchor.id, delta: FIT_MARGIN + 50 },
                { verdictId: anchor.id, delta: FIT_MARGIN - 1 },
                { verdictId: half.id, delta: FIT_MARGIN + 50 },
            ]
        );
        expect(outcomes[0].anchorSatisfied).toBe(false);
    });

    it("a verdict absent from the pairs handed in reads as unsatisfied, not skipped", () => {
        const outcomes = minimalPairFitOutcomes(
            [anchor, half],
            [{ verdictId: anchor.id, delta: FIT_MARGIN + 50 }]
        );
        expect(outcomes[0]).toMatchObject({
            anchorSatisfied: true,
            halfSatisfied: false,
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
                { verdictId: anchor.id, delta: FIT_MARGIN + 50 },
                { verdictId: half.id, delta: FIT_MARGIN + 50 },
                { verdictId: unclassified.id, delta: FIT_MARGIN + 50 },
                { verdictId: orphanAnchor.id, delta: FIT_MARGIN + 50 },
            ]
        );
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0].anchorId).toBe(anchor.id);
    });
});

describe("formatMinimalPairSection (issue #4794)", () => {
    it("names the Discriminant no term reads when one half is satisfied", () => {
        const text = formatMinimalPairSection([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchorSatisfied: true,
                halfSatisfied: false,
            },
        ]);
        expect(text).toContain("both satisfied         : 0");
        expect(text).toContain("one satisfied          : 1");
        expect(text).toContain("neither satisfied      : 0");
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
                anchorSatisfied: true,
                halfSatisfied: false,
            },
            {
                anchorId: "a2",
                halfId: "h2",
                discriminant: other,
                anchorSatisfied: false,
                halfSatisfied: false,
            },
            {
                anchorId: "a3",
                halfId: "h3",
                discriminant: other,
                anchorSatisfied: false,
                halfSatisfied: false,
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
                anchorSatisfied: false,
                halfSatisfied: false,
            },
        ]);
        expect(text).toContain("neither satisfied      : 1");
        expect(text).toContain(
            `Minimal Pairs with NEITHER half satisfied (1) — a look at the board, not a missing term`
        );
        // Not read as "one satisfied" — the two are reported separately.
        expect(text).not.toContain("Discriminant no term reads");
    });

    it("prints nothing under 'other' phrases and no by-kind row when every pair is satisfied", () => {
        const text = formatMinimalPairSection([
            {
                anchorId: anchor.id,
                halfId: half.id,
                discriminant: STEP,
                anchorSatisfied: true,
                halfSatisfied: true,
            },
        ]);
        expect(text).toContain(
            "unsatisfied Minimal Pairs by Discriminant kind (0)"
        );
        expect(text).toContain("(none)");
        expect(text).not.toContain("other Discriminant phrases");
    });
});
