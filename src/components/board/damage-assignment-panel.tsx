import type { CardInstance, Combat, Player } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { COMBAT_GROUP_BG } from "~/lib/combat-colors";

export default function DamageAssignmentPanel({
    combat,
    player,
    opponentBattlefield,
    blockersPerAttacker,
    combatGroupColors,
    gameId,
    playerId,
}: {
    combat: Combat;
    player: Player;
    opponentBattlefield: CardInstance[];
    blockersPerAttacker: Record<string, string[]>;
    combatGroupColors: Record<string, number>;
    gameId: Id<"games">;
    playerId: string;
}) {
    const setDamageAssignment = useMutation(api.game.setDamageAssignment);

    const attackersNeedingAssignment = combat.attackerIds.filter(
        (id) => (blockersPerAttacker[id]?.length ?? 0) >= 2
    );
    if (attackersNeedingAssignment.length === 0) return null;

    return (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 bg-black/90 border border-white/20 rounded-lg p-3 text-white text-sm max-w-md">
            <div className="font-bold mb-2">Assign Combat Damage</div>
            {attackersNeedingAssignment.map((attackerId) => {
                const attacker = player.battlefield.find(
                    (c) => c.id === attackerId
                );
                if (!attacker) return null;
                const power = Math.max(
                    0,
                    attacker.power ?? attacker.card.power ?? 0
                );
                const blockerIds = blockersPerAttacker[attackerId] ?? [];
                const assignments =
                    combat.damageAssignments?.[attackerId] ?? {};
                const assigned = Object.values(assignments).reduce(
                    (s, n) => s + n,
                    0
                );
                const colorIdx = combatGroupColors[attackerId];
                const groupColor =
                    colorIdx !== undefined
                        ? COMBAT_GROUP_BG[colorIdx]
                        : "bg-gray-500";

                return (
                    <div key={attackerId} className="mb-2 last:mb-0">
                        <div className="flex items-center gap-2 mb-1">
                            <div
                                className={`w-3 h-3 rounded-full ${groupColor}`}
                            />
                            <span className="font-medium">
                                {(attacker.card.name as string) ?? "Attacker"} (
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
                        {blockerIds.map((blockerId) => {
                            const blocker = opponentBattlefield.find(
                                (c) => c.id === blockerId
                            );
                            const dmg = assignments[blockerId] ?? 0;
                            return (
                                <div
                                    key={blockerId}
                                    className="flex items-center gap-2 ml-4"
                                >
                                    <span className="flex-1 truncate">
                                        {(blocker?.card?.name as string) ??
                                            "Blocker"}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (dmg <= 0) return;
                                            setDamageAssignment({
                                                gameId,
                                                playerId,
                                                attackerId,
                                                assignments: {
                                                    ...assignments,
                                                    [blockerId]: dmg - 1,
                                                },
                                            });
                                        }}
                                        className="w-6 h-6 bg-white/20 hover:bg-white/30 rounded text-center leading-6"
                                    >
                                        -
                                    </button>
                                    <span className="w-6 text-center font-mono">
                                        {dmg}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (assigned >= power) return;
                                            setDamageAssignment({
                                                gameId,
                                                playerId,
                                                attackerId,
                                                assignments: {
                                                    ...assignments,
                                                    [blockerId]: dmg + 1,
                                                },
                                            });
                                        }}
                                        className="w-6 h-6 bg-white/20 hover:bg-white/30 rounded text-center leading-6"
                                    >
                                        +
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
