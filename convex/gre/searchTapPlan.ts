// The search's coarse mana payment — ONE copy (issue #4444).
//
// Every search-side sandbox pays a Move's mana the same way: it marks the
// planned sources tapped rather than draining the pool coin-exact. Until issue
// #4444 that model lived in THREE hand-kept copies — the ISMCTS applier
// (`applyMoveInSearch`, `search.ts`), the greedy 1-ply sandbox
// (`applyMoveForSearch`, `applyMove.ts`) and the dominance probe
// (`ai/dominance.ts`) — and they had drifted: the probe paid the exert leg but
// never the sacrifice or the counter leg, so a probe board could keep a Black
// Lotus the tree had already sacrificed.
//
// A LEAF module on purpose: it imports only engine primitives, never `moves.ts`,
// `search.ts` or `applyMove.ts`, so the dominance probe (which `moves.ts`
// imports at runtime) can share it without closing an import cycle.

import type { ManaCost } from "../cards/types";
import type { GameState } from "./state";
import {
    canPayRemoveCounterCost,
    moveCard,
    payRemoveCounterCost,
} from "./state";
import {
    getManaTapOptionsDetailed,
    manaGateBattlefields,
    manaTapCounterCost,
    manaTapExertsSource,
    manaTapSacrificesSource,
    mayBeSacrificedForMana,
    mayExertForMana,
    mayRemoveCountersForMana,
    stackManaValue,
} from "./constants";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { payExertActivationCost } from "./exert";
import { MANA_COLORS } from "./manaColors";

/** One entry of a Move's `tapPlan` (`gre/moves.ts`). */
export type SearchTapPlanEntry = {
    cardInstanceId: string;
    abilityId?: string;
    manaChoiceIndex?: number;
    tapOtherIds?: string[];
};

/** Tap the planned mana sources in place. Coarse model: a source listed in the
 *  tap plan is marked tapped so the resulting position reflects the spent mana;
 *  the pool is neither credited nor debited.
 *
 *  Issue #2420 — an `abilityId`-carrying entry ACTIVATES the source's own
 *  non-tap mana ability (Urza's `tapOtherFilter`, Farrelite Priest's pure
 *  `cost.mana`) rather than tapping the source: `cardInstanceId` itself is
 *  never tapped by this payment (CR 602.1); only the permanent(s) named in
 *  `tapOtherIds`, if any, are.
 *
 *  KNOWN COARSENESS (PR #3549 review finding 7) — sources are TAPPED but
 *  `manaPool` / `restrictedMana` are never debited, so mana ALREADY FLOATING
 *  when the tree was entered is free inside it: a plan may draw on it once per
 *  simulated cast without it ever running out. A pool source is a zero-tap
 *  `PlanSource` (`cardInstanceId` undefined, `gre/moves.ts`), so it leaves no
 *  entry for this function to charge against even in principle — closing it
 *  means changing the plan's shape, not this loop. The error is the bot
 *  OVER-estimating what it can cast in-tree, an optimistic line rather than an
 *  illegal move — every real move still goes through `assertLegalAction`
 *  server-side (ADR 0074). Recorded in
 *  `docs/findings/3549-search-does-not-debit-floating-mana.md`.
 *
 *  The dominance probe relies on the same property from the other side: since
 *  the pool is untouched by cost payment, a pool DIFFERENCE between probe and
 *  baseline is mana the RESOLUTION made (`ai/dominance.ts`, `isNoOpDelta`). */
