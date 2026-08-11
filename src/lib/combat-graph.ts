import type { Combat } from "~/types/game";

/** Client mirror of `convex/gre/banding.ts#getEffectiveBlockGraph`. Expands
 *  band membership (CR 702.22h): a blocker assigned to any band member blocks
 *  every member, and every member is blocked. Reduces to a plain inversion of
 *  `blockerAssignments` when no bands are declared. */
export function getEffectiveBlockGraph(combat: Combat): {
    blockersByAttacker: Record<string, string[]>;
    attackersByBlocker: Record<string, string[]>;
} {
    const blockersByAttacker: Record<string, string[]> = {};
    const attackersByBlocker: Record<string, string[]> = {};
    const bandOf = (attackerId: string): string[] | undefined =>
        combat.bands?.find((b) => b.memberIds.includes(attackerId))?.memberIds;

    for (const [blockerId, attackerIds] of Object.entries(
        combat.blockerAssignments
    )) {
        const expanded = new Set<string>();
        for (const attackerId of attackerIds) {
            const band = bandOf(attackerId);
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

/** Source ids this `playerId` must assign damage for this step, derived from
 *  the per-source authority map (CR 702.22j-k). */
export function damageSourcesForPlayer(
    combat: Combat,
    playerId: string
): string[] {
    const assigners = combat.damageAssignerIds ?? {};
    return Object.entries(assigners)
        .filter(([, assignerId]) => assignerId === playerId)
        .map(([sourceId]) => sourceId);
}
