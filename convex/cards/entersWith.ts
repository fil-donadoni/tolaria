// Shared, frontend-safe evaluation of the "this permanent enters with N
// counters on it" REPLACEMENT effect (CR 121.6 + CR 614.1c) — issue #1693.
//
// CR 121.6: "If an effect says a permanent enters the battlefield with counters
// on it, those counters are put onto that permanent as it enters." CR 614.1c
// classifies that as a self-replacement effect — it modifies HOW the object
// enters the battlefield. Consequences the engine must honour:
//   * the counters are on the permanent the first instant it is observable;
//     there is never a window where it sits on the battlefield with zero;
//   * nothing goes on the stack and nobody gets priority for the placement;
//   * the clause is NOT an ability, so it never renders on the stack or in the
//     ability list;
//   * state-based actions (CR 704) and the layer system (CR 613) see the
//     counters on their very first look at the new permanent.
//
// Lives under `convex/cards/` (NOT `convex/gre/`) for the same reason
// `entersTapped.ts` does: it is a pure read over a `CardDefinition` plus the
// entering object's cast-time snapshot, so the client can evaluate it too.
// The GRE calls it — via the shared `applyEntersWithCounters` applier in
// `gre/state.ts`, which adds the CR 122.1c keyword-counter grant on top — at
// EVERY permanent-entry site, so the sites can never drift out of sync (the
// same "single oracle" shape `resolveEntersTapped` established for the tapped
// clause). The full census (issue #1693):
//   * `finalizeSpellResolution` — a resolving permanent spell, reading the
//     cast-time X / kicker tally. Its definition is re-derived from the stack
//     item AFTER the resolve, so a Clone that copied something during its own
//     resolution gets the COPIED card's entry counters (CR 707.2);
//   * `stageReanimatedOnBattlefield` — reanimation, a library/hand tutor's
//     "put it onto the battlefield", and blink/flicker returns. Applied above
//     the `entersTappedUnlessPay` early return so a deferred land-entry choice
//     doesn't skip it;
//   * `createToken` — a token spec's own `entersWith.counters` (Incubate N).
//     The ONE site NOT gated by the CR 613.1f ability-loss probe below: those
//     counters come from the effect CREATING the token, not from an ability of
//     the token, so "loses all abilities" cannot remove them (issue #1882);
//   * `createTokenCopyOf` — a token COPY inherits the copied card's clause,
//     a copiable value (CR 706.2 / 707.2);
//   * `settleEnteredLand` (`gre/playLand.ts`) — every play-a-land path
//     (hand / exile / graveyard / post-pay-choice). Latent: no shipped Land
//     declares the clause yet.
// Two sites deliberately do NOT run the applier: `finalizeLandEntry`'s
// effect-entry branch (the permanent already got its counters when
// `stageReanimatedOnBattlefield` staged it) and `returnExiledForSource`'s
// noted-counter restore, which MERGES onto the counters the entry placed
// rather than overwriting them.
//
// `gre/scenarioBuilder.ts` is not an entry site — a debug board PLACES a
// permanent — but it defaults an entry's counters to this oracle's output so a
// staged board matches what a real entry would produce.

import { tryGetDefinition } from ".";
import { ATTACK_RESTRICTION_CTX } from "./attackRestrictions";
import type { PermanentView, StaticEffectStateView } from "./types";

/** The card-definition surface that declares the replacement. Structurally
 *  identical to `CardDefinition.entersWith` — restated as a bare shape so this
 *  module stays importable from anywhere without dragging the whole
 *  `CardDefinition` type graph in (mirrors `resolveEntersTapped`'s
 *  parameter). */
export interface EntersWithDeclaration {
    counters?: { type: string; count: number | "X" | "kicker" }[];
}

/** Cast-time values the count vocabulary may read off the entering object.
 *  Both are absent for a permanent that was never cast (reanimation, a
 *  library tutor's "put it onto the battlefield") — CR 107.3b: X is 0 anywhere
 *  other than on the stack, and an uncast permanent was never kicked. */
