// Shared predicates for `combat-damage-prevention` static effects (CR 615 /
// 611). These are the SOURCE filters that decide whether combat damage from a
// given creature to the prevention's owner is prevented. They live under
// `convex/cards/` (alongside the card definitions that use them) and read only
// the narrow `CombatPreventionStateView`, so they are pure and free of any
// `gre/` engine import — the same boundary `attackRestrictions.ts` keeps.
//
// Reused across cards rather than inlined per definition (the project's
// "extract on the second card" rule): Enchanted Being and Wall of Putrid Flesh
// both filter on "the damage source is an enchanted creature".

import type { CombatPreventionStateView, PermanentView } from "./types";

/** True if `creature` is enchanted by at least one Aura right now (CR 303.4b).
 *  Scans every battlefield for a permanent with the `Aura` subtype whose
 *  `attachedTo` points at `creature`. Used by Enchanted Being / Wall of Putrid
 *  Flesh ("by enchanted creatures"). */
export function isEnchantedByAura(
    creature: PermanentView,
    state: CombatPreventionStateView
): boolean {
    for (const player of state.players) {
        for (const p of player.battlefield) {
            if (p.attachedTo === creature.id && p.subtypes.includes("Aura")) {
                return true;
            }
        }
    }
    return false;
}

/** True if `self` is currently blocking `attacker` (CR 509.1). Reads the live
 *  block graph: `self.id` maps to the list of attackers it blocks. Used by
 *  Wall of Vapor ("by creatures it's blocking"). Outside combat the graph is
 *  absent and this is false. */
export function isBlockingCreature(
    self: PermanentView,
    attacker: PermanentView,
    state: CombatPreventionStateView
): boolean {
    const blocked = state.combat?.blockerAssignments[self.id];
    return blocked?.includes(attacker.id) ?? false;
}
