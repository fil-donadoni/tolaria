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

import { tryGetCardById } from ".";
import { ATTACK_RESTRICTION_CTX } from "./attackRestrictions";
import type { PermanentView, StaticEffectStateView } from "./types";

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
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetCardById(cardId);
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
