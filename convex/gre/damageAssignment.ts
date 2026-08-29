/**
 * Combat-damage assignment, server side (CR 510.1 / CR 702.19b / CR 702.2c).
 *
 * The `GameState`-aware half of the lethal-damage authority: it extracts
 * effective toughness, marked damage, deathtouch and the block graph out of the
 * engine state and hands them to the pure arithmetic in `./lethalDamage`, which
 * the assigner UI shares unchanged (ADR 0074 — one module, no client
 * authority). Every server consumer goes through here:
 *
 * - `phases.ts` seed builders (`buildAutoDamageAssignments`,
 *   `buildDefaultDamageAssignments`) — the pre-filled default;
 * - `game.ts` `setDamageAssignment` — the manual-assignment validator;
 * - `game.ts` `confirmDamage` — the completeness gate (#2906).
 *
 * Keeping both on the same helper is what makes the pre-fill un-rejectable by
 * the validator: a default the mutation would refuse is the shape this file
 * exists to prevent.
 */
import type { CardInstanceState, GameState } from "./state";
import { getPlayer, getOpponentId } from "./state";
import { getEffectiveToughness, getEffectivePower } from "./layers";
import { getEffectiveBlockGraph } from "./banding";
import { isPlaneswalker } from "./constants";
import {
    assignmentThresholds,
    lethalDamageThreshold,
    damageAssignedByOtherSources,
    underAssignedBlockerBlockingExcess,
} from "./lethalDamage";