export function applyTapPlanInSearch(
    state: GameState,
    playerId: string,
    tapPlan: readonly SearchTapPlanEntry[]
): void {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    // CR 605.1a / 118.3 (Breach probe) — a mana ability paid by SACRIFICING
    // its source (Black Lotus, Basal Thrull, the Mirage sac-lands, Lion's Eye
    // Diamond) puts the permanent in the GRAVEYARD; `tapSourceIntoPayment`
    // (`convex/game.ts`) does exactly that on the real path. This model used
    // to only set `isTapped`, so inside the tree the source sat tapped on the
    // battlefield forever and never reached the graveyard — which made every
    // graveyard-as-resource line structurally invisible to the search at ANY
    // depth, not merely beyond its horizon: a Black Lotus could never become
    // Underworld Breach escape fodder, so the Lotus loop that powers storm
    // could not be assembled. Guarded by the cheap printed-definition
    // prefilter, so an ordinary board of lands and {T} rocks pays one cached
    // lookup per tap and nothing else.
    const sacrificed: string[] = [];
    for (const tap of tapPlan) {
        if (tap.abilityId) {
            for (const otherId of tap.tapOtherIds ?? []) {
                const other = player.battlefield.find((c) => c.id === otherId);
                if (other) other.isTapped = true;
            }
            continue;
        }
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (!src) continue;
        if (
            mayBeSacrificedForMana(src) &&
            manaTapSacrificesSource(
                src,
                player.id,
                manaGateBattlefields(state),
                tap.manaChoiceIndex
            )
        ) {
            sacrificed.push(src.id);
            continue;
        }
        // CR 118.3 / 122.1 (issue #2712) — and the COUNTERS the activation
        // spends, for the same reason the sacrifice above is modelled: a
        // depletion land whose counters never move untaps next simulated turn
        // and taps again forever, so the search values a two-use land as a
        // permanent mana source. Read AFTER the sacrifice test, which asks
        // about the counters BEFORE this payment. Behind the same cheap
        // printed-definition prefilter, so an ordinary board pays one cached
        // lookup per tap.
        if (mayRemoveCountersForMana(src)) {
            const leg = manaTapCounterCost(
                src,
                player.id,
                manaGateBattlefields(state),
                tap.manaChoiceIndex
            );
            if (leg && canPayRemoveCounterCost(src, leg)) {
                payRemoveCounterCost(state, src, leg);
            }
        }
        // CR 701.43a / 602.1a (issue #3359) — and the EXERT leg, modelled for
        // exactly the reason the sacrifice and the counters above are: the
        // payment spends the source's NEXT UNTAP STEP, so a model that only
        // taps it has the land untapping next simulated turn and taps again
        // forever — the Bot reaching for the costed half of Arena of Glory at
        // no price at all. `tapSourceIntoPayment` (`convex/game.ts`) pays it
        // through `applyManaAbilityExertCost` for the ability the
        // `manaChoiceIndex` names, and `manaTapExertsSource` resolves that same
        // option list. Behind the same cheap printed-definition prefilter, so
        // an ordinary board pays one cached lookup per tap.
        if (
            mayExertForMana(src) &&
            manaTapExertsSource(
                src,
                player.id,
                manaGateBattlefields(state),
                tap.manaChoiceIndex
            )
        ) {
            payExertActivationCost(state, src);
        }
        src.isTapped = true;
    }
    // Moved after the loop so a plan naming the same source twice cannot make
    // the second lookup miss (the planner never emits one — see
    // `manaConverterParity.bot.test.ts` invariant B — but this model must not
    // depend on that).
    for (const id of sacrificed) {
        moveCard(player, id, "battlefield", "graveyard");
    }
}

/** The order a GENERIC mana leg drains the scratch pool in
 *  {@link searchCastManaSpent}: colourless first, then the colours in reverse
 *  WUBRG — deterministic, and never the reason a colour goes missing. */
const GENERIC_LEG_DRAIN_ORDER = [...MANA_COLORS].reverse();

/** CR 601.2h / 702.44a — the per-colour record of the mana a SEARCH cast
 *  spends, for the `StackItem.notedManaSpent` a `noteManaSpent` card reads
 *  back (Converge's `colorsSpentToCast`, Sunburst's counters, an "if {R}{R}
 *  was spent" condition). The real path takes a pool delta around
 *  `payCastManaCost`; this model never drains the pool, so the record is
 *  rebuilt from the Move's tap plan instead.
 *
 *  MUST be called BEFORE `applyTapPlanInSearch`: a sacrificed source has left
 *  the battlefield after it, and a depletion land's option list has changed.
 *
 *  Each entry is walked in plan order through a scratch pool, as the server
 *  walks the taps: the activation's own mana leg (Arena of Glory's `{R}`,
 *  Farrelite Priest's `{1}`) is paid out of what the earlier taps produced,
 *  then the option's yield is added. What the scratch pool holds at the end is
 *  what the spell was paid with. A plan's FLOATING-pool sources leave no
 *  entry (`gre/moves.ts`), so when the taps produced less than `printed` —
 *  the printed mana cost at the announced X — the shortfall is drawn from the
 *  caster's pool, colours the cost names first.
 *
 *  Coarse by design: a multi-mana source's surplus counts as spent; a cost
 *  reduction, delve or life-paid Phyrexian pips can make the shortfall
 *  over-draw the pool, and hybrid pips draw it in WUBRG order; an alternative
 *  cost passes no `printed` (its price is not the printed one), so it reads
 *  the taps alone. The reads that matter are colour presence and per-colour
 *  counts, and both come from the sources the plan really taps. */
