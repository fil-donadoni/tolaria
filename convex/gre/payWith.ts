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
import type { Color } from "../cards/types";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { MANA_COLORS } from "./manaColors";
import { STATIC_EFFECT_CTX } from "./layers";
import { isCreature } from "./constants";

/** CR 702.66 — true iff the spell being cast declares Delve. Reads the printed
 *  keyword off the card definition (mirrors `spellHasImprovise` in `rules.ts`);
 *  delve is never layer-granted in the current pool, so the definition is
 *  authoritative. */
export function spellHasDelve(card: CardInstanceState): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    return (
        tryGetDefinition(cardId)?.staticAbilities?.includes("delve") ?? false
    );
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
 *  - When `min === max === eligible.length` there is no real branch left
 *    AT ALL — not "how many" (the count is forced to `max`) and not "which
 *    ones" (`max` already consumes the whole eligible graveyard, nothing to
 *    choose FROM) — so the pick auto-resolves: `pickedCardIds` is pre-filled
 *    with every eligible card and the generic offset is paid down on
 *    `manaCost` immediately (issue #1660, mirrors
 *    `buildAlternativeCostHandChoice`'s forced-pick path in
 *    `alternativeCost.ts`). A forced COUNT with graveyard cards left over
 *    (`max < eligible.length`) still leaves a real "which ones" decision — a
 *    genuinely tactical choice about what to keep in the yard — so THAT case
 *    keeps prompting with the minimum pre-seeded, same as before.
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
    const choice: NonNullable<PendingCast["exileFromGraveyardChoice"]> = {
        count: 0,
        excludeInstanceId: castInstanceId,
        offsetGeneric: { min, max },
    };
    if (min === max && max === eligible.length) {
        const pickedCardIds = eligible.map((c) => c.id);
        applyGenericOffset(manaCost, pickedCardIds.length);
        return { ...choice, pickedCardIds };
    }
    return choice;
}

// ─── Convoke (CR 702.51 — the coloured `payWith`, issue #1338) ───────────────
//
// 702.51a "Convoke ... means 'For each coloured mana in this spell's total cost,
//         you may tap an untapped creature you control of that colour rather than
//         pay that mana. For each generic mana in this spell's total cost, you may
//         tap an untapped creature you control rather than pay that mana.'"
//
// Unlike Delve (generic-only) Convoke can pay a COLOURED pip — including a
// guild-hybrid pip (`{B/G}`), which a creature of EITHER colour satisfies. A
// creature tapped for convoke is NOT paying a `{T}` mana-ability cost, so
// summoning sickness does NOT prevent convoking (CR 702.51e). Each creature taps
// for at most one pip. Modeled as the same Model-2 pre-payment pending choice as
// Delve (a creature PICKER, `PendingCast.convokeCreatureChoice`), never
// auto-picked by the solver — tapping your best blocker is a tactical decision.

/** CR 702.51 — true iff the spell being cast declares Convoke (read off the card
 *  definition, mirroring `spellHasDelve`). */
export function spellHasConvoke(card: CardInstanceState): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return false;
    return (
        tryGetDefinition(cardId)?.staticAbilities?.includes("convoke") ?? false
    );
}

/** CR 702.51a — the untapped creatures `player` controls that may be tapped for
 *  convoke. Summoning-sick creatures ARE eligible (convoke is not a `{T}`
 *  ability, CR 702.51e); the casting spell is on the stack, not the battlefield,
 *  so nothing else is excluded. */
export function convokeEligibleCreatures(
    player: PlayerState
): CardInstanceState[] {
    return player.battlefield.filter((c) => isCreature(c) && !c.isTapped);
}

/** The colours a creature can supply for convoke (CR 702.51a) — its live
 *  CR 613.1d layer-5 colours. A colourless creature returns an empty set: it
 *  pays only a GENERIC pip, never a coloured/hybrid one. */
export function creatureConvokeColors(card: CardInstanceState): Set<Color> {
    return new Set<Color>(STATIC_EFFECT_CTX.getColors(card));
}

/** Shared greedy pip-coverage primitive (CR 601.2g / 702.51 / 202.1a). Given a
 *  bag of `sources` (each the colour set it can supply — a land, a Mox, or a
 *  convoke creature), assign the single-colour pips (`coloredNeed`) then the
 *  guild-hybrid pips (`hybridPips`), each time consuming the LEAST-FLEXIBLE
 *  source able to pay it (fewest colours), and return how many sources are LEFT
 *  OVER for the generic portion — or `null` when some coloured/hybrid pip cannot
 *  be covered. This is the one greedy both the castability probe
 *  (`coloredCostLeftover`, `rules.ts`) and the convoke coverage computation
 *  (`recordConvokeCreaturePick`, `game.ts`) call, so they can never diverge
 *  (primitive-reuse rule). A hybrid pip `[c1, c2]` is payable by any source
 *  holding EITHER colour. */
