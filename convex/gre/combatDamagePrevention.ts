// Continuous, source-filtered combat-damage prevention (CR 615 prevention,
// CR 611 continuous effect).
//
// A `combat-damage-prevention` static effect (convex/cards/types.ts
// `StaticCombatDamagePrevention`) is carried by the creature that wants to
// avoid damage and is evaluated LIVE at the combat-damage step rather than
// written into game state and consumed once. This is the same live-query model
// as `isCombatDamageImmune` (Ebony Horse) and `isGuardedAgainst` (Guardian
// Beast): the predicate observes the current board and block graph, so a
// "for as long as ~" prevention re-applies automatically every combat for as
// long as the creature is on the battlefield — never a one-shot.
//
// Distinct from the TURN-SCOPED shields (`combatDamageImmunity`,
// `preventAllCombatDamageThisTurn`, `playerDamagePrevention`): those are state
// entries purged at a duration boundary. This one is a property of the card
// definition, queried at the moment damage is about to be applied.
//
// Users (LEG, #485):
//   - Enchanted Being — prevent combat damage from creatures enchanted by an Aura.
//   - Wall of Vapor    — prevent combat damage from creatures it's blocking.
//
// Called from `applyOneCombatDamage` (convex/gre/phases.ts) on the permanent
// damage branch, before the damage is accumulated.

import type { CardInstanceState, GameState } from "./state";
import type { CombatPreventionStateView } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";

/** True if a `combat-damage-prevention` static on `target`'s card definition
 *  prevents combat damage from `damageSource` to `target` right now (CR 615).
 *
 *  Scans only the prevention's CARRIER (the creature taking damage) — unlike
 *  `isGuardedAgainst`, which scans every source on the battlefield. The
 *  prevention is a self-protective property of `target`, so reading its own
 *  definition's `staticEffects` is sufficient; the SOURCE filtering is done by
 *  each effect's `prevents(self, damageSource, state, ctx)` predicate. */
export function isCombatDamagePreventedFromSource(
    state: GameState,
    target: CardInstanceState,
    damageSource: CardInstanceState
): boolean {
    const cardId = (target.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : null;
    const effects = def?.staticEffects;
    if (!effects) return false;
    // The block graph is present only during combat (where a "creatures it's
    // blocking" relationship can exist). Project the live GameState onto the
    // narrow view the predicate reads.
    const view: CombatPreventionStateView = {
        players: state.players,
        activePlayerId: state.activePlayerId,
        combat: state.combat
            ? { blockerAssignments: state.combat.blockerAssignments }
            : undefined,
    };
    for (const effect of effects) {
        if (effect.kind !== "combat-damage-prevention") continue;
        if (effect.prevents(target, damageSource, view, STATIC_EFFECT_CTX)) {
            return true;
        }
    }
    return false;
}
