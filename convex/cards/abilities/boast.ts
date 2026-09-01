// `boastAbility` — the shared authoring primitive for Boast (CR 702.142).
//
// 702.142a: "Boast is a keyword that adds additional rules to the activated
//            ability that follows it. 'Boast — [Cost]: [Effect]' means
//            '[Cost]: [Effect]. Activate only if this creature attacked this
//            turn and only once each turn.'"
// 702.142b: "Effects may refer to boast abilities. If an effect refers to a
//            creature boasting, it means its boast ability being activated."
//
// The keyword is PURE activation-timing sugar: it adds no cost leg, no effect
// and no zone change of its own — it composes two activation restrictions onto
// an otherwise ordinary `ActivatedAbility`. So this factory expands it at
// AUTHORING time into the two explicit, JSON-serialisable fields the engine
// already reads, rather than having every consumer re-derive the clauses from
// a `boast` marker at read time:
//
//   "activate only if this creature attacked this turn" → `requiresAttackedThisTurn: true`
//   "and only once each turn" (CR 602.5b)                → `oncePerTurn: true`
//
// Why expansion at authoring time and not at read time: `oncePerTurn` already
// has SIX independent consumers (the server's `assertActivationTimingLegal`,
// the client's `isActivationTimingAllowed`, `enumerateAbilityMoves`,
// `hasFlexibleActivation`, the search's `recordActivation` tally, and the
// affordability sweep). Deriving the clause from a marker would mean teaching
// all six about a second way to be once-per-turn, and missing one would ship a
// Boast ability activatable twice a turn on that surface only. Expanding here
// means exactly ONE genuinely new field — `requiresAttackedThisTurn` — has to
// reach the consumers, and the resulting object is plain JSON data (ADR 0045),
// serialisable and inspectable, with no closure anywhere.
//
// Why NOT `canActivate: (source) => source.hasAttackedThisTurn`: a closure
// satisfies the CR and passes every GRE test while being opaque to everything
// that is not the server. `enumerateAbilityMoves` (`gre/moves.ts`) and
// `hasFlexibleActivation` (`gre/evaluate.ts`) both `continue` on ANY ability
// carrying `canActivate` — a closure-gated Boast would be permanently invisible
// to bot move generation — and the client affordability sweep
// (`src/lib/__tests__/activation-affordability.catalogue.test.ts`) auto-skips
// such abilities, so the new gate could never be swept catalogue-wide.
import type { ActivatedAbility } from "../types";

/** The caller-supplied half of a Boast ability: everything an ordinary
 *  `ActivatedAbility` carries EXCEPT the three fields CR 702.142a dictates,
 *  which this factory owns. Declaring them `never` here is what makes a card
 *  that hand-rolls "attacked this turn / once each turn" a TYPE error rather
 *  than a silent second implementation of the keyword. */
export type BoastAbilitySpec = Omit<
    ActivatedAbility,
    "boast" | "requiresAttackedThisTurn" | "oncePerTurn"
> & {
    boast?: never;
    requiresAttackedThisTurn?: never;
    oncePerTurn?: never;
};

/** Wraps an activated ability in Boast's two activation restrictions
 *  (CR 702.142a) and stamps the CR 702.142b marker. The returned object is
 *  plain JSON data — no closures, no engine imports — so it serialises,
 *  projects and is swept exactly like a hand-written `ActivatedAbility`.
 *
 *  Oracle convention: the printed reminder text "(Activate only if this
 *  creature attacked this turn and only once each turn.)" is part of the
 *  card's `oracleText`, which the caller supplies — the factory does not
 *  rewrite text. */
export function boastAbility(spec: BoastAbilitySpec): ActivatedAbility {
    return {
        ...(spec as ActivatedAbility),
        // CR 702.142b — this IS the ability an effect means when it refers to
        // a creature "boasting".
        boast: true,
        // CR 702.142a, first clause.
        requiresAttackedThisTurn: true,
        // CR 702.142a, second clause (CR 602.5b's per-object restriction).
        oncePerTurn: true,
    };
}