export interface EntersWithCastValues {
    /** CR 107.3 — the value chosen for X as the spell was cast. */
    chosenX?: number;
    /** CR 702.33e — how many times the spell was kicked (0/1 for a plain
     *  Kicker, 0..N for Multikicker — Everflowing Chalice). */
    kickerCount?: number;
}

/** CR 121.6 / 614.1c — resolves a permanent's declared entry counters into a
 *  concrete `{ counterType: count }` delta, applied AS the permanent enters.
 *
 *  Entries of the same counter type SUM (that is what lets "if this creature
 *  was kicked, it enters with five +1/+1 counters" be five `count: "kicker"`
 *  entries — the established idiom, `inv/green.ts` Llanowar Elite — instead of
 *  a bespoke multiplier field). Non-positive results are dropped: an unkicked
 *  kicker card and an X=0 cast both enter with no counters at all, not with a
 *  zero-valued counter entry. */
export function resolveEntersWithCounters(
    def: { entersWith?: EntersWithDeclaration } | undefined,
    cast: EntersWithCastValues
): Record<string, number> {
    const delta: Record<string, number> = {};
    const declared = def?.entersWith?.counters;
    if (!declared || declared.length === 0) return delta;
    for (const entry of declared) {
        const n =
            entry.count === "X"
                ? Math.max(0, cast.chosenX ?? 0)
                : entry.count === "kicker"
                  ? Math.max(0, cast.kickerCount ?? 0)
                  : entry.count;
        if (n <= 0) continue;
        delta[entry.type] = (delta[entry.type] ?? 0) + n;
    }
    return delta;
}

/** CR 614.1c + 613.1f (issue #1882) — would a layer-6 "loses all abilities"
 *  static ALREADY on the battlefield apply to `entering` once it has entered?
 *
 *  "[This permanent] enters with N counters on it" is a replacement effect
 *  GENERATED BY AN ABILITY of the permanent (CR 614.1c). An effect that removes
 *  all of a permanent's abilities removes that one too, so the permanent enters
 *  with NO counters at all — the canonical Blood Moon / Dark Depths ruling, and
 *  equally Humility, Titania's Song, and Blood Moon's CR 305.7 land-type change
 *  (which the catalogue models as a paired `ability-loss` static, `drk/red.ts`).
 *
 *  A PROBE, not a read of materialized state: at every entry site the permanent
 *  is not yet reconciled against the board (`applyExistingGrantsTo` runs AFTER
 *  the counter applier), so `abilitiesSuppressedBy` is still empty and cannot be
 *  consulted. Instead this scans every permanent already on the battlefield for
 *  `ability-loss` statics and asks each one's own `applies` predicate about the
 *  newcomer — the exact shape `entersTappedByReplacement` (`entersTapped.ts`)
 *  uses for the tapped clause, and card-agnostic for the same reason (the
 *  predicate owns the type/supertype filter, so no card is hardcoded here).
 *
 *  `entering` is skipped as a SOURCE: `finalizeSpellResolution` pushes the
 *  permanent onto the battlefield before calling the applier, so it would
 *  otherwise scan itself.
 *
 *  NOT applicable to counters a token is created with (`TokenSpec.entersWith`,
 *  Incubate N): those come from the resolving effect that creates the token, not
 *  from an ability of the token, so ability-loss cannot remove them. That site
 *  opts out explicitly — see `applyEntersWithCounters`'s `fromCreatingEffect`. */
export function entryAbilitiesSuppressed(
    entering: PermanentView,
    state: StaticEffectStateView
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            if (source.id === entering.id) continue;
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "ability-loss") continue;
                if (effect.applies(entering, source, ATTACK_RESTRICTION_CTX)) {
                    return true;
                }
            }
        }
    }
    return false;
}
