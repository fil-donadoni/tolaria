// `payWith` — the CR 601.2g cast-cost variant (ADR 0063).
//
// CR 601.2f reduces a cost deterministically before payment (`reduce`, the
// existing `StaticCostModifier.costReduction` seam). CR 601.2g is the other
// half: the caster may satisfy part of the cost with a NON-MANA resource they
// CHOOSE — delve exiles graveyard cards, convoke taps creatures, improvise taps
// artifacts. Each such resource pays for {1} of the spell's GENERIC cost.
//
// 601.2g "...the player determines the total cost of the spell... If the total
//        cost includes a mana payment, the player then has a chance to activate
//        mana abilities... Then the player pays the total cost..."
// 702.66a "Delve is a static ability that functions while the spell with delve
//         is on the stack. 'Delve' means 'For each generic mana in this spell's
//         total cost, you may exile a card from your graveyard rather than pay
//         that mana.'"
// 702.66b "A card exiled this way pays for {1}."
//
// **Model 2 payment** (ADR 0063): a PRE-PAYMENT pending choice. The cast order
// is `reduce` (CR 601.2f) → `payWith` prompt → `solveSmartAutoTap` covers the
// remainder. The solver never auto-picks the resource — exiling your graveyard
// synergy fuel is a genuinely tactical decision, so it stays the caster's
// explicit choice. The solver DOES see the resources as **pseudo-sources for
// the castability PROBE only** (`rules.ts` `coloredCostLeftover`), so a spell
// payable only via delve is still offered as a legal `"cast"` action.
//
// The picker itself is the generalized graveyard-exile picker
// (`PendingCast.exileFromGraveyardChoice`), widened from `fixed | card-type
// threshold` to also carry the **variable-offset** shape delve needs
// (`offsetGeneric: { min, max }`) — primitive reuse, not a delve-shaped
// bespoke picker.
import type { CardInstanceState, PendingCast, PlayerState } from "./state";
import { tryGetDefinition } from "../cards";

/** CR 702.66 — true iff the spell being cast declares Delve. Reads the printed
 *  keyword off the card definition (mirrors `spellHasImprovise` in `rules.ts`);
 *  delve is never layer-granted in the current pool, so the definition is
 *  authoritative. */
export function spellHasDelve(card: CardInstanceState): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    return tryGetDefinition(cardId)?.staticAbilities?.includes("delve") ?? false;
}

/** CR 702.66a — the cards in `player`'s graveyard that may be exiled to pay for
 *  this cast. Every graveyard card qualifies (delve has no colour/type filter),
 *  except the spell itself when it is being cast FROM the graveyard — a card
 *  can't pay for its own cost. */
export function delveEligibleCards(
    player: PlayerState,
    castInstanceId: string
): CardInstanceState[] {
    return player.graveyard.filter((c) => c.id !== castInstanceId);
}

/** The GENERIC portion of a normalized cost (`normalizeManaCost` folds every
 *  generic pip into the numeric `X` key). Delve/convoke/improvise offset only
 *  this — never a coloured pip (CR 702.66a). */
export function genericPortion(cost: Record<string, number>): number {
    return cost.X ?? 0;
}

/** Apply `n` paid-with resources to a pending cast's remaining cost: each one
 *  pays for {1} of GENERIC mana (CR 702.66b), clamped at zero and never
 *  touching a coloured pip. Mirrors the Improvise clamp in
 *  `tapArtifactIntoImprovisePayment` so `isManaCostCovered` needs no
 *  payWith-specific branch. */
export function applyGenericOffset(
    cost: Record<string, number>,
    n: number
): void {
    cost.X = Math.max(0, genericPortion(cost) - n);
}

/** CR 601.2g / 702.66 — build the delve picker for a cast that is about to be
 *  announced, or `undefined` when delve offers nothing (Arena-style prompt
 *  policy, ADR 0063).
 *
 *  - `max` = min(eligible graveyard cards, generic remaining AFTER the CR
 *    601.2f reductions already folded into `manaCost`). `max === 0` means
 *    nothing is eligible or there is no generic left → **skip the prompt**.
 *  - `min` = how many the caster is FORCED to exile because their mana alone
 *    can't cover the cost (`shortfall`, clamped into `0..max`). `0` when lands
 *    could pay the same pips — a purely tactical choice → **prompt**. A partly
 *    forced choice → **prompt with the minimum pre-seeded**.
 *
 *  `count` is a nominal 0: the variable-offset mode ignores it (mirrors the
 *  Nethergoyf `minCardTypes` mode's nominal 1). */
export function buildDelveExileChoice(
    player: PlayerState,
    card: CardInstanceState,
    manaCost: Record<string, number>,
    castInstanceId: string,
    /** Generic pips the caster's available mana CANNOT cover (delve excluded) —
     *  computed by `genericManaShortfall` in `rules.ts`, the same greedy model
     *  the castability gate uses. */
    shortfall: number
): NonNullable<PendingCast["exileFromGraveyardChoice"]> | undefined {
    if (!spellHasDelve(card)) return undefined;
    const eligible = delveEligibleCards(player, castInstanceId);
    const max = Math.min(eligible.length, genericPortion(manaCost));
    if (max <= 0) return undefined;
    const min = Math.max(0, Math.min(shortfall, max));
    return {
        count: 0,
        excludeInstanceId: castInstanceId,
        offsetGeneric: { min, max },
    };
}
