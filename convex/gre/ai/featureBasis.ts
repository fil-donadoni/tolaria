// Per-Op value model — the FIXED feature basis (PRD #1423 "DSL semantic
// layer", issue #1426). Each Effect Script Op projects onto this small,
// orthogonal basis: a scalar `points` contribution (Forge-scale currency,
// `evaluate.ts` — a 2/2 vanilla ≈ 170, one life ≈ 8) plus a set of `tags`
// naming which basis dimensions and target-priors the Op loads onto. The
// scalar feeds `cardValue`; the tags feed the context target-priors the
// choice-node search consumes (the two other readers named by the PRD).
//
// The basis is deliberately card-AGNOSTIC (primitive-reuse mandate, CLAUDE.md):
// it describes GENERAL effect kinds (damage, card advantage, board removal, …),
// never per-card shapes. A new Op maps onto the existing dimensions or, only if
// genuinely orthogonal, earns a new one here — the same discipline
// `SpellContext` primitives follow.

/** The fixed feature basis a per-Op value model projects onto (PRD #1423).
 *  Each dimension is a general, orthogonal axis of what an effect is worth. */
export const FEATURE_BASIS = [
    /** Damage to a player or creature (burn, direct damage). */
    "damage",
    /** Net cards gained (draw, dig-to-hand, recursion-to-hand). */
    "cardAdvantage",
    /** Life gained/lost that is not combat/spell damage (lifegain, drain). */
    "lifeSwing",
    /** Removing an opponent's permanent from the battlefield (destroy, exile,
     *  edict, bounce as partial removal). */
    "boardRemoval",
    /** Mana acceleration / fixing (rituals, mana rocks, extra lands). */
    "ramp",
    /** Making a threat harder to answer or to block (evasion grants). */
    "evasion",
    /** Time/position swings with no permanent card change (tap, bounce, extra
     *  turn) — the classic "tempo" axis. */
    "tempo",
    /** Denying the opponent resources or actions (counter, discard, Stax). */
    "disruption",
    /** Returning cards from the graveyard (reanimation, regrowth). */
    "recursion",
    /** Adding bodies to the board (token creation). */
    "tokens",
    /** Boosting a creature's stats (pump, +1/+1 counters). */
    "pump",
    /** Protecting or saving a permanent (regeneration, protection, indestructible). */
    "protection",
] as const;

/** One feature-basis dimension. */
export type Feature = (typeof FEATURE_BASIS)[number];

/** Semantic modifier tags a valuer can attach ALONGSIDE its feature tags —
 *  read by the context target-prior seam, never scored as a basis dimension.
 *  Kept a small closed vocabulary (extended only when a consumer needs it). */
export type SemanticTag =
    /** The Op's magnitude grows with board/graveyard/hand state — its
     *  context-free scalar is a floor, not the realized value (a `forEach`
     *  member count of 1, an `X`, a `count`, a dynamic ref). */
    | "board-scaling"
    /** The Op acts on an announced target — a context target-prior should pick
     *  the best target (biggest threat / lethal face). */
    | "targeted"
    /** The Op's magnitude/benefit is paid by the CASTER (a self-sacrifice, a
     *  self life-loss) — a cost, not a gain. */
    | "self-cost";

/** Any tag a valuer emits: a basis feature or a semantic modifier. */
export type ValueTag = Feature | SemanticTag;

/** The product of valuing a single Op (PRD #1423): a Forge-scale scalar plus
 *  the tags it loaded onto. `points` is signed — a self-cost Op (sacrifice
 *  your own creature) contributes negatively from the caster's perspective. */
export interface OpValue {
    points: number;
    tags: ValueTag[];
}

/** The zero value — an Op with no valuation contribution (an approximated /
 *  backfilled Op, or a no-op branch). */
export const ZERO_OP_VALUE: OpValue = { points: 0, tags: [] };

/** Type guard: is `tag` one of the fixed basis dimensions (vs. a semantic
 *  modifier)? Used by consumers that want only the scalar basis projection. */
export function isFeature(tag: ValueTag): tag is Feature {
    return (FEATURE_BASIS as readonly string[]).includes(tag);
}
