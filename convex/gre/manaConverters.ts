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
// SCOPE, FAIL-CLOSED. Only `count: 1` and exactly one mana per activation
// qualifies — a fixed `manaProduced`, or a static `manaChoices` list of
// single-mana entries ("Add one mana of any color"), realised by a
// `manaChoiceIndex`. A `totalPower` leg (crew), a `count >= 2` leg (Hand of
// Justice's three white creatures) or a board-derived chooser would each break
// the one-unit-per-permanent identity above, so they are excluded here rather
// than modelled wrongly on either side.
//
// {T} BESIDE THE TAP-OTHER LEG. "{T}, Tap an untapped creature you control:
// Add one mana of any color" (Springleaf Drum, CR 605.1a) spends the converter
// itself, so it is the opposite case: the unit belongs to the CONVERTER (keyed
// by its id, one activation per untap), and the fodder it taps beside its own
// {T} is RESERVED at collection time — a permanent with no mana ability of its
// own, one per converter, never one Urza's shape already widens — so no
// physical tap is counted twice. Its own {T} needs it untapped and, a
// creature, free of summoning sickness (CR 302.6); the fodder needs neither.

import type { ActivatedAbility, Color } from "../cards/types";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "./state/declarations";
import {
    MANA_COLORS,
    abilitiesSuppressed,
    hasManaAbility,
    isAutoPayableManaAbilityCost,
    isTapLockedBySummoningSickness,
    mayHaveNonTapManaAbility,
} from "./constants";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { activationRestrictionViolation } from "./activationRestrictions";
import { tapOtherCandidates } from "./activationCostPicks";

/** One way to realise mana by tapping a particular FODDER permanent: which
 *  permanent activates the ability, which ability, and the colours it adds. */
export interface ManaConverterLeg {
    /** The permanent whose ability is activated (Urza) — never tapped by it
     *  (CR 602.1), unless the cost carries its own {T} too (`fodderId`). */
    converterId: string;
    abilityId: string;
    /** Colours the activation adds to the pool (exactly one mana total). */
    colors: readonly Color[];
    /** A TAPPING converter's leg (see the header's "{T} beside the tap-other
     *  leg"): keyed by the converter itself, and this is the permanent it taps
     *  beside its own {T}. Absent for Urza's shape, whose fodder is the key. */
    fodderId?: string;
    /** CR 605.1a / 106.1 — the activation's `manaChoiceIndex` per colour, for
     *  a choice output ("Add one mana of any color"). Absent for a fixed one. */
    choiceIndexByColor?: Partial<Record<Color, number>>;
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
    const leg = ability.cost.tapOtherFilter;
    if (!leg) return false;
    if (leg.totalPower !== undefined) return false;
    if ((leg.count ?? 0) !== 1) return false;
    if (converterOutput(ability) === null) return false;
    // Every other cost leg (sacrifice, life, counters, …) stays off the
    // automatic path, exactly as `isAutoPayableManaAbilityCost` decides for
    // the tap-option gate (`getManaTapOptionsDetailed`) — the same predicate,
    // so admission here can never be wider than admission there. A {T} beside
    // the leg is this module's to pay (the tapping converter), so it is read
    // off the rest of the cost.
    return isAutoPayableManaAbilityCost({ ...ability.cost, tap: undefined });
}

/** The colours ONE activation can add, each exactly one mana, with the
 *  `manaChoiceIndex` that realises it for a choice output (CR 605.1a / 106.1:
 *  "Add one mana of any color" is a static `manaChoices` list of single-mana
 *  entries). `null` for any other shape — a board-derived chooser
 *  (`getManaChoices` / `manaColorSource`) or a multi-mana output would break
 *  the one-unit-per-permanent identity, so it fails closed. */
