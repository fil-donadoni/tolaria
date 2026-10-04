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