export function searchCastManaSpent(
    state: GameState,
    playerId: string,
    tapPlan: readonly SearchTapPlanEntry[],
    printed?: { manaCost: ManaCost | undefined; chosenX?: number }
): Record<string, number> {
    const spent: Record<string, number> = {};
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return spent;
    const battlefields = manaGateBattlefields(state);
    for (const tap of tapPlan) {
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (!src) continue;
        let yieldMana: ManaCost | undefined;
        let abilityId = tap.abilityId;
        if (abilityId) {
            const ability = getEffectiveActivatedAbilities(src).find(
                (a) => a.ability.id === abilityId
            )?.ability;
            yieldMana =
                ability?.manaChoices?.[tap.manaChoiceIndex ?? 0] ??
                ability?.manaProduced;
        } else {
            // A plan with no index taps a single-option source, so index 0 is
            // the option it names (`manaTapSacrificesSource`). `state` carries
            // the per-turn mana replacements (Deep Water), as on the server.
            const opt = getManaTapOptionsDetailed(
                src,
                player.id,
                battlefields,
                { requireTap: true },
                undefined,
                state
            )[tap.manaChoiceIndex ?? 0];
            yieldMana = opt?.mana;
            if (opt?.source.kind === "activated")
                abilityId = opt.source.abilityId;
        }
        const leg = abilityId
            ? getEffectiveActivatedAbilities(src).find(
                  (a) => a.ability.id === abilityId
              )?.ability.cost.mana
            : undefined;
        if (leg) drainManaLeg(spent, leg);
        for (const color of MANA_COLORS) {
            const n = yieldMana?.[color] ?? 0;
            if (n > 0) spent[color] = (spent[color] ?? 0) + n;
        }
    }
    if (printed) {
        let shortfall =
            stackManaValue(printed.manaCost, printed.chosenX) -
            MANA_COLORS.reduce((sum, c) => sum + (spent[c] ?? 0), 0);
        const pool = { ...player.manaPool } as Record<string, number>;
        const draw = (color: string, wanted: number) => {
            const n = Math.min(wanted, pool[color] ?? 0, shortfall);
            if (n <= 0) return;
            pool[color] -= n;
            spent[color] = (spent[color] ?? 0) + n;
            shortfall -= n;
        };
        for (const color of MANA_COLORS) {
            const pips = printed.manaCost?.[color];
            if (typeof pips === "number")
                draw(color, pips - (spent[color] ?? 0));
        }
        for (const color of MANA_COLORS) draw(color, Infinity);
    }
    return spent;
}

/** Pay one mana ability's own mana leg out of the scratch pool
 *  {@link searchCastManaSpent} keeps: coloured pips from their colour, the
 *  generic part from {@link GENERIC_LEG_DRAIN_ORDER}. Best-effort — whatever
 *  the scratch pool cannot cover simply goes unpaid. */
function drainManaLeg(pool: Record<string, number>, leg: ManaCost): void {
    const take = (color: string, wanted: number): number => {
        const n = Math.min(wanted, pool[color] ?? 0);
        if (n > 0) pool[color] -= n;
        if (pool[color] === 0) delete pool[color];
        return Math.max(n, 0);
    };
    for (const color of MANA_COLORS) {
        const pips = leg[color];
        if (typeof pips === "number") take(color, pips);
    }
    let generic = (leg.generic ?? 0) + (typeof leg.X === "number" ? leg.X : 0);
    for (const color of GENERIC_LEG_DRAIN_ORDER) {
        if (generic <= 0) break;
        generic -= take(color, generic);
    }
}
