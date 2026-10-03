// The Representative Victim — the permanent one `boardRemoval` unit takes off
// the board when no board can say what a removal Op would really hit
// (CONTEXT.md "Representative Victim", issue #3398).
//
// A LEAF module on purpose: the board lens (`latentBoard.ts`, which reads the
// rules engine) and the context-free ETB valuation (`cardScriptValue.ts`) both
// price against it, and neither may import the other's dependencies.
//
// Issue #4903 — the victim is TYPED. Until then it was always a vanilla 2/2,
// so an ETB Ability reading "destroy target enchantment" was worth a creature
// kill in hand, while every enchantment it could actually hit sat far below
// that on the board: the Bot held Monk Realist against a Glorious Anthem on
// 5/5 seeds. A requirement that can only name an artifact, an enchantment or
// a land now takes a representative permanent of THAT type, priced the way
// `permanentRealisedValue` (`evaluate.ts`) prices one — at the PRIOR weights
// (see `withTypedRepresentativeVictim`). A requirement that names a creature
// keeps the 2/2: its best victim may well be one.
//
// CARD-AGNOSTIC (ADR 0102): it reads a target requirement's types, nothing
// else.
import type { CardType, TargetRequirement } from "../../cards/types";
import { creatureValueRaw, nonCreatureBodyRaw } from "../creatureBody";
import type { EvalWeights } from "./evalWeights";
import { FIT_BASE_EVAL_WEIGHTS } from "./evalWeights";
import type { LatentLens } from "./grounding";

/** The REPRESENTATIVE victim's body: a vanilla 2/2 for two. Not a new tuning
 *  constant — it is the body `DESTROY_VALUE = 160` was hand-tuned against
 *  ("destroy a representative permanent (≈ a 2/2 body)"), priced by the same
 *  `creatureValueRaw` primitive every real creature goes through, so the unit
 *  and the board it is measured against can never drift apart. */
const REPRESENTATIVE_VICTIM_POWER = 2;
const REPRESENTATIVE_VICTIM_TOUGHNESS = 2;
const REPRESENTATIVE_VICTIM_MANA_VALUE = 2;

/** The weights a representative victim's realised loss reads. */
export type RepresentativeVictimWeights = Pick<
    EvalWeights,
    "permanentWeight" | "manaWeight"
>;

/** Realised board loss of ONE representative victim — its body plus the flat
 *  board-presence weight every permanent carries, i.e. exactly what
 *  `permanentRealisedValue` would return for it. The DENOMINATOR that turns a
 *  real victim's realised loss into `boardRemoval` units. */
export function representativeVictimLoss(
    weights: Pick<EvalWeights, "permanentWeight">
): number {
    return (
        creatureValueRaw(
            REPRESENTATIVE_VICTIM_POWER,
            REPRESENTATIVE_VICTIM_TOUGHNESS,
            REPRESENTATIVE_VICTIM_MANA_VALUE,
            []
        ) + weights.permanentWeight
    );
}

/** Realised board loss of a representative permanent of one NON-creature
 *  type, priced the way `permanentRealisedValue` prices a real one: an
 *  artifact or enchantment is the flat presence weight plus the `base + MV`
 *  body of a script-less non-creature at the representative mana value; a
 *  land is the presence weight plus one untapped mana source. `undefined` for
 *  a type with no representative of its own (a planeswalker's or a battle's
 *  worth is its loyalty or defense, which no typical value stands in for). */
function representativeLossOfType(
    type: CardType,
    weights: RepresentativeVictimWeights
): number | undefined {
    switch (type) {
        case "Artifact":
        case "Enchantment":
            return (
                weights.permanentWeight +
                nonCreatureBodyRaw(REPRESENTATIVE_VICTIM_MANA_VALUE)
            );
        case "Land":
            return weights.permanentWeight + weights.manaWeight;
        default:
            return undefined;
    }
}

const NON_CARD_TYPES: ReadonlySet<string> = new Set([
    "player",
    "any",
    "spell",
    "spell-or-permanent",
    "card",
]);

/** Issue #4903 — how many `boardRemoval` units a representative victim of
 *  `requirement`'s TYPE is worth: the largest representative loss among the
 *  types it admits, over the representative creature's. `undefined` — keep
 *  the 2/2 — when the requirement NAMES `Creature`, a planeswalker, a battle
 *  or a non-permanent, or a zone other than the battlefield: "the best victim
 *  is typically a creature" is still the right assumption for every one of
 *  those.
 *
 *  Read off the requirement's type NAMES, never its legal set: "target
 *  artifact" can also hit an artifact creature and "target land" an animated
 *  land, and the representative is still the TYPICAL artifact or land — a
 *  deliberate typical value, as the 2/2 is for "target creature", not a
 *  ceiling. Context-free means no board to say otherwise. */
export function representativeVictimUnits(
    requirement: TargetRequirement,
    weights: RepresentativeVictimWeights
): number | undefined {
    if (requirement.zone && requirement.zone !== "battlefield") {
        return undefined;
    }
    const types = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
    let best = 0;
    for (const type of types) {
        if (NON_CARD_TYPES.has(type)) return undefined;
        const loss = representativeLossOfType(type as CardType, weights);
        if (loss === undefined) return undefined;
        best = Math.max(best, loss);
    }
    if (best === 0) return undefined;
    return best / representativeVictimLoss(weights);
}

/** Issue #4903 — `base` with every slot it cannot answer priced at a
 *  representative victim of `requirement`'s type instead of the 2/2. For an
 *  ETB Ability, whose target is chosen only as it is put on the stack
 *  (CR 603.3d), on the board it enters into, so the valuation in hand stays
 *  board-independent (PRD #4754) but stops being type-blind. A triggered
 *  ability declares ONE requirement, so every slot its script names belongs
 *  to it.
 *
 *  Priced at the PRIOR weights (`FIT_BASE_EVAL_WEIGHTS`), never the fitted
 *  ones: this path runs inside `evaluate` with only the latent vector to hand,
 *  and reading `DEFAULT_EVAL_WEIGHTS` there would make the Weight Fit's output
 *  an input to its own next run — no longer reproducible to the bit
 *  (`weightFit.bot.test.ts`). Like the 2/2 itself, the typed victim is part of
 *  the unit's contract, not a fitted read. */
export function withTypedRepresentativeVictim(
    base: LatentLens,
    requirement: TargetRequirement | undefined
): LatentLens {
    if (!requirement) return base;
    const units = representativeVictimUnits(requirement, FIT_BASE_EVAL_WEIGHTS);
    if (units === undefined) return base;
    return {
        ...base,
        victimUnits: (slot) => base.victimUnits(slot) ?? units,
    };
}
