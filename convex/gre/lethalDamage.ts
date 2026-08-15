/**
 * Lethal-damage threshold for combat damage assignment — the single authority
 * for "how much must this source assign to that blocker before its excess may
 * go anywhere else" (CR 702.19b trample, CR 702.2c deathtouch).
 *
 * Deliberately arithmetic-only and view-agnostic: callers supply the EFFECTIVE
 * toughness they already compute through their own layer path (the server via
 * `getEffectiveToughness(state, card)`, the client via
 * `effectiveToughness(allPlayers, card)`), so this module carries no
 * `GameState` shape and can be imported by the assigner UI unchanged
 * (ADR 0074 — shared pure module, no client authority).
 *
 * Threshold rule, printed from `bun run cr 702.19b`:
 *
 *   "When checking for assigned lethal damage, take into account damage
 *   already marked on the creature and damage from other creatures that's
 *   being assigned during the same combat damage step, but not any abilities
 *   or effects that might change the amount of damage that's actually dealt."
 *
 * The final clause is load-bearing and easy to get wrong in the "smart"
 * direction: protection, prevention shields and damage-replacement effects
 * must NOT lower the threshold. CR 702.19b's own second example is the test —
 * a 6/6 green trampler blocked by a 2/2 with protection from green still has
 * to assign 2 to the blocker, even though every point of it is prevented.
 */

/** Damage other combat-damage sources have assigned to one creature during the
 *  same combat damage step (CR 702.19b), plus whether any of it came from a
 *  deathtouch source — a nonzero deathtouch assignment IS lethal damage
 *  (CR 702.2c), so it satisfies the whole threshold on its own. */
export interface OtherAssignedDamage {
    amount: number;
    fromDeathtouch: boolean;
}

export const NO_OTHER_ASSIGNED_DAMAGE: OtherAssignedDamage = {
    amount: 0,
    fromDeathtouch: false,
};

/**
 * Sum what every OTHER source has assigned to `targetId` in this same combat
 * damage step (CR 702.19b). `assignments` is the whole step's map
 * (sourceId → targetId → damage) — `state.combat.damageAssignments` on the
 * server, the projected `combat.damageAssignments` on the client, or the
 * partially-built result map inside a seed builder.
 *
 * @param excludeSourceId the source whose own threshold is being computed; its
 *   own assignment is never "damage from other creatures".
 * @param sourceHasDeathtouch id → does that source have deathtouch (CR 702.2c).
 */
export function damageAssignedByOtherSources(
    assignments: Record<string, Record<string, number>>,
    excludeSourceId: string,
    targetId: string,
    sourceHasDeathtouch: (sourceId: string) => boolean
): OtherAssignedDamage {
    let amount = 0;
    let fromDeathtouch = false;
    for (const [sourceId, perTarget] of Object.entries(assignments)) {
        if (sourceId === excludeSourceId) continue;
        const damage = perTarget?.[targetId] ?? 0;
        if (damage <= 0) continue;
        amount += damage;
        if (sourceHasDeathtouch(sourceId)) fromDeathtouch = true;
    }
    return { amount, fromDeathtouch };
}

/**
 * How much damage `source` must assign to this blocker before any excess may
 * be assigned elsewhere (CR 702.19b / CR 702.2c). Never negative.
 *
 * - `effectiveToughness` — the blocker's toughness after the layer pipeline
 *   (CR 613.4), NOT its printed toughness.
 * - `damageMarked` — damage already marked on it, including damage marked by
 *   an earlier first-strike damage step (CR 702.19b).
 * - `other` — damage assigned to it by other creatures in this same step.
 * - `sourceHasDeathtouch` — CR 702.2c makes any nonzero amount assigned by a
 *   deathtouch source count as lethal, so the threshold collapses to 1 (or to
 *   0, when nothing at all is still needed).
 *
 * Nothing here consults protection / prevention / damage replacement, by rule.
 */