function converterOutput(ability: ActivatedAbility): {
    colors: Color[];
    choiceIndexByColor?: Partial<Record<Color, number>>;
} | null {
    if (ability.getManaChoices || ability.manaColorSource) return null;
    const single = (mana: ActivatedAbility["manaProduced"]): Color | null => {
        if (!mana) return null;
        let total = 0;
        let color: Color | null = null;
        for (const c of MANA_COLORS) {
            const n = mana[c] ?? 0;
            total += n;
            if (n > 0) color = c;
        }
        if ((mana.X ?? 0) !== 0) return null;
        return total === 1 ? color : null;
    };
    if (ability.manaChoices) {
        const choiceIndexByColor: Partial<Record<Color, number>> = {};
        for (let i = 0; i < ability.manaChoices.length; i++) {
            const c = single(ability.manaChoices[i]);
            if (c === null) return null;
            choiceIndexByColor[c] ??= i;
        }
        const colors = MANA_COLORS.filter(
            (c) => choiceIndexByColor[c] !== undefined
        );
        return colors.length > 0 ? { colors, choiceIndexByColor } : null;
    }
    const c = single(ability.manaProduced);
    return c === null ? null : { colors: [c] };
}

/** CR 302.6 — a TAPPING converter's fodder must not be a mana source the
 *  planner may spend on its own, or ONE physical tap would be counted twice;
 *  a permanent with no mana ability of its own (the usual creature) is the
 *  shape that keeps the one-unit-per-permanent identity. Among those, a
 *  summoning-sick creature is preferred: it could not attack this turn
 *  anyway, so tapping it costs the least. */
function pickTappingConverterFodder(
    candidates: readonly CardInstanceState[],
    taken: ReadonlySet<string>
): CardInstanceState | undefined {
    const free = candidates.filter(
        (c) =>
            !taken.has(c.id) &&
            !hasManaAbility(c) &&
            !mayHaveNonTapManaAbility(c)
    );
    return free.find((c) => isTapLockedBySummoningSickness(c)) ?? free[0];
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
    const tapping: {
        converter: CardInstanceState;
        ability: ActivatedAbility;
        output: NonNullable<ReturnType<typeof converterOutput>>;
    }[] = [];
    for (const converter of player.battlefield) {
        // `mayHaveNonTapManaAbility` (constants.ts) is a strict SUPERSET of
        // what `isSingleTapOtherManaAbility` accepts, read off the PRINTED
        // definition — so an ordinary board pays a map lookup per permanent
        // rather than a post-layer ability walk.
        if (!mayHaveNonTapManaAbility(converter)) continue;
        if (abilitiesSuppressed(converter)) continue;
        // CR 602.5 / 605.1a — a converter whose mana abilities an
        // `activation-restriction` static prohibits (Urza under Cursed Totem)
        // funds nothing: `activateManaAbility` would refuse the leg.
        if (
            activationRestrictionViolation(state, converter.id, true) !== null
        ) {
            continue;
        }
        for (const { ability } of getEffectiveActivatedAbilities(converter)) {
            if (!isSingleTapOtherManaAbility(ability)) continue;
            const output = converterOutput(ability);
            if (!output) continue;
            const { colors } = output;
            if (ability.cost.tap) {
                tapping.push({ converter, ability, output });
                continue;
            }
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
    // CR 605.1a / 302.6 — a TAPPING converter ("{T}, Tap an untapped creature
    // you control: Add one mana of any color", Springleaf Drum) spends ITSELF:
    // one unit, keyed by the converter, realised by tapping it AND one
    // reserved fodder. Its own {T} needs it untapped and, a creature, free of
    // summoning sickness. Each fodder is reserved for one converter, and never
    // one Urza's shape already counts, so no physical tap is counted twice.
    const taken = new Set<string>(legs?.keys() ?? []);
    for (const t of tapping) taken.add(t.converter.id);
    for (const { converter, ability, output } of tapping) {
        if (converter.isTapped) continue;
        if (isTapLockedBySummoningSickness(converter)) continue;
        if (legs?.has(converter.id)) continue;
        const candidateIds = new Set(
            tapOtherCandidates(state, player, converter, ability).map(
                (c) => c.id
            )
        );
        const fodder = pickTappingConverterFodder(
            player.battlefield.filter((c) => candidateIds.has(c.id)),
            taken
        );
        if (!fodder) continue;
        taken.add(fodder.id);
        legs ??= new Map();
        legs.set(converter.id, [
            {
                converterId: converter.id,
                abilityId: ability.id,
                colors: output.colors,
                fodderId: fodder.id,
                ...(output.choiceIndexByColor
                    ? { choiceIndexByColor: output.choiceIndexByColor }
                    : {}),
            },
        ]);
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
