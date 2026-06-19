import type { CardInstance, Combat, Player } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";
import type { ReactMutation } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getCardById } from "@convex/cards";
import {
    getEffectiveBlockGraph,
    damageSourcesForPlayer,
} from "~/lib/combat-graph";
import { effectivePower } from "~/lib/effective-stats";

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
}) {
    return (
        <div
            className={`flex items-center gap-2 ml-4 ${highlight ? "text-yellow-300" : ""}`}
        >
            <span className="flex-1 truncate">{label}</span>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (dmg <= 0) return;
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
                className="w-6 h-6 bg-white/20 hover:bg-white/30 rounded text-center leading-6"
            >
                -
            </button>
            <span className="w-6 text-center font-mono">{dmg}</span>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (assigned >= power) return;
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
                className="w-6 h-6 bg-white/20 hover:bg-white/30 rounded text-center leading-6"
            >
                +
            </button>
        </div>
    );
}

/**
 * Damage-assignment modal for the local player. Renders every combat-damage
 * source this player is responsible for (CR 510.1c/d, and CR 702.21j-k under
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
}: {
    combat: Combat;
    allPlayers: Player[];
    gameId: Id<"games">;
    playerId: string;
    defenderId: string;
}) {
    const setDamageAssignment = useMutation(api.game.setDamageAssignment);

    const allCards: CardInstance[] = allPlayers.flatMap((p) => p.battlefield);
    const findCard = (id: string) => allCards.find((c) => c.id === id);
    const { blockersByAttacker, attackersByBlocker } =
        getEffectiveBlockGraph(combat);

    const sourceIds = damageSourcesForPlayer(combat, playerId);
    if (sourceIds.length === 0) return null;

    return (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-100 bg-black/90 border border-white/20 rounded-lg p-3 text-white text-sm max-w-md">
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
                const power = Math.max(0, effectivePower(allPlayers, source));
                const hasTrample =
                    source.staticAbilities?.includes("trample") ?? false;
                const isAttacker = combat.attackerIds.includes(sourceId);
                const targetIds = isAttacker
                    ? (blockersByAttacker[sourceId] ?? [])
                    : (attackersByBlocker[sourceId] ?? []);
                const assignments = combat.damageAssignments?.[sourceId] ?? {};
                const assigned = Object.values(assignments).reduce(
                    (s, n) => s + n,
                    0
                );

                return (
                    <div key={sourceId} className="mb-2 last:mb-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">
                                {getCardById(source.card.id).name ?? "Source"} (
                                {power} dmg)
                            </span>
                            <span
                                className={
                                    assigned === power
                                        ? "text-green-400"
                                        : "text-red-400"
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
                                            ? getCardById(target.card.id).name
                                            : "Target"
                                    }
                                    dmg={dmg}
                                    assigned={assigned}
                                    power={power}
                                    assignments={assignments}
                                    sourceId={sourceId}
                                    gameId={gameId}
                                    playerId={playerId}
                                    setDamageAssignment={setDamageAssignment}
                                />
                            );
                        })}
                        {isAttacker && hasTrample && (
                            <DamageRow
                                targetId={defenderId}
                                label="Defending Player"
                                dmg={assignments[defenderId] ?? 0}
                                assigned={assigned}
                                power={power}
                                assignments={assignments}
                                sourceId={sourceId}
                                gameId={gameId}
                                playerId={playerId}
                                setDamageAssignment={setDamageAssignment}
                                highlight
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