export function lethalDamageThreshold(input: {
    effectiveToughness: number;
    damageMarked?: number;
    sourceHasDeathtouch: boolean;
    other?: OtherAssignedDamage;
}): number {
    const other = input.other ?? NO_OTHER_ASSIGNED_DAMAGE;
    // CR 702.2c — another source with deathtouch already assigned a nonzero
    // amount, so this creature has been assigned lethal damage; nothing more
    // is required of this source.
    if (other.fromDeathtouch) return 0;
    const remaining = Math.max(
        0,
        input.effectiveToughness - (input.damageMarked ?? 0) - other.amount
    );
    // CR 702.2c — one point from a deathtouch source is lethal damage.
    if (input.sourceHasDeathtouch) return Math.min(1, remaining);
    return remaining;
}

/** One blocker's inputs to {@link assignmentThresholds}: its id, its toughness
 *  AFTER the layer pipeline (CR 613.4) and the damage already marked on it. */
export interface ThresholdBlocker {
    id: string;
    effectiveToughness: number;
    damageMarked?: number;
}

/**
 * blockerId → lethal-damage threshold for ONE combat-damage source, over the
 * whole set of creatures it is assigning to (CR 702.19b / CR 702.2c).
 *
 * This is the shape both authorities call: the server (`damageAssignment.ts`,
 * feeding the seed builders and `setDamageAssignment`) and the assigner UI
 * (`src/lib/damage-assignment.ts`). Only the EXTRACTION of toughness and
 * deathtouch differs between them — `GameState` on one side, the projected
 * wire view on the other — so the arithmetic lives here once and neither side
 * re-derives it.
 *
 * @param stepAssignments the whole step's sourceId → targetId → damage map;
 *   every entry other than `sourceId`'s own is "damage from other creatures
 *   that's being assigned during the same combat damage step" (CR 702.19b).
 * @param hasDeathtouch id → does that source have deathtouch (CR 702.2c).
 */
export function assignmentThresholds(input: {
    sourceId: string;
    sourceHasDeathtouch: boolean;
    blockers: readonly ThresholdBlocker[];
    stepAssignments: Record<string, Record<string, number>>;
    hasDeathtouch: (sourceId: string) => boolean;
}): Record<string, number> {
    const thresholds: Record<string, number> = {};
    for (const blocker of input.blockers) {
        thresholds[blocker.id] = lethalDamageThreshold({
            effectiveToughness: blocker.effectiveToughness,
            damageMarked: blocker.damageMarked,
            sourceHasDeathtouch: input.sourceHasDeathtouch,
            other: damageAssignedByOtherSources(
                input.stepAssignments,
                input.sourceId,
                blocker.id,
                input.hasDeathtouch
            ),
        });
    }
    return thresholds;
}

/**
 * The permissive half of CR 702.19b: "The attacking creature's controller need
 * not assign lethal damage to all those blocking creatures but in that case
 * can't assign any damage to the player or planeswalker it's attacking."
 *
 * So under-assigning to a blocker is legal on its own — it is only illegal
 * PAIRED with damage going to an excess sink. Returns the id of a blocker that
 * is below its threshold while the assignment also feeds a sink, or `undefined`
 * when the assignment is legal.
 *
 * @param thresholds blockerId → threshold from {@link lethalDamageThreshold}.
 * @param assignments the proposed targetId → damage map for one source.
 * @param excessSinkIds the defending player and/or the attacked planeswalker.
 */
export function underAssignedBlockerBlockingExcess(
    thresholds: Record<string, number>,
    assignments: Record<string, number>,
    excessSinkIds: readonly string[]
): string | undefined {
    const toSinks = excessSinkIds.reduce(
        (sum, id) => sum + (assignments[id] ?? 0),
        0
    );
    if (toSinks <= 0) return undefined;
    for (const [blockerId, threshold] of Object.entries(thresholds)) {
        if ((assignments[blockerId] ?? 0) < threshold) return blockerId;
    }
    return undefined;
}
