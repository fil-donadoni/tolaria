/**
 * Which targets one combat-damage source may assign damage to RIGHT NOW, and
 * whether a recorded assignment over them is complete (CR 510.1) — the single
 * authority for both questions.
 *
 * View-agnostic, like `./lethalDamage`: the server feeds it a `GameState`
 * (`damageAssignment.ts` — the default seed, `setDamageAssignment` and
 * `confirmDamage`), the assigner UI its projected wire view
 * (`src/lib/damage-assignment.ts` — the panel's rows and counter, and the
 * Confirm Damage gate), so a target one of them offers is a target all of them
 * accept (ADR 0074 — shared pure module, no client authority).
 *
 * The block graph is NOT that answer. It keeps a combatant that left the
 * battlefield as a tombstone slot (`mintDepartedCombatantId`), because the
 * attacker stays blocked (CR 509.1h) and last-known-information readers need
 * the record; but CR 510.1c assigns damage only among the creatures CURRENTLY
 * blocking.
 */

/** The targets one combat-damage source may assign damage to. */
export interface AssignableDamageTargets {
    /** Block-graph partners still on the battlefield, in graph order: an
     *  attacker's blockers (CR 510.1c), a blocker's blocked attackers
     *  (CR 510.1d, banding CR 702.22k). */
    targetIds: string[];
    /** CR 702.19b — where a TRAMPLING attacker's excess may go: the player or
     *  planeswalker it is attacking. Absent for every other source. */
    excessSinkId?: string;
}

/** The currently assignable targets of one source (CR 510.1c/d, CR 702.19b).
 *  `graphTargetIds` are its partners in the band-expanded block graph;
 *  `attackedId` is the player or planeswalker its trample excess would go to. */
export function assignableDamageTargets(input: {
    isAttacker: boolean;
    hasTrample: boolean;
    graphTargetIds: readonly string[];
    isOnBattlefield: (id: string) => boolean;
    attackedId: string;
}): AssignableDamageTargets {
    const targetIds = input.graphTargetIds.filter(input.isOnBattlefield);
    return input.isAttacker && input.hasTrample
        ? { targetIds, excessSinkId: input.attackedId }
        : { targetIds };
}

/** May damage be assigned to `targetId`? */
export function isAssignableDamageTarget(
    targets: AssignableDamageTargets,
    targetId: string
): boolean {
    return (
        targetId === targets.excessSinkId ||
        targets.targetIds.includes(targetId)
    );
}

/** The entries of `assignments` that name a currently assignable target. A
 *  stored map can outlive its targets; a stale entry neither counts nor is
 *  sent back. */
export function assignableEntries(
    targets: AssignableDamageTargets,
    assignments: Record<string, number>
): Record<string, number> {
    const out: Record<string, number> = {};
    const entries = Object.entries(assignments);
    for (let i = 0; i < entries.length; i++) {
        const [targetId, amount] = entries[i];
        if (isAssignableDamageTarget(targets, targetId)) out[targetId] = amount;
    }
    return out;
}

/** How far one source's assignment is from complete. */
export interface DamageAssignmentProgress {
    complete: boolean;
    assigned: number;
    required: number;
}

/**
 * Is a source's recorded combat-damage assignment COMPLETE (CR 510.1a)? It
 * must total EXACTLY the source's power — an over-assignment is as illegal as
 * a shortfall — counting only currently assignable targets.
 *
 * A source with no creature left to damage requires ZERO (CR 510.1c: "If no
 * creatures are currently blocking it […] it assigns no combat damage"). A
 * trampler whose blockers are all gone does assign its full power to what it
 * is attacking, but through the separate trample-through path of
 * `applyAllCombatDamage`, never through this per-target map.
 *
 * `power` is the post-layer value (CR 613.4).
 */
export function damageAssignmentProgress(
    targets: AssignableDamageTargets,
    assignments: Record<string, number>,
    power: number
): DamageAssignmentProgress {
    if (targets.targetIds.length === 0) {
        return { complete: true, assigned: 0, required: 0 };
    }
    const amounts = Object.values(assignableEntries(targets, assignments));
    let assigned = 0;
    for (let i = 0; i < amounts.length; i++) assigned += amounts[i];
    const required = Math.max(0, power);
    return { complete: assigned === required, assigned, required };
}