/** Looks up a permanent on either battlefield by instance id. */
function findPermanent(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        const found = player.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

/** CR 702.2c — does this combat-damage source have deathtouch? Read off the
 *  layer-6 MATERIALISED `staticAbilities` array (grants and ability-removal
 *  already applied), so a granted deathtouch counts and a Humility-stripped one
 *  does not — the same array `markDeathtouchDamage` is fed at damage time. */
export function sourceHasDeathtouch(
    state: GameState,
    sourceId: string
): boolean {
    return (
        findPermanent(state, sourceId)?.staticAbilities.includes(
            "deathtouch"
        ) ?? false
    );
}

/** CR 508.1a (issue #1220) — the id a trampling attacker's excess-over-blockers
 *  damage is assigned to: the planeswalker it declared as its attack target (if
 *  that planeswalker is still on the battlefield), else the defending player.
 *  In CR 702.19b's words, "the player, planeswalker, or battle the creature is
 *  attacking". */
export function attackTargetExcessSink(
    state: GameState,
    attackerId: string,
    defenderId: string
): string {
    const pwId = state.combat?.attackTargets?.[attackerId];
    if (!pwId) return defenderId;
    const defender = getPlayer(state, defenderId);
    const pw = defender.battlefield.find((c) => c.id === pwId);
    return pw && isPlaneswalker(pw) ? pwId : defenderId;
}

/**
 * How much `attacker` must assign to `blocker` before any of its damage may be
 * assigned to the player or planeswalker it is attacking (CR 702.19b,
 * CR 702.2c).
 *
 * `assignedSoFar` is the rest of THIS combat damage step — the "damage from
 * other creatures that's being assigned during the same combat damage step"
 * CR 702.19b requires taking into account. Inside a seed builder that is the
 * partially-built result map (attackers are walked in `combat.attackerIds`
 * declaration order, so a second attacker sharing a blocker sees the first
 * one's damage); inside the mutation it is `combat.damageAssignments`, which
 * the damage step rebuilt wholesale on entry.
 *
 * Nothing here consults protection, prevention shields or damage replacement:
 * CR 702.19b counts damage ASSIGNED, "not any abilities or effects that might
 * change the amount of damage that's actually dealt".
 */
export function lethalForBlocker(
    state: GameState,
    attacker: CardInstanceState,
    blocker: CardInstanceState,
    assignedSoFar: Record<string, Record<string, number>>
): number {
    return lethalDamageThreshold({
        // Effective toughness after the layer pipeline (CR 613.4), never the
        // printed field.
        effectiveToughness: getEffectiveToughness(state, blocker),
        damageMarked: blocker.damageMarked,
        sourceHasDeathtouch: attacker.staticAbilities.includes("deathtouch"),
        other: damageAssignedByOtherSources(
            assignedSoFar,
            attacker.id,
            blocker.id,
            (id) => sourceHasDeathtouch(state, id)
        ),
    });
}

/** blockerId → lethal threshold for every creature `sourceId` is assigning to
 *  in this combat damage step (CR 702.19b / CR 702.2c). The map the manual
 *  validator and the assigner UI both check an assignment against. */
export function lethalThresholdsForSource(
    state: GameState,
    sourceId: string,
    stepAssignments: Record<string, Record<string, number>>
): Record<string, number> {
    const source = findPermanent(state, sourceId);
    if (!source) return {};
    const graph = getEffectiveBlockGraph(state);
    const blockerIds = graph.blockersByAttacker[sourceId] ?? [];
    return assignmentThresholds({
        sourceId,
        sourceHasDeathtouch: source.staticAbilities.includes("deathtouch"),
        blockers: blockerIds.flatMap((id) => {
            const blocker = findPermanent(state, id);
            return blocker
                ? [
                      {
                          id,
                          effectiveToughness: getEffectiveToughness(
                              state,
                              blocker
                          ),
                          damageMarked: blocker.damageMarked,
                      },
                  ]
                : [];
        }),
        stepAssignments,
        hasDeathtouch: (id) => sourceHasDeathtouch(state, id),
    });
}

/**
 * CR 702.19b's paired constraint, as a validator: "The attacking creature's
 * controller need not assign lethal damage to all those blocking creatures but
 * in that case can't assign any damage to the player or planeswalker it's
 * attacking."
 *
 * Deliberate under-assignment is therefore LEGAL on its own — a 6/6 trampler
 * may put 1 on its blocker and waste the rest. Only the PAIR (a blocker below
 * its threshold AND damage going to an excess sink) is illegal. Returns the id
 * of the offending blocker, or `undefined` when the proposed assignment is
 * legal.
 */
export function damageAssignmentLethalViolation(
    state: GameState,
    sourceId: string,
    assignments: Record<string, number>,
    excessSinkIds: readonly string[]
): { blockerId: string; threshold: number } | undefined {
    const thresholds = lethalThresholdsForSource(
        state,
        sourceId,
        state.combat?.damageAssignments ?? {}
    );
    const blockerId = underAssignedBlockerBlockingExcess(
        thresholds,
        assignments,
        excessSinkIds
    );
    return blockerId === undefined
        ? undefined
        : { blockerId, threshold: thresholds[blockerId] };
}

/** The LIVE target set `sourceId` may currently assign combat damage to: an
 *  attacker's still-on-the-battlefield blockers (CR 510.1c — a dead blocker
 *  lingers in `combat.blockerAssignments`, which never gets pruned, but no
 *  longer absorbs damage; same `findPermanent` filter `applyAllCombatDamage`
 *  itself applies as `liveBlockers`), or a banding blocker's live band
 *  members. Recomputed fresh against the CURRENT board, not the board at the
 *  moment the assignment was entered — a blocker that died since then drops
 *  out here even though the stored assignment map may still name it. */
function liveDamageTargetsForSource(
    state: GameState,
    sourceId: string
): { legalTargets: Set<string>; excessSinkId: string | undefined } {
    const graph = getEffectiveBlockGraph(state);
    const isAttacker = (state.combat?.attackerIds ?? []).includes(sourceId);
    const rawTargets = isAttacker
        ? (graph.blockersByAttacker[sourceId] ?? [])
        : (graph.attackersByBlocker[sourceId] ?? []);
    const legalTargets = new Set(
        rawTargets.filter((id) => findPermanent(state, id) !== undefined)
    );
    const source = findPermanent(state, sourceId);
    const hasTrample = source?.staticAbilities.includes("trample") ?? false;
    const excessSinkId =
        isAttacker && hasTrample
            ? attackTargetExcessSink(
                  state,
                  sourceId,
                  getOpponentId(state, state.activePlayerId)
              )
            : undefined;
    return { legalTargets, excessSinkId };
}

/** Is `sourceId`'s recorded combat-damage assignment COMPLETE (CR 510.1a/e)?
 *
 * `bun run cr 510.1a`: "Each attacking creature and each blocking creature
 * assigns combat damage equal to its power. Creatures that would assign 0 or
 * less damage this way don't assign combat damage at all." — EQUAL, not "at
 * least": both an under- and an over-assignment (e.g. a stale map that still
 * totals a since-shrunk source's higher base amount) are illegal.
 *
 * `bun run cr 510.1e`: an illegal total assignment "returns to the moment
 * before that player began to assign combat damage" (CR 733) — the mutation
 * throws and leaves state untouched, which is that rewind's effect without
 * needing rewind machinery of its own (no state was written yet to undo).
 *
 * The total counts only entries whose target is CURRENTLY legal
 * (`liveDamageTargetsForSource`, recomputed against the live board, not the
 * board when the number was entered) — a stale entry aimed at a blocker that
 * died since must neither count toward the total nor, downstream in
 * `applyAllCombatDamage`, be dealt (that function already no-ops a permanent
 * target it can't find; this predicate is what keeps the total in sync with
 * that same silent drop instead of demanding damage the map can't deliver).
 *
 * CR 510.1b/c/d — a source whose live target set has emptied entirely (every
 * blocker/band member gone) requires ZERO: it deals no combat damage through
 * this map at all (a trampler with every blocker dead tramples its full
 * power through via the SEPARATE unblocked-through path in
 * `applyAllCombatDamage`, never through this per-target map), so demanding a
 * total here would reject a source with nothing left to reject.
 *
 * One exported pure function over `GameState` + the assignment map so
 * `confirmDamage` (and, ultimately, the client's Confirm-Damage predicate)
 * read the same answer instead of a private re-derivation (#2906). */
export function combatDamageAssignmentCompleteness(
    state: GameState,
    sourceId: string,
    assignments: Record<string, number>
): { complete: boolean; assigned: number; required: number } {
    const source = findPermanent(state, sourceId);
    if (!source) return { complete: true, assigned: 0, required: 0 };
    const { legalTargets, excessSinkId } = liveDamageTargetsForSource(
        state,
        sourceId
    );
    if (legalTargets.size === 0) {
        return { complete: true, assigned: 0, required: 0 };
    }
    let assigned = 0;
    for (const [targetId, amount] of Object.entries(assignments)) {
        if (legalTargets.has(targetId) || targetId === excessSinkId) {
            assigned += amount;
        }
    }
    // CR 613.4 — the post-layer value, never the stored base `power` field
    // (a shrunk source whose stale map still totals the higher base amount
    // must be rejected, not allowed to overdeal).
    const required = Math.max(0, getEffectivePower(state, source));
    return { complete: assigned === required, assigned, required };
}
