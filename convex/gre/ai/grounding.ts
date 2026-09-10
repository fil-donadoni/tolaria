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
    EffectRef,
} from "../../cards/types";
import type { Feature } from "./featureBasis";
import type { LatentWeights } from "./evalWeights";
import { DEFAULT_EVAL_WEIGHTS } from "./evalWeights";

/** Representative magnitudes used in CONTEXT-FREE grounding (PRD #1423). Not
 *  tuned per card — a coarse "typical" value so a variable-amount card is
 *  valued in the right ballpark and flagged `board-scaling`. */
export const CF_ASSUMED_X = 2; // a chosen X paid from a hand (a mid ritual/burn X)
export const CF_ASSUMED_COUNT = 1; // one forEach member / one counted thing
export const CF_ASSUMED_REF = 2; // a bound object's power/toughness/manaValue

/** The LATENT pricing lens a valuer reads (issue #3398, PRD #3397): the
 *  fitted price of one unit of each feature-basis dimension, plus — when a
 *  board is attached — how many units of `boardRemoval` the best legal victim
 *  of an announced target slot is actually worth THERE.
 *
 *  Kept on the grounding context rather than passed as a second valuer
 *  parameter for the same reason every other runtime read already lives here:
 *  a valuer must be identical in both grounding modes, and the thing that
 *  varies between them is what the context can answer. */
export interface LatentLens {
    /** Fitted price of one unit of each basis dimension. */
    readonly weights: LatentWeights;
    /** Units of `boardRemoval` the BEST LEGAL victim of announced target slot
     *  `slot` is worth — its realised board loss over the representative
     *  victim's (`ai/latentBoard.ts`). `undefined` when NO board is attached
     *  (the valuer then falls back to exactly one representative victim, which
     *  is what reproduces the pre-#3398 constants); `0` when a board IS
     *  attached and holds no legal victim at all — a removal spell facing an
     *  empty board is worth nothing, which is the case the old fixed constant
     *  got most wrong. */
    victimUnits(slot: number): number | undefined;
    /** True once `victimUnits` has ANSWERED at least one slot off a REAL
     *  board — i.e. this script's board-affecting worth is MEASURED, not
     *  assumed from a representative victim.
     *
     *  Read by `latentValue` (`cardValue.ts`) to lift the `base + MV`
     *  coverage floor. That floor exists so a card whose script the Op
     *  vocabulary cannot value yet never drops below its mana-value proxy —
     *  a statement about COVERAGE. Once the board has been read, the proxy is
     *  superseded by a measurement, and keeping it is what left Stone Rain
     *  priced at 38 in hand against a 17-point land: still a net loss to
     *  cast, so still never cast (issue #3398). */
    measured(): boolean;
}

/** The lens a valuation with no board attached reads: the production weights,
 *  no victim lookup. */
export function contextFreeLatentLens(
    weights: LatentWeights = DEFAULT_EVAL_WEIGHTS.latent
): LatentLens {
    return { weights, victimUnits: () => undefined, measured: () => false };
}

/** Price one unit of `feature` under `ctx`'s latent lens — the single read
 *  every valuer uses instead of a module-level point constant. */
export function latentWeight(ctx: GroundingContext, feature: Feature): number {
    return ctx.latent.weights[feature];
}

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
    /** True when `ref` denotes an OBJECT ref that is BOTH (a) the ability's
     *  own resolving SOURCE — the literal `{ ref: "$source" }`, or (extended
     *  per-call by `withCapturedSourceAliases` in `opValuers.ts`) a name a
     *  `delayedTrigger`/`reflexiveTrigger`'s own `capture` map aliases to it
     *  — and (b) CURRENTLY ON THE BATTLEFIELD. (b) is the default for every
     *  activated ability and the common triggered-ability case; `false` only
     *  when `withGraveyardSource` below has forced it, for a `zone:
     *  "graveyard"` triggered ability whose `$source` is a GRAVEYARD card
     *  instead (CR 603.6e — Master of Death's "return it to your hand" is
     *  card advantage, never a cost, the opposite of Dash's battlefield-zoned
     *  delayed return).
     *
     *  Distinct from `isSelf` above: `isSelf` answers a PLAYER-ref question
     *  (an announced `target`/`controllerOf` PLAYER slot); this answers an
     *  OBJECT-ref question (does the ref pick out the resolving permanent
     *  itself) — the two ref families are never interchangeable, and a
     *  permanent ref has no player-ref shape `isSelf` could read (issue
     *  #1964 — the `moveZone`/self-bounce-as-cost fix). */
    isSourceBattlefieldRef(ref: EffectRef): boolean;
    /** The latent pricing lens (issue #3398) — per-dimension unit prices, and
     *  the board's best legal victim for a targeted, board-affecting Op. */
    readonly latent: LatentLens;
}

function isNegated(v: EffectSignedValue): v is { negate: EffectValue } {
    return typeof v === "object" && v !== null && "negate" in v;
}

