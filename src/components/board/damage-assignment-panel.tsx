import type { CardInstance, Combat, Player } from "~/types/game";
import type { EmblemInstance } from "@convex/cards/types";
import type { Id } from "@convex/_generated/dataModel";
import type { ReactMutation } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import {
    getEffectiveBlockGraph,
    damageSourcesForPlayer,
} from "~/lib/combat-graph";
import { effectivePower } from "~/lib/effective-stats";
import { displayCardId } from "~/lib/card-utils";
import {
    assignmentIsRejected,
    damageAssignmentPlan,
} from "~/lib/damage-assignment";
import { Panel } from "~/components/ui/panel";

function DamageRow({
    targetId,
    label,
    dmg,
    assigned,
    power,
    assignments,
    sourceId,
    gameId,
    playerId,
    setDamageAssignment,
    highlight,
    decDisabled,
    incDisabled,
}: {
    targetId: string;
    label: string;
    dmg: number;
    assigned: number;
    power: number;
    assignments: Record<string, number>;
    sourceId: string;
    gameId: Id<"games">;
    playerId: string;
    setDamageAssignment: ReactMutation<typeof api.game.setDamageAssignment>;
    highlight?: boolean;
    /** CR 702.19b — the step would leave a blocker below its lethal threshold
     *  while damage goes to the player/planeswalker, so `setDamageAssignment`
     *  would refuse it. Gated here rather than surfaced as a mutation error. */
    decDisabled?: boolean;
    incDisabled?: boolean;
}) {
    return (
        <div
            className={`flex items-center gap-2 ml-4 ${highlight ? "text-signal-pending" : ""}`}
        >
            <span className="flex-1 truncate">{label}</span>
            {/* `w-11 h-11` (44px, #1770 mobile QA sweep touch-target audit):
                was `w-6 h-6` (24px). Flex-centred rather than `leading-6`
                (tuned to the old fixed height) so the glyph stays centred at
                the new size. */}
            <button
                disabled={decDisabled}
                onClick={(e) => {
                    e.stopPropagation();
                    if (dmg <= 0 || decDisabled) return;
                    setDamageAssignment({
                        gameId,
                        playerId,
                        attackerId: sourceId,
                        assignments: {
                            ...assignments,
                            [targetId]: dmg - 1,
                        },
                    });
                }}
                className="flex w-11 h-11 items-center justify-center bg-surface-elevated hover:bg-surface-elevated/80 rounded disabled:opacity-40 disabled:hover:bg-surface-elevated"
            >
                -
            </button>
            <span className="w-6 text-center font-mono">{dmg}</span>
            <button
                disabled={incDisabled}
                onClick={(e) => {
                    e.stopPropagation();
                    if (assigned >= power || incDisabled) return;
                    setDamageAssignment({
                        gameId,
                        playerId,
                        attackerId: sourceId,
                        assignments: {
                            ...assignments,
                            [targetId]: dmg + 1,
                        },
                    });
                }}
                className="flex w-11 h-11 items-center justify-center bg-surface-elevated hover:bg-surface-elevated/80 rounded disabled:opacity-40 disabled:hover:bg-surface-elevated"
            >
                +
            </button>
        </div>
    );
}

/**
 * Damage-assignment modal for the local player. Renders every combat-damage
 * source this player is responsible for (CR 510.1c/d, and CR 702.22j-k under
 * banding, which can hand a defending player authority over an attacker's
 * damage or an attacking player authority over a blocker's). Source and target
 * cards are looked up across both battlefields since banding crosses sides.
 */
