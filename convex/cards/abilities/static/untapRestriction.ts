// `untapRestriction` — static-effect factory for untap-step caps
// (CR 502.1 — "First, the active player determines which of the permanents
// they control will untap"). Encodes Winter Orb / Smoke / Stasis / Meekstone-
// style restrictions as data: a structured `StaticUntapRestriction` member of
// the `StaticEffect` union read by the engine dispatcher in `untapStep`.
//
// Each restriction carries a `PermanentFilter` (which permanents fall under
// the cap) and a `maxUntap` integer (how many of them the active player may
// untap during their untap step). The engine walks restrictions in
// battlefield order across both players (active first) and either
// auto-resolves the cap (when there is no real choice per ADR 0003) or
// enqueues a `untap-pick` `PendingChoice` routed to the active player.
//
// Mirrors the trigger-factory family (ADR 0002): card authors call the
// factory in `staticEffects[]`; the resulting object is structurally typed
// and discriminated on `kind`, so the engine can branch on it without
// reflection.

import type { PermanentFilter } from "../../filters";
import type {
    CardDefinition,
    PermanentView,
    StaticUntapRestriction,
} from "../../types";

export type UntapRestrictionScope = "each-player";

/** CR 605.1a — a mana ability is an activated ability that could add mana, has
 *  no target, and isn't a loyalty ability; the engine models it as
 *  `useStack: false`. This returns true when `def` has at least one activated
 *  ability that taps the source (`cost.tap`) AND is NOT a mana ability
 *  (`useStack: true`) — i.e. "an activated ability with {T} in its cost that
 *  isn't a mana ability" (Tsabo's Web). Reads the printed definition; granted
 *  abilities (layer 6) are out of scope for this pool. */
export function hasNonManaTapActivatedAbility(def: CardDefinition): boolean {
    return (def.activatedAbilities ?? []).some(
        (a) => a.cost.tap === true && a.useStack === true
    );
}

export interface UntapRestrictionArgs {
    /** Stable id used for collectedChoices keying / event tagging. Must be
     *  unique per source card. */
    id: string;
    /** Oracle line surfaced in the pending-choice prompt (CR 502.1 — the
     *  restriction's printed text). */
    oracleText: string;
    /** Permanents this cap applies to. Empty filter = "every permanent". The
     *  filter is matched against the active player's battlefield at untap
     *  time. */
    filter: PermanentFilter;
    /** Inclusive upper bound on how many matching permanents the active
     *  player may untap during their untap step (CR 502.1). Defaults to 0 —
     *  a "hard skip" of the matching set (Stasis-style). */
    maxUntap?: number;
    /** Whose untap step the cap binds. `each-player` (default) — applies
     *  whenever the restriction is in play, regardless of who controls the
     *  source (Winter Orb / Smoke / Stasis). Reserved for future
     *  controller-scoped restrictions. */
    scope?: UntapRestrictionScope;
    /** Per-candidate refinement resolved at untap-collection time (CR 502.1).
     *  See `StaticUntapRestriction.dynamicMatch` — used by Tsabo's Web to match
     *  lands whose card definition carries a non-mana {T} activated ability, a
     *  property `PermanentFilter` can't express. */
    dynamicMatch?: (candidate: PermanentView, def: CardDefinition) => boolean;
}

/** Builds a `StaticUntapRestriction` for `staticEffects[]`. The engine
 *  collects these at untap-step entry; card authors don't write the
 *  dispatcher loop themselves. */
export function untapRestriction(
    args: UntapRestrictionArgs
): StaticUntapRestriction {
    return {
        kind: "untap-restriction",
        id: args.id,
        oracleText: args.oracleText,
        filter: args.filter,
        maxUntap: args.maxUntap ?? 0,
        scope: args.scope ?? "each-player",
        ...(args.dynamicMatch ? { dynamicMatch: args.dynamicMatch } : {}),
    };
}
