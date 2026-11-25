/**
 * Client-side view of the combat-damage assignment rules (CR 702.19b /
 * CR 702.2c), for the assigner modal.
 *
 * The arithmetic is NOT re-derived here: `lethalDamageThreshold` /
 * `assignmentThresholds` / `underAssignedBlockerBlockingExcess` come from the
 * engine module `convex/gre/lethalDamage.ts`, and which targets a source may
 * assign to at all from `convex/gre/assignableDamage.ts`; the server's
 * `damageAssignment.ts` calls both (ADR 0074 — the frontend shares pure engine
 * modules, never authority). Only the EXTRACTION differs: the panel has the
 * projected wire view (`Combat` + `Player[]`) instead of a `GameState`.
 *
 * Why the panel needs this at all: `setDamageAssignment` rejects an assignment
 * that gives the defending player (or the attacked planeswalker) damage while a
 * blocker sits below its lethal threshold. A modal that offers such a click
 * produces a mutation error the player cannot understand, which is exactly the
 * "UI and server disagree" failure this pair of modules exists to prevent.
 */
import type { CardInstance, Combat, Player } from "~/types/game";
import type { EmblemInstance } from "@convex/cards/types";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import {
    assignmentThresholds,
    underAssignedBlockerBlockingExcess,
} from "@convex/gre/lethalDamage";
import {
    assignableDamageTargets,
    damageAssignmentProgress,
    type AssignableDamageTargets,
    type DamageAssignmentProgress,
} from "@convex/gre/assignableDamage";
import { getEffectiveBlockGraph } from "~/lib/combat-graph";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";

/** Everything the modal needs for one combat-damage source: the targets it may
 *  assign to (its rows, CR 510.1c/d + CR 702.19b) and the gate on each. */
export interface DamageAssignmentPlan extends AssignableDamageTargets {
    /** blockerId → damage that must be assigned to it before ANY damage may go
     *  to the excess sink (CR 702.19b, CR 702.2c). Empty for a blocker source
     *  (banding, CR 702.22k), which has no excess sink. */
    thresholds: Record<string, number>;
}

/**
 * Mirror of the server's `assignableDamageTargetsForSource` +
 * `lethalThresholdsForSource`, computed from the projected view.
 *
 * `defenderId` is the defending player's seat id. `emblems` feeds the layer
 * pipeline the same way the panel's power budget already does.
 */
export function damageAssignmentPlan(
    combat: Combat,
    allPlayers: Player[],
    sourceId: string,
    defenderId: string,
    emblems?: EmblemInstance[],
    /** CR 613 (PRD #2064 S6) — the Continuous Effects Registry; layer 7's
     *  until-boundary modifications are entries, so the lethal thresholds below
     *  ignore every pump without it. */
    continuousEffects?: readonly ContinuousEffect[]
): DamageAssignmentPlan {
    const isAttacker = combat.attackerIds.includes(sourceId);
    const allCards: CardInstance[] = allPlayers.flatMap((p) => p.battlefield);
    const findCard = (id: string) => allCards.find((c) => c.id === id);
    const source = findCard(sourceId);

    // CR 702.19f — a creature without trample over planeswalkers attacking a
    // planeswalker may assign NONE of its combat damage to the defending
    // player, so the sink is the planeswalker whenever it is still around.
    const pwId = combat.attackTargets?.[sourceId];
    const pw = pwId ? findCard(pwId) : undefined;
    const attackedId =
        pw && (pw.types ?? []).includes("Planeswalker") ? pw.id : defenderId;

    const { blockersByAttacker, attackersByBlocker } =
        getEffectiveBlockGraph(combat);
    const targets = assignableDamageTargets({
        isAttacker,
        hasTrample: source?.staticAbilities?.includes("trample") ?? false,
        graphTargetIds:
            (isAttacker
                ? blockersByAttacker[sourceId]
                : attackersByBlocker[sourceId]) ?? [],
        isOnBattlefield: (id) => findCard(id) !== undefined,
        attackedId,
    });
    if (!source || !isAttacker) {
        return { ...targets, thresholds: {} };
    }

    const hasDeathtouch = (id: string): boolean =>
        findCard(id)?.staticAbilities?.includes("deathtouch") ?? false;

    return {
        ...targets,
        thresholds: assignmentThresholds({
            sourceId,
            sourceHasDeathtouch: hasDeathtouch(sourceId),
            blockers: targets.targetIds.flatMap((id) => {
                const blocker = findCard(id);
                return blocker
                    ? [
                          {
                              id,
                              // CR 613.4 effective toughness, never the printed
                              // field — the same value the server reads.
                              effectiveToughness: effectiveToughness(
                                  allPlayers,
                                  blocker,
                                  emblems,
                                  continuousEffects
                              ),
                              damageMarked: blocker.damageMarked,
                          },
                      ]
                    : [];
            }),
            stepAssignments: combat.damageAssignments ?? {},
            hasDeathtouch,
        }),
    };
}

/**
 * Would `setDamageAssignment` reject this proposal? CR 702.19b's paired
 * constraint: under-assigning to a blocker is fine on its own, but not while
 * damage also goes to the player/planeswalker being attacked.
 *
 * The panel calls this on the assignment a button WOULD produce and disables
 * the button when it comes back true, so no offered click can be refused.
 */
export function assignmentIsRejected(
    plan: DamageAssignmentPlan,
    assignments: Record<string, number>
): boolean {
    return (
        underAssignedBlockerBlockingExcess(
            plan.thresholds,
            assignments,
            plan.excessSinkId ? [plan.excessSinkId] : []
        ) !== undefined
    );
}

/**
 * How far `sourceId`'s recorded assignment is from complete — the predicate
 * `confirmDamage` enforces, on the projected view. The panel's counter and the
 * Confirm Damage gate both read it, so a green counter means the confirm
 * succeeds (CR 510.1a).
 */
export function damageAssignmentProgressForSource(
    combat: Combat,
    allPlayers: Player[],
    source: CardInstance,
    defenderId: string,
    emblems?: EmblemInstance[],
    continuousEffects?: readonly ContinuousEffect[]
): DamageAssignmentProgress {
    return damageAssignmentProgress(
        damageAssignmentPlan(
            combat,
            allPlayers,
            source.id,
            defenderId,
            emblems,
            continuousEffects
        ),
        combat.damageAssignments?.[source.id] ?? {},
        effectivePower(allPlayers, source, emblems, continuousEffects)
    );
}
