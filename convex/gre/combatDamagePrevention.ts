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
//
// The module also owns the MIRROR IMAGE of that lookup: `isCombatDamage-
// Unpreventable`, the SOURCE-side "combat damage dealt by <these sources>
// can't be prevented" query (CR 615.12, Questing Beast). Both live here
// because they are two halves of one question asked at the same instant — is
// this combat damage going to land? — and keeping them in one file is what
// makes it obvious that the source-side answer OVERRIDES the target-side one.

import type { CardInstanceState, GameState } from "./state";
import type { CombatPreventionStateView } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";

/** A minimal read-only board view — every game-state shape the engine passes
 *  to the SOURCE-side scan below (fat `GameState`, projected public state)
 *  satisfies it. Deliberately structural, exactly like
 *  `SourcePreventionStateView` (`gre/state.ts`): the bot's combat evaluation
 *  (`gre/evaluate.ts`) only ever sees the wire projection, and a
 *  `GameState`-only signature is how an immunity ends up honoured server-side
 *  and invisible to the bot. */
export interface UnpreventableStateView extends CombatPreventionStateView {
    /** Narrows the inherited `PermanentView` battlefield rows to full
     *  `CardInstanceState`s: the scan needs each permanent's `card` to look its
     *  definition up (`tryGetDefinition`), which `PermanentView` does not
     *  carry. The wire projection keeps `card` as `{ id }`, which is all the
     *  lookup reads — the same `(card as { id?: string }).id` shape
     *  `permanentGuard.ts` uses. */
    players: ReadonlyArray<
        CombatPreventionStateView["players"][number] & {
            battlefield: ReadonlyArray<CardInstanceState>;
        }
    >;
}

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

/** CR 615.12 — true when COMBAT damage `damageSource` is about to deal can't
 *  be prevented, because some permanent on SOME battlefield carries a
 *  `combat-damage-unpreventable` static whose predicate matches this source.
 *
 *  **The single predicate every combat-damage prevention chokepoint consults.**
 *  The failure mode this shape exists to rule out is that prevention is not one
 *  gate but nine (blanket Fog, the two `combatDamageImmunity` directions, the
 *  source-scoped shield inside `runDamageReplacement`, `consumePreventionIfAny`,
 *  `applyPlayerDamagePrevention`, `applyTargetPrevention` on both branches,
 *  and Forcefield's damage cap): nine copies of the same condition rot the
 *  moment a tenth shield is added, and a missed one is silent — the card looks
 *  correct in its own test and is bypassed by whichever shield was forgotten.
 *  So the callers compute this ONCE per damage event and thread the boolean
 *  into the ALREADY-EXISTING `unpreventable` parameter (Urza's Rage's kicked
 *  mode, `gre/state.ts` `runDamageReplacement` / `SpellContext.dealDamage`).
 *
 *  Scans every battlefield rather than one card's own definition: unlike
 *  `isCombatDamagePreventedFromSource` above — a self-protective property of
 *  the creature TAKING the damage — this effect lives on a permanent that is
 *  neither the damage's source nor its recipient (Questing Beast grants it to
 *  every creature its controller controls, itself included). Read live, so the
 *  immunity ends the instant its carrier leaves the battlefield (CR 611.2).
 *
 *  NOT applied to noncombat damage: the caller only reaches this on the CR 510
 *  combat-damage path, so the same creature's activated-ability ping stays
 *  preventable as normal. */
export function isCombatDamageUnpreventable(
    state: UnpreventableStateView,
    damageSource: CardInstanceState
): boolean {
    if (!anyCombatDamageUnpreventableStatic(state)) return false;
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind !== "combat-damage-unpreventable") continue;
                if (
                    effect.unpreventable(
                        source,
                        damageSource,
                        state,
                        STATIC_EFFECT_CTX
                    )
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** True when ANY permanent on the board carries a
 *  `combat-damage-unpreventable` static, regardless of which sources its
 *  predicate matches. The cheap pre-filter for `isCombatDamageUnpreventable`
 *  above, and — more importantly — the guard on the ONE prevention chokepoint
 *  that is not per-damage-event: `applyAllCombatDamage`'s blanket
 *  `preventAllCombatDamageThisTurn` early return (CR 615, a resolved Fog),
 *  which short-circuits the WHOLE damage step before any source is known.
 *  Keeping that fast path byte-identical whenever no such static exists means
 *  every already-shipped card takes exactly the code path it took before. */
export function anyCombatDamageUnpreventableStatic(
    state: Pick<UnpreventableStateView, "players">
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind === "combat-damage-unpreventable") return true;
            }
        }
    }
    return false;
}
