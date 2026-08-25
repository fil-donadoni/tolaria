// Mana CONVERTERS (issue #2420) — the single authority on a `useStack: false`
// mana ability whose activation cost is "tap ONE untapped permanent you
// control matching a filter" (CR 602.1 / 118.8), the shape Urza, Lord High
// Artificer prints as "Tap an untapped artifact you control: Add {U}."
//
// WHY THIS IS A MODULE AND NOT TWO PRIVATE LOOPS
//
// Two authorities have to agree about what such an ability can pay for:
//
//   - the affordance CENSUS  (`coloredCostLeftover` → `canPotentiallyPayCost`
//     → `getLegalActions`, `gre/rules.ts`) — "may the player be offered Cast?"
//   - the payment PLANNER    (`planManaPayment`, `gre/moves.ts`) — "here is
//     the concrete tap sequence."
//
// When the two disagree in the census's favour the player is handed a Cast
// button that parks unpayable in `pendingCast` — the #1695 trap
// (`rules.ts`'s Archaeological Dig comment). Three review rounds on this
// issue each closed one board and re-opened another, because each side
// modelled the ability separately. This module makes them share ONE model.
//
// THE MODEL: THE MANA BELONGS TO THE PERMANENT THAT GETS TAPPED
//
// The naive reading — "Urza is a mana source producing {U}" — double-counts.
// Urza's ability taps a DIFFERENT permanent, and that permanent is already
// counted as a mana source in its own right, so `[Urza, Mox Sapphire]` looks
// like two blue when it is one (tap Sapphire for {U}, OR tap Sapphire to pay
// Urza for {U} — never both).
//
// The exact model is instead: the ability WIDENS the set of colours the
// FODDER permanent can produce. `[Urza, Mox Sapphire, Mox Jet]` is then
// Sapphire → {U} and Jet → {B} ∪ {U} = two units, one of them blue-capable
// twice over — which is right: Sapphire taps for its own {U} and Urza taps
// Jet for the second. Capacity stays "one unit per PHYSICAL permanent",
// which is what makes double-counting impossible by construction rather than
// by bookkeeping.
//
// The converter itself contributes NO unit of its own. Nothing constrains it:
// its cost carries no {T}, so it may be already tapped (CR 302.6 governs a
// {T}/{Q} cost and nothing else), it may be summoning sick, and it is
// REPEATABLE — one Urza with three untapped artifacts is three blue, one per
// artifact. Conversely the FODDER need not be untapped-for-its-own-sake or
// sickness-free either: being tapped to pay someone else's cost is not a
// {T} activation (same rule; cf. crew, CR 702.122b).
//
// SCOPE, FAIL-CLOSED. Only `count: 1` / fixed `manaProduced` / exactly one
// mana produced qualifies. A `totalPower` leg (crew), a `count >= 2` leg
// (Hand of Justice's three white creatures) or a choice-based output would
// each break the one-unit-per-permanent identity above, so they are excluded
// here rather than modelled wrongly on either side. Urza is the only shipped
// `useStack: false` `tapOtherFilter` mana ability; every other shipped
// `tapOtherFilter` cost belongs to a `useStack: true` ability (Hand of
// Justice, Vodalian War Machine, Karplusan Giant, Earthcraft, Soul Burn's
// Swamp tap) and is not a mana ability at all.

import type { ActivatedAbility, Color } from "../cards/types";
import type { GameState, PlayerState } from "./state";
import {
    MANA_COLORS,
    abilitiesSuppressed,
    isAutoPayableManaAbilityCost,
    mayHaveNonTapManaAbility,
} from "./constants";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { tapOtherCandidates } from "./activationCostPicks";

/** One way to realise mana by tapping a particular FODDER permanent: which
 *  permanent activates the ability, which ability, and the colours it adds. */
export interface ManaConverterLeg {
    /** The permanent whose ability is activated (Urza) — never tapped by it
     *  (CR 602.1). */
    converterId: string;
    abilityId: string;
    /** Colours the activation adds to the pool (exactly one mana total). */
    colors: readonly Color[];
}

/** Shared empty result — also the value a caller that has already established
 *  the board carries no non-tap mana ability at all can substitute for the
 *  scan (`planManaPayment`, moves.ts). */
