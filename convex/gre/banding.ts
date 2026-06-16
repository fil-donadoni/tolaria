import type { CardInstanceState, GameState } from "./state";
import { getPlayer, getOpponentId } from "./state";

/**
 * Banding combat helpers (CR 702.21).
 *
 * Banding has two mechanical effects this module models:
 *  1. **Block as a group (CR 702.21e):** an attacking band is blocked as a
 *     unit. Blocking any one member blocks every member — so the effective
 *     block graph expands each blocked attacker to its full band.
 *  2. **Damage-assignment authority (CR 702.21j-k):** if a creature is in
 *     combat with one or more creatures with banding, the controller of those
 *     banding creature(s) — not the creature's own controller — chooses how
 *     that creature assigns its combat damage. This flips the assigner for
 *     both attacker sources (blocked by a banding blocker → defender assigns)
 *     and blocker sources (blocking a banding attacker → attacker assigns).
 */

/** True if the instance currently has the banding keyword (printed or granted
 *  via Helm of Chatzuk, CR 611.1b — both land in `staticAbilities`). */
export function hasBanding(card: CardInstanceState): boolean {
    return card.staticAbilities.includes("banding");
}

/** The member ids of the band `attackerId` belongs to, or undefined if it is
 *  not part of a declared band. */
export function getBandMembers(
    combat: NonNullable<GameState["combat"]>,
    attackerId: string
): string[] | undefined {
    return combat.bands?.find((b) => b.memberIds.includes(attackerId))
        ?.memberIds;
}

/** True if `members` form a legal band (CR 702.21e): 2+ creatures, at least
 *  one with banding and at most one without. Shared by the createBand mutation
 *  and its tests. */
export function isLegalBandComposition(members: CardInstanceState[]): boolean {
    if (members.length < 2) return false;
    const banding = members.filter(hasBanding).length;
    const nonBanding = members.length - banding;
    return banding >= 1 && nonBanding <= 1;
}

export type BlockGraph = {
    /** attackerId → blocker ids blocking it (band-expanded). */
    blockersByAttacker: Record<string, string[]>;
    /** blockerId → attacker ids it is blocking (band-expanded). */
    attackersByBlocker: Record<string, string[]>;
};

/**
 * Builds the effective block graph, expanding band membership (CR 702.21e):
 * a blocker assigned to any band member is treated as blocking every member,
 * and every member is treated as blocked. With no bands declared this reduces
 * to a plain inversion of `combat.blockerAssignments`.
 */
export function getEffectiveBlockGraph(state: GameState): BlockGraph {
    const blockersByAttacker: Record<string, string[]> = {};
    const attackersByBlocker: Record<string, string[]> = {};
    const combat = state.combat;
    if (!combat) return { blockersByAttacker, attackersByBlocker };

    for (const [blockerId, attackerIds] of Object.entries(
        combat.blockerAssignments
    )) {
        const expanded = new Set<string>();
        for (const attackerId of attackerIds) {
            const band = getBandMembers(combat, attackerId);
            if (band) {
                for (const m of band) expanded.add(m);
            } else {
                expanded.add(attackerId);
            }
        }
        attackersByBlocker[blockerId] = [...expanded];
        for (const attackerId of expanded) {
            (blockersByAttacker[attackerId] ??= []).push(blockerId);
        }
    }
    return { blockersByAttacker, attackersByBlocker };
}

/**
 * Records which attackers became blocked this combat (CR 509.1h). Call once
 * blockers are locked in: an attacker counts as blocked iff it has at least
 * one blocker in the band-expanded block graph at that moment. The result is
 * stored on `combat.blockedAttackerIds` and read at the damage step, so an
 * attacker that later loses every blocker still deals no combat damage to the
 * defender without trample (CR 510.1c) — its blocked status no longer depends
 * on the live blocker count.
 */
export function recordBlockedAttackers(state: GameState): void {
    if (!state.combat) return;
    state.combat.blockedAttackerIds = Object.keys(
        getEffectiveBlockGraph(state).blockersByAttacker
    );
}

/**
 * Determines which player assigns `source`'s combat damage among
 * `targetCreatureIds` (CR 702.21j-k). If any target is a creature with
 * banding, authority shifts to that target's controller (the opponent of the
 * source); otherwise the source's own controller assigns. Returns `source`'s
 * controller when there is no shift.
 */
export function getDamageAssignerId(
    state: GameState,
    source: CardInstanceState,
    targetCreatureIds: string[]
): string {
    const opponentId = getOpponentId(state, source.controllerId);
    const opponent = getPlayer(state, opponentId);
    const anyBandingTarget = targetCreatureIds.some((id) => {
        const target = opponent.battlefield.find((c) => c.id === id);
        return target ? hasBanding(target) : false;
    });
    return anyBandingTarget ? opponentId : source.controllerId;
}

/**
 * The next player still owing a damage-assignment choice this step, or
 * undefined if every distinct assigner has confirmed. Pure over the combat
 * shape so the frontend can mirror it (see `src/lib/priority.ts`).
 */
export function outstandingDamageAssigner(combat: {
    damageAssignerIds?: Record<string, string>;
    damageAssignmentConfirmedBy?: string[];
}): string | undefined {
    const assigners = combat.damageAssignerIds;
    if (!assigners) return undefined;
    const confirmed = new Set(combat.damageAssignmentConfirmedBy ?? []);
    for (const playerId of Object.values(assigners)) {
        if (!confirmed.has(playerId)) return playerId;
    }
    return undefined;
}