/** Context-free grounding: representative assumptions, caster's perspective. */
export function contextFreeGrounding(
    weights: LatentWeights = DEFAULT_EVAL_WEIGHTS.latent
): GroundingContext {
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
        // divide (issue #2385) — a terminal divided by a fixed divisor,
        // rounded per `rounding`. Mirrors `scaled`'s recursion: the operand
        // (a literal or a `count`) grounds through the SAME closure, then the
        // quotient is rounded the way the card's Oracle text specifies (CR
        // 107.1a) rather than falling through to a generic floor.
        if ("divide" in v) {
            const inner = value(v.divide.value);
            const quotient = inner.amount / v.divide.by;
            return {
                amount:
                    v.divide.rounding === "up"
                        ? Math.ceil(quotient)
                        : Math.floor(quotient),
                scaling: inner.scaling,
            };
        }
        // sacrificed (issue #2375) — a characteristic of the cost-sacrificed
        // permanent (CR 601.2f / 608.2h). The READ itself is a dynamic
        // runtime value and takes the same `CF_ASSUMED_REF` floor every other
        // dynamic read takes, but the `plus` LITERAL is known statically and
        // must be added on top rather than swallowed by the generic floor
        // below — the wrong-magnitude failure mode `scaled` documents (issue
        // #1520): Broadside Bombardiers' "2 plus the sacrificed permanent's
        // mana value" would otherwise ground as a bare representative 2,
        // pricing a boast at half what it does and hiding the activation
        // behind `pass`.
        if ("sacrificed" in v) {
            return {
                amount: CF_ASSUMED_REF + (v.sacrificed.plus ?? 0),
                scaling: true,
            };
        }
        // counters / manaValue / domain / kickerCount / additionalCostPaid / escaped /
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
        isSourceBattlefieldRef(ref) {
            return ref.ref === "$source";
        },
        latent: contextFreeLatentLens(weights),
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
    /** Fitted per-dimension unit prices (issue #3398). Optional — a caller
     *  that does not run a ladder variant gets the production vector. */
    latentWeights?: LatentWeights;
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
        // Issue #1964 — no context-aware caller threads an enclosing
        // ability's `zone` today (`contextAwareGroundingForChoice` values a
        // CHOICE fragment, not a whole ability), so this stays the same
        // literal-match default `contextFreeGrounding` uses rather than a
        // resolver nobody can supply yet. A future context-aware caller that
        // DOES need the graveyard-zoned exception can extend this the same
        // way `withGraveyardSource` does for the context-free path.
        isSourceBattlefieldRef(ref) {
            return ref.ref === "$source";
        },
        // No context-aware caller attaches a board lens, and one of them
        // WOULD want it: `dslSearchLibraryPrior` (`ai/choicePriors.ts`) values
        // a whole, not-yet-cast card through
        // `contextAwareGroundingForChoice`, target unchosen — so a removal
        // spell it ranks in a library prices at the representative victim
        // while `evaluate`'s hand term, one node later, prices the same card
        // against the real board. Not a regression (the prior read the fixed
        // constant before this too), but a genuine second price for one card,
        // and a `latent` sweep does not reach it: nothing sets
        // `latentWeights` below, so this reads the production vector. Both
        // need `EvalWeights` threaded from `search.ts` through `priorFor` —
        // a seam this issue's blast radius does not cover
        // (`docs/findings/choice-prior-latent-weights.md`).
        latent: contextFreeLatentLens(resolvers.latentWeights),
    };
}

/** Derives a ctx whose `isSourceBattlefieldRef` always answers `false` — for
 *  an ability whose OWN `zone` is `"graveyard"` (CR 603.6e): its `$source`
 *  denotes a GRAVEYARD card, not a battlefield permanent, so a `moveZone →
 *  hand` naming it is card advantage (regrowth — Master of Death, CR 603.6e
 *  `zone: "graveyard"`, "return it to your hand"), never the self-bounce COST
 *  `isSourceBattlefieldRef` exists to flag (issue #1964 — the OPPOSITE case
 *  from Dash's battlefield-zoned delayed return). `dslAbilityScriptOpValue`
 *  (`cardScriptValue.ts`) applies this per-ability, before walking that
 *  ability's own script — never globally, since a card's OTHER abilities may
 *  be ordinary battlefield ones. */
export function withGraveyardSource(ctx: GroundingContext): GroundingContext {
    return { ...ctx, isSourceBattlefieldRef: () => false };
}

/** Derives a ctx that reads `lens` for its latent pricing — how a caller that
 *  HAS a board (the `evaluate` hand term, via `cardValue`) attaches it to an
 *  otherwise context-free valuation (issue #3398). */
export function withLatentLens(
    ctx: GroundingContext,
    lens: LatentLens
): GroundingContext {
    return { ...ctx, latent: lens };
}
