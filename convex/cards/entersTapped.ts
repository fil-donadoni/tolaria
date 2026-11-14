// Shared, frontend-safe evaluation of the battlefield-scanned, player-scoped
// "opponents' permanents enter tapped" replacement (CR 614.1c + 110.5b) —
// Kismet (#483).
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the same scan can be
// reused anywhere a frontend-safe view is available, while the GRE applies it
// at every enters-the-battlefield site. An `enters-tapped-restriction` static
// declared by ANY permanent (Kismet) can force OTHER players' permanents to
// enter tapped — the symmetric analogue of how Crusade-style anthems
// (`pt-buff`) scan all permanents and buff a filtered set, and of
// `globalAttackProhibitionReason` in `attackRestrictions.ts`.

import { liveDefinitionOf } from "./liveStatics";
import { ATTACK_RESTRICTION_CTX } from "./attackRestrictions";
import { controlsHolds } from "./compiledStatics";
import type { CompiledControlsCondition } from "./compiledTriggers";
import { hasSupertypeLive } from "./snowReads";
import type {
    LandEntryStateView,
    PermanentView,
    StaticEffectContext,
    StaticEffectStateView,
} from "./types";

/** Scans EVERY permanent on the battlefield for `enters-tapped-restriction`
 *  static effects (CR 614) and returns `true` when a source forces the
 *  `entering` permanent (about to enter under `entering.controllerId`) to enter
 *  tapped, else `false`. The source's `forcesTapped` predicate is responsible
 *  for the opponent filter and the artifact/creature/land type filter, so this
 *  function stays card-agnostic (does NOT hardcode Kismet).
 *
 *  Reuses `ATTACK_RESTRICTION_CTX` — a pure, state-free `StaticEffectContext`
 *  shared by every battlefield-scan predicate in `convex/cards/`. */
export function entersTappedByReplacement(
    entering: PermanentView,
    state: StaticEffectStateView
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const def = liveDefinitionOf(source);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "enters-tapped-restriction") continue;
                if (
                    effect.forcesTapped(
                        entering,
                        source,
                        state,
                        ATTACK_RESTRICTION_CTX
                    )
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** CR 614.1d — scans EVERY permanent on the battlefield for
 *  `enters-untapped-replacement` static effects (Spelunking: "Lands you
 *  control enter untapped") and returns `true` when a source makes the
 *  `entering` permanent (about to enter under `entering.controllerId`) enter
 *  untapped. Like `entersTappedByReplacement`, the source's predicate owns the
 *  controller and type filter, so no card is named here.
 *
 *  CR 616.1 / 616.1e — when this and an "enters tapped" replacement both
 *  apply, the entering permanent's controller orders them; applying this one
 *  last yields an untapped permanent. The engine takes that order without
 *  asking: an untapped permanent can do everything a tapped one can and more,
 *  so the tapped order is dominated (Arena orders it the same way). Gatherer's
 *  Spelunking ruling also makes a permanent an effect simply "puts onto the
 *  battlefield tapped" — no replacement applied — enter untapped, so every
 *  authored tapped entry asks this predicate too. A source entering AT THE
 *  SAME TIME as the permanent is not on the battlefield yet and does not
 *  apply (the second Spelunking ruling), which the pre-move scan gives for
 *  free. */
export function entersUntappedByReplacement(
    entering: PermanentView,
    state: StaticEffectStateView
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const def = liveDefinitionOf(source);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "enters-untapped-replacement") continue;
                if (
                    effect.forcesUntapped(
                        entering,
                        source,
                        state,
                        ATTACK_RESTRICTION_CTX
                    )
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** The context an entry condition reads its filter through: the pure
 *  battlefield-scan context, with the live supertype status (CR 205.4c — a
 *  land that lost or gained "basic" is read as it is now, not as printed).
 *  Built on first use, never at module load: a module-scope spread reads
 *  `ATTACK_RESTRICTION_CTX` the moment `gre/state.ts` imports this file, which
 *  throws under any `vi.mock` of `attackRestrictions` that omits it (the RED
 *  of PR #8710, issue #8655). */
let entryConditionCtx: StaticEffectContext | undefined;
function getEntryConditionCtx(): StaticEffectContext {
    entryConditionCtx ??= {
        ...ATTACK_RESTRICTION_CTX,
        hasSupertype: hasSupertypeLive,
    };
    return entryConditionCtx;
}

/** Single oracle for "does this permanent enter the battlefield tapped?"
 *  (CR 614.1c), folding together every source of tapped-entry so every ETB
 *  site (played land, resolved spell, reanimation, token creation) asks the
 *  SAME question the SAME way:
 *   1. the card's own unconditional `entersTapped: true` (Nevinyrral's Disk);
 *   2. the card's own conditional `entersTappedUnless` predicate (fast lands,
 *      Arena of Glory, Starting Town) — taps unless the predicate holds;
 *      and its JSON-pure twin `entersTappedUnlessControls` (CR 614.1d, "unless
 *      you control a basic land");
 *   3. a battlefield-scanned opponent-forced replacement (Kismet);
 *  all of them overridden by a battlefield-scanned "enter untapped"
 *  replacement (Spelunking), applied last per CR 616.1.
 *  `def` is looked up by the caller (from `entering`'s card id) so this stays
 *  usable both where a full `CardDefinition` is already in hand and where only
 *  the bare `entering` view is. Frontend-safe: no GameState-only fields read. */
export function resolveEntersTapped(
    def:
        | {
              entersTapped?: boolean;
              entersTappedUnless?: (
                  view: LandEntryStateView,
                  controllerId: string
              ) => boolean;
              entersTappedUnlessControls?: CompiledControlsCondition;
          }
        | undefined,
    entering: PermanentView,
    state: StaticEffectStateView & LandEntryStateView
): boolean {
    // CR 616.1 — an "enter untapped" replacement is applied last, so it wins
    // over every tapped source below (`entersUntappedByReplacement`).
    if (entersUntappedByReplacement(entering, state)) return false;
    if (def?.entersTapped === true) return true;
    if (
        def?.entersTappedUnless &&
        !def.entersTappedUnless(state, entering.controllerId)
    ) {
        return true;
    }
    if (
        def?.entersTappedUnlessControls &&
        !controlsHolds(
            def.entersTappedUnlessControls,
            entering,
            state,
            getEntryConditionCtx()
        )
    ) {
        return true;
    }
    return entersTappedByReplacement(entering, state);
}
