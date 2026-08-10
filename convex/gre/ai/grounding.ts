// Grounding for the per-Op value model (PRD #1423, issue #1426). A valuer
// reads Op parameters — amounts (`EffectValue`), player refs — that are only
// concrete AT a decision node. The `GroundingContext` abstracts that read so
// the SAME valuer runs in both grounding modes the PRD names:
//
//   • CONTEXT-FREE — a card's worth in hand, no board. `forEach`/`count`
//     collapse to a representative count of 1 (with a `board-scaling` tag so
//     the caller knows the scalar is a floor), `X` takes a representative
//     value, refs take a representative magnitude, and player refs are read
//     from the CASTER's perspective (a card's own effect is, by construction,
//     something its caster wants to happen). This is what `cardValue` consumes.
//
//   • CONTEXT-AWARE — a prior at a decision node, over real state. Amounts and
//     `forEach` counts come from the live resolver; player refs resolve
//     against the real caster. Only genuinely-unmade decisions (`choice`,
//     `mayPay`) stay approximated. This is what the choice-node search and the
//     rollout policy consume.
//
// Kept isomorphic (type-only state import) so it rides in `convex/gre/cardValue`
// 's client-importable barrel.

import type {
    EffectValue,
    EffectSignedValue,
    EffectPlayerRef,
    EffectForEachSelector,
} from "../../cards/types";

/** Representative magnitudes used in CONTEXT-FREE grounding (PRD #1423). Not
 *  tuned per card — a coarse "typical" value so a variable-amount card is
 *  valued in the right ballpark and flagged `board-scaling`. */
export const CF_ASSUMED_X = 2; // a chosen X paid from a hand (a mid ritual/burn X)
export const CF_ASSUMED_COUNT = 1; // one forEach member / one counted thing
export const CF_ASSUMED_REF = 2; // a bound object's power/toughness/manaValue

/** A resolved runtime amount plus whether it scales with hidden/board state
 *  (so the caller can attach the `board-scaling` tag). */
export interface GroundedAmount {
    amount: number;
    scaling: boolean;
}

/** Grounds an Op's runtime reads for a valuer, in one of the two PRD modes. */
export interface GroundingContext {
    readonly mode: "context-free" | "context-aware";
    /** Resolve an `EffectValue` (an Op amount/count) to a representative
     *  magnitude and whether it board-scales. */
    value(v: EffectValue): GroundedAmount;
    /** Resolve a SIGNED `EffectValue` (`pump` power/toughness), honoring a
     *  `negate` wrapper. */
    signedValue(v: EffectSignedValue): GroundedAmount;
    /** From the CASTER's perspective, does `ref` denote the caster's own side?
     *  `cfAssumption` is the valuer's natural assumption for an ambiguous
     *  announced-target player slot (harmful ops assume "opponent", beneficial
     *  ops assume "self") — used only in context-free mode. */
    isSelf(ref: EffectPlayerRef, cfAssumption: "self" | "opponent"): boolean;
    /** How many members a `forEach` selects (real count context-aware; the
     *  representative 1 context-free), and whether it board-scales. */
    forEachCount(select: EffectForEachSelector): GroundedAmount;
}

function isNegated(v: EffectSignedValue): v is { negate: EffectValue } {
    return typeof v === "object" && v !== null && "negate" in v;
}

/** Context-free grounding: representative assumptions, caster's perspective. */
export function contextFreeGrounding(): GroundingContext {
    const value = (v: EffectValue): GroundedAmount => {
        if (typeof v === "number") return { amount: v, scaling: false };
        if ("X" in v) return { amount: CF_ASSUMED_X, scaling: true };
        if ("ref" in v) return { amount: CF_ASSUMED_REF, scaling: false };
        if ("count" in v) return { amount: CF_ASSUMED_COUNT, scaling: true };
        // difference (issue #2006) — `from` minus `minus`, both terminals. With
        // no board context each `count` operand is the representative
        // CF_ASSUMED_COUNT, so a count-minus-count difference grounds at 0 and
        // would price the effect at nothing. That is the wrong context-FREE
        // floor (the context-aware path below reads the real board), so a
        // difference grounds at the same CF_ASSUMED_COUNT a single count does,
        // board-scaling: it is a board-dependent magnitude, and the one thing
        // the floor must not do is claim to know it is zero.
        if ("difference" in v) {
            return { amount: CF_ASSUMED_COUNT, scaling: true };
        }
        // scaled (issue #2366) — a fixed multiplier times a terminal (X, a
        // literal, or a count). The operand shape (`number | EffectCount |
        // EffectXValue`) is structurally a valid `EffectValue`, so it grounds
        // through the SAME closure recursively (X → CF_ASSUMED_X, a literal
        // → itself, a count → CF_ASSUMED_COUNT board-scaling) rather than a
        // duplicated floor — the one thing this branch must NOT do is fall
        // through to the generic CF_ASSUMED_REF floor below and price
        // "twice X" as a fixed representative constant instead of 2x whatever
        // X grounds to (the wrong-magnitude failure mode, issue #1520).
        if ("scaled" in v) {
            const inner = value(v.scaled.value);
            return {
                amount: inner.amount * v.scaled.times,
                scaling: inner.scaling,
            };
        }
        // counters / manaValue / domain / kickerCount / kickerPaid / escaped /
        // abilityResolutionCount / lifeGainedThisTurn — dynamic reads off
        // runtime state.
        if ("escaped" in v || "abilityResolutionCount" in v)
            return { amount: 1, scaling: false };
        return { amount: CF_ASSUMED_REF, scaling: true };
    };
    return {
        mode: "context-free",
        value,
        signedValue(v) {
            if (isNegated(v)) {
                const inner = value(v.negate);
                return { amount: -inner.amount, scaling: inner.scaling };
            }
            return value(v);
        },
        isSelf(ref, cfAssumption) {
            if (ref === "controller") return true;
            if (ref === "opponent") return false;
            if (typeof ref === "object" && "ref" in ref) return true; // $source etc.
            // {target} / {controllerOf} — the valuer's natural assumption.
            return cfAssumption === "self";
        },
        forEachCount() {
            return { amount: CF_ASSUMED_COUNT, scaling: true };
        },
    };
}

/** Resolvers a context-aware caller wires to live state. Kept as callbacks so
 *  this module needs no value-level `GameState` dependency (stays isomorphic).
 *  Only the reads a valuer actually performs are required. */
export interface ContextAwareResolvers {
    /** Resolve an `EffectValue` to its real magnitude at the decision node. */
    resolveValue(v: EffectValue): number;
    /** True when `ref` resolves to the caster's own player id. */
    resolveIsSelf(ref: EffectPlayerRef): boolean;
    /** Real member count of a `forEach` selector at the decision node. */
    resolveForEachCount(select: EffectForEachSelector): number;
}

/** Context-aware grounding: real magnitudes and perspective at a decision
 *  node. `board-scaling` is never attached — the value is already realized. */
export function contextAwareGrounding(
    resolvers: ContextAwareResolvers
): GroundingContext {
    const value = (v: EffectValue): GroundedAmount => ({
        amount: resolvers.resolveValue(v),
        scaling: false,
    });
    return {
        mode: "context-aware",
        value,
        signedValue(v) {
            if (isNegated(v)) {
                return { amount: -value(v.negate).amount, scaling: false };
            }
            return value(v);
        },
        isSelf(ref) {
            return resolvers.resolveIsSelf(ref);
        },
        forEachCount(select) {
            return {
                amount: resolvers.resolveForEachCount(select),
                scaling: false,
            };
        },
    };
}