export function coverColoredAndHybridPips(
    sources: ReadonlyArray<ReadonlySet<Color>>,
    coloredNeed: Record<string, number>,
    hybridPips: ReadonlyArray<readonly [Color, Color]>
): number | null {
    const remaining = sources.map((s) => new Set(s));
    for (const c of MANA_COLORS) {
        let need = coloredNeed[c] ?? 0;
        while (need > 0) {
            let bestIdx = -1;
            let bestSize = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const s = remaining[i];
                if (s.has(c) && s.size < bestSize) {
                    bestIdx = i;
                    bestSize = s.size;
                }
            }
            if (bestIdx === -1) return null;
            remaining.splice(bestIdx, 1);
            need--;
        }
    }
    for (const [c1, c2] of hybridPips) {
        let bestIdx = -1;
        let bestSize = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const s = remaining[i];
            if ((s.has(c1) || s.has(c2)) && s.size < bestSize) {
                bestIdx = i;
                bestSize = s.size;
            }
        }
        if (bestIdx === -1) return null;
        remaining.splice(bestIdx, 1);
    }
    return remaining.length;
}

/** The single-colour pips of a normalized cost (every `MANA_COLORS` key except
 *  the generic `X` slot), as a plain record — the `coloredNeed` argument to
 *  {@link coverColoredAndHybridPips}. */
export function coloredPipsOf(
    cost: Record<string, number>
): Partial<Record<Color, number>> {
    const out: Partial<Record<Color, number>> = {};
    for (const c of MANA_COLORS) {
        if (c === "C") continue;
        const n = cost[c] ?? 0;
        if (n > 0) out[c] = n;
    }
    return out;
}

/** CR 702.51 / 601.2g — build the convoke creature picker for a cast about to be
 *  announced, or `undefined` when convoke offers nothing (no eligible creatures,
 *  or no pip a creature could pay). Arena-style prompt policy (ADR 0063):
 *
 *  - The pips convoke MAY pay = the single-colour pips + the guild-hybrid pips +
 *    the generic pips of the (already CR-601.2f-reduced) `manaCost`. `max` is
 *    that total, capped by the number of eligible creatures.
 *  - `min` = the pips ONLY convoke can pay: under `cantSpendManaToCast` (Hogaak)
 *    that is EVERY coloured + hybrid pip (mana can't pay them) PLUS the generic
 *    pips delve cannot cover (`max(0, generic − delve fuel)`, since delve pays
 *    only generic), so the caster is FORCED to convoke them; otherwise 0
 *    (convoke is optional and the caster may tap zero creatures). Any generic
 *    left after the convoke pick is then handed to the delve picker / mana
 *    solver — its own forced-minimum catches whatever those can't cover.
 *    Omitting the generic term stranded a natural Hogaak board forever: the
 *    delve picker forced to N but capped below N fuel, generic never reaching 0
 *    (#1338 review).
 *
 *  The hybrid + single-colour pips ride on the choice so `recordConvokeCreaturePick`
 *  can colour-match them to the tapped creatures via {@link coverColoredAndHybridPips}. */
export function buildConvokeCreatureChoice(
    player: PlayerState,
    card: CardInstanceState,
    manaCost: Record<string, number>
): NonNullable<PendingCast["convokeCreatureChoice"]> | undefined {
    if (!spellHasConvoke(card)) return undefined;
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    const printed = getInstanceManaCost(card);
    const hybridPips: [Color, Color][] = (printed?.hybrid ?? []).map(
        ([a, b]) => [a, b]
    );
    const coloredPips = coloredPipsOf(manaCost);
    const coloredCount = Object.values(coloredPips).reduce(
        (s, n) => s + (n ?? 0),
        0
    );
    const generic = genericPortion(manaCost);
    const eligible = convokeEligibleCreatures(player).length;
    const payablePips = coloredCount + hybridPips.length + generic;
    const max = Math.min(eligible, payablePips);
    if (max <= 0) return undefined;
    // CR 601.2f — under can't-spend-mana every coloured + hybrid pip MUST be
    // convoked (mana can't pay it), AND the generic pips that delve cannot
    // cover MUST be convoked too. Delve pays only generic (CR 702.66a), so the
    // caster is forced to convoke `max(0, generic − delve fuel)` extra
    // creatures on top of the coloured/hybrid pips — otherwise the cast strands
    // forever (delve capped below its fuel while generic never reaches 0). The
    // delve-eligible fuel is the caster's graveyard minus the spell itself, and
    // only when the spell actually has delve (else no card pays generic).
    // Otherwise convoke is wholly optional (the caster may tap zero creatures).
    const delveFuel = spellHasDelve(card)
        ? delveEligibleCards(player, card.id).length
        : 0;
    const forced = def?.cantSpendManaToCast
        ? coloredCount + hybridPips.length + Math.max(0, generic - delveFuel)
        : 0;
    const min = Math.min(forced, max);
    return {
        min,
        max,
        hybridPips,
        ...(coloredCount > 0 ? { coloredPips } : {}),
    };
}