export default function DamageAssignmentPanel({
    combat,
    allPlayers,
    gameId,
    playerId,
    defenderId,
    emblems,
}: {
    combat: Combat;
    allPlayers: Player[];
    gameId: Id<"games">;
    playerId: string;
    defenderId: string;
    // CR 114 (issue #1221) — command-zone emblems, threaded from the parent
    // ({@link CombatPanels}, which reads game context). Folded into the
    // effective-power budget below, matching server-side validation. Passed as
    // a prop rather than read via context so the panel stays renderable in
    // isolation (its other game data — combat, allPlayers — are props too).
    emblems?: EmblemInstance[];
}) {
    const setDamageAssignment = useMutation(api.game.setDamageAssignment);

    const allCards: CardInstance[] = allPlayers.flatMap((p) => p.battlefield);
    const findCard = (id: string) => allCards.find((c) => c.id === id);
    const { blockersByAttacker, attackersByBlocker } =
        getEffectiveBlockGraph(combat);

    const sourceIds = damageSourcesForPlayer(combat, playerId);
    if (sourceIds.length === 0) return null;

    return (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-modal">
            <Panel density="compact" className="max-w-md p-3 text-sm">
                <div className="font-bold mb-2">Assign Combat Damage</div>
                {sourceIds.map((sourceId) => {
                    const source = findCard(sourceId);
                    if (!source) return null;
                    // CR 510.1c / 613.4: the assignable budget is the source's
                    // EFFECTIVE power (temporary P/T mods from combat tricks
                    // applied), matching the server-side validation in
                    // setDamageAssignment. Reading the raw base power field would
                    // ignore buffs like Giant Growth and clamp the +/- buttons too
                    // low.
                    const power = Math.max(
                        0,
                        effectivePower(allPlayers, source, emblems)
                    );
                    const hasTrample =
                        source.staticAbilities?.includes("trample") ?? false;
                    const isAttacker = combat.attackerIds.includes(sourceId);
                    const targetIds = isAttacker
                        ? (blockersByAttacker[sourceId] ?? [])
                        : (attackersByBlocker[sourceId] ?? []);
                    const assignments =
                        combat.damageAssignments?.[sourceId] ?? {};
                    const assigned = Object.values(assignments).reduce(
                        (s, n) => s + n,
                        0
                    );
                    // CR 702.19b / CR 702.2c — the lethal-damage thresholds and
                    // the excess sink, from the SAME shared arithmetic
                    // `setDamageAssignment` validates with. Every +/- below is
                    // gated on the assignment it would produce, so the modal can
                    // never offer a click the mutation refuses.
                    const plan = damageAssignmentPlan(
                        combat,
                        allPlayers,
                        sourceId,
                        defenderId,
                        emblems
                    );
                    const rowGating = (targetId: string, dmg: number) => ({
                        decDisabled: assignmentIsRejected(plan, {
                            ...assignments,
                            [targetId]: dmg - 1,
                        }),
                        incDisabled: assignmentIsRejected(plan, {
                            ...assignments,
                            [targetId]: dmg + 1,
                        }),
                    });
                    // CR 702.19f — a trampler attacking a planeswalker assigns
                    // its excess to that planeswalker, never to the defending
                    // player, so the row is labelled for whichever it is.
                    const sinkId = plan.excessSinkId ?? defenderId;
                    const sinkCard =
                        sinkId === defenderId ? undefined : findCard(sinkId);

                    return (
                        <div key={sourceId} className="mb-2 last:mb-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium">
                                    {getDefinition(displayCardId(source))
                                        .name ?? "Source"}{" "}
                                    ({power} dmg)
                                </span>
                                <span
                                    className={
                                        assigned === power
                                            ? "text-success-strong"
                                            : "text-danger-strong"
                                    }
                                >
                                    {assigned}/{power}
                                </span>
                            </div>
                            {targetIds.map((targetId) => {
                                const target = findCard(targetId);
                                const dmg = assignments[targetId] ?? 0;
                                return (
                                    <DamageRow
                                        key={targetId}
                                        targetId={targetId}
                                        label={
                                            target
                                                ? getDefinition(target.card.id)
                                                      .name
                                                : "Target"
                                        }
                                        dmg={dmg}
                                        assigned={assigned}
                                        power={power}
                                        assignments={assignments}
                                        sourceId={sourceId}
                                        gameId={gameId}
                                        playerId={playerId}
                                        setDamageAssignment={
                                            setDamageAssignment
                                        }
                                        {...rowGating(targetId, dmg)}
                                    />
                                );
                            })}
                            {isAttacker && hasTrample && (
                                <DamageRow
                                    targetId={sinkId}
                                    label={
                                        sinkCard
                                            ? getDefinition(sinkCard.card.id)
                                                  .name
                                            : "Defending Player"
                                    }
                                    dmg={assignments[sinkId] ?? 0}
                                    assigned={assigned}
                                    power={power}
                                    assignments={assignments}
                                    sourceId={sourceId}
                                    gameId={gameId}
                                    playerId={playerId}
                                    setDamageAssignment={setDamageAssignment}
                                    highlight
                                    {...rowGating(
                                        sinkId,
                                        assignments[sinkId] ?? 0
                                    )}
                                />
                            )}
                        </div>
                    );
                })}
            </Panel>
        </div>
    );
}
