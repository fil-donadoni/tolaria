/**
 * Client-side view of the combat-damage assignment rules (CR 702.19b /
 * CR 702.2c), for the assigner modal.
 *
 * The arithmetic is NOT re-derived here: `lethalDamageThreshold` /
 * `assignmentThresholds` / `underAssignedBlockerBlockingExcess` come from the
 * engine module `convex/gre/lethalDamage.ts`, which the server's
 * `damageAssignment.ts` also calls (ADR 0074 — the frontend shares pure engine
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
import { getEffectiveBlockGraph } from "~/lib/combat-graph";
import { effectiveToughness } from "~/lib/effective-stats";

/** Everything the modal needs to gate one combat-damage source's buttons. */
export interface DamageAssignmentPlan {
    /** CR 702.19b — "the player, planeswalker, or battle the creature is
     *  attacking": the attacked planeswalker while it is still on the
     *  battlefield, else the defending player. `undefined` for a blocker
     *  source (banding, CR 702.22k), which has no excess sink. */
    excessSinkId?: string;
    /** blockerId → damage that must be assigned to it before ANY damage may go
     *  to the excess sink (CR 702.19b, CR 702.2c). */
    thresholds: Record<string, number>;
}

/**
 * Mirror of the server's `lethalThresholdsForSource` +
 * `attackTargetExcessSink`, computed from the projected view.
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
    if (!isAttacker) return { thresholds: {} };

    const allCards: CardInstance[] = allPlayers.flatMap((p) => p.battlefield);
    const findCard = (id: string) => allCards.find((c) => c.id === id);
    const source = findCard(sourceId);
    if (!source) return { thresholds: {} };

    // CR 702.19f — a creature without trample over planeswalkers attacking a
    // planeswalker may assign NONE of its combat damage to the defending
    // player, so the sink is the planeswalker whenever it is still around.
    const pwId = combat.attackTargets?.[sourceId];
    const pw = pwId ? findCard(pwId) : undefined;
    const excessSinkId =
        pw && (pw.types ?? []).includes("Planeswalker") ? pw.id : defenderId;

    const { blockersByAttacker } = getEffectiveBlockGraph(combat);
    const hasDeathtouch = (id: string): boolean =>
        findCard(id)?.staticAbilities?.includes("deathtouch") ?? false;

    return {
        excessSinkId,
        thresholds: assignmentThresholds({
            sourceId,
            sourceHasDeathtouch: hasDeathtouch(sourceId),
            blockers: (blockersByAttacker[sourceId] ?? []).flatMap((id) => {
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