export const NO_MANA_CONVERTER_LEGS: ReadonlyMap<
    string,
    readonly ManaConverterLeg[]
> = new Map();

/** True for the ONE ability shape this module models (see the header). Shared
 *  by the cheap prefilter and the real classification so they cannot drift. */
function isSingleTapOtherManaAbility(ability: ActivatedAbility): boolean {
    if (ability.useStack) return false;
    if (ability.cost.tap) return false;
    const leg = ability.cost.tapOtherFilter;
    if (!leg) return false;
    if (leg.totalPower !== undefined) return false;
    if ((leg.count ?? 0) !== 1) return false;
    // A choice-based output (`manaChoices` / `getManaChoices` /
    // `manaColorSource`) would need a `manaChoiceIndex` on the realising
    // `ManaTap`; no shipped card has one, so fail closed rather than emit an
    // index the mutation would reject.
    if (
        ability.manaChoices ||
        ability.getManaChoices ||
        ability.manaColorSource
    ) {
        return false;
    }
    const produced = ability.manaProduced;
    if (!produced) return false;
    let total = 0;
    for (const c of MANA_COLORS) total += produced[c] ?? 0;
    if (total !== 1) return false;
    // Every other cost leg (sacrifice, life, counters, …) stays off the
    // automatic path, exactly as `isAutoPayableManaAbilityCost` decides for
    // the tap-option gate (`getManaTapOptionsDetailed`) — the same predicate,
    // so admission here can never be wider than admission there.
    return isAutoPayableManaAbilityCost(ability.cost);
}

/** Every colour each of `player`'s permanents can produce BY BEING TAPPED as
 *  another permanent's `tapOtherFilter` mana cost, keyed by the FODDER
 *  permanent's instance id. Empty (and near-free) on a board with no such
 *  ability, which is every board without Urza.
 *
 *  The candidate scan is `tapOtherCandidates` — the SAME authority the server
 *  uses to decide what a real activation may tap (`selectActivationCost`,
 *  `game.ts`) — so "who can be fodder" can never drift from what the
 *  mutation would accept. It already excludes the converter itself and every
 *  tapped permanent (CR 118.8). */
export function collectManaConverterLegs(
    state: GameState,
    player: PlayerState
): ReadonlyMap<string, readonly ManaConverterLeg[]> {
    let legs: Map<string, ManaConverterLeg[]> | null = null;
    for (const converter of player.battlefield) {
        // `mayHaveNonTapManaAbility` (constants.ts) is a strict SUPERSET of
        // what `isSingleTapOtherManaAbility` accepts, read off the PRINTED
        // definition — so an ordinary board pays a map lookup per permanent
        // rather than a post-layer ability walk.
        if (!mayHaveNonTapManaAbility(converter)) continue;
        if (abilitiesSuppressed(converter)) continue;
        for (const { ability } of getEffectiveActivatedAbilities(converter)) {
            if (!isSingleTapOtherManaAbility(ability)) continue;
            const colors = MANA_COLORS.filter(
                (c) => (ability.manaProduced?.[c] ?? 0) > 0
            );
            if (colors.length === 0) continue;
            for (const candidate of tapOtherCandidates(
                state,
                player,
                converter,
                ability
            )) {
                legs ??= new Map();
                const row = legs.get(candidate.id);
                const leg: ManaConverterLeg = {
                    converterId: converter.id,
                    abilityId: ability.id,
                    colors,
                };
                if (row) row.push(leg);
                else legs.set(candidate.id, [leg]);
            }
        }
    }
    return legs ?? NO_MANA_CONVERTER_LEGS;
}

/** The union of colours each fodder permanent can be converted into — the
 *  census's view of {@link collectManaConverterLegs} (it needs capacity, not
 *  the realising activation). */
export function manaConverterColors(
    state: GameState,
    player: PlayerState
): ReadonlyMap<string, ReadonlySet<Color>> {
    const legs = collectManaConverterLegs(state, player);
    if (legs.size === 0) return new Map();
    const out = new Map<string, Set<Color>>();
    for (const [fodderId, rows] of legs) {
        const set = new Set<Color>();
        for (const row of rows) for (const c of row.colors) set.add(c);
        out.set(fodderId, set);
    }
    return out;
}
