// The validators of a Verdict's classification and Minimal Pair link (ADR 0148,
// issue #4800) — ONE copy, because the `submit` door, the forwarding query and
// the outbox table must agree on the shape or a judgement hashes differently on
// each side of the drain. They mirror `VerdictClassification` and
// `MinimalPairLink` (`gre/ai/verdicts/types.ts`); the literals are
// `DISCRIMINANT_KINDS`, spelled out so the inferred type is the union and not
// a bare `string`.

import { v } from "convex/values";

export const discriminantValidator = v.object({
    kind: v.union(
        v.literal("card"),
        v.literal("step"),
        v.literal("life"),
        v.literal("mana"),
        v.literal("stack"),
        v.literal("sequence"),
        v.literal("other")
    ),
    detail: v.string(),
});

export const classificationValidator = v.union(
    v.object({ kind: v.literal("absolute") }),
    v.object({
        kind: v.literal("conditional"),
        discriminant: discriminantValidator,
    })
);

export const pairOfValidator = v.object({
    anchorId: v.string(),
    discriminant: discriminantValidator,
});

// The judge's reading of a decision (PRD issue #10083) — Plan, verbatim
// words, Verdict Grade, accepted alternatives. Same one-copy reason: the
// `submit` door, the forwarding query and the outbox table carry it. Mirrors
// `AttestedReading` (`gre/ai/verdicts/reading.ts`); the grade literals are
// `VERDICT_GRADES`, spelled out for the same inferred-union reason.

export const gradeValidator = v.union(
    v.literal("clear"),
    v.literal("preferred"),
    v.literal("indifferent")
);

export const attestedPlanValidator = v.object({
    text: v.string(),
    seq: v.optional(v.number()),
});

/** The four optional fields, spread into an `args` or a table definition. */
export const readingFields = {
    plan: v.optional(attestedPlanValidator),
    rationale: v.optional(v.string()),
    grade: v.optional(gradeValidator),
    acceptedIndexes: v.optional(v.array(v.number())),
};
