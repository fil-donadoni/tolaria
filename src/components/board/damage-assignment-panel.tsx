import type { CardInstance, Combat, Player } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";
import type { ReactMutation } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { COMBAT_GROUP_BG } from "~/lib/combat-colors";

function DamageRow({
    targetId,
    label,
    dmg,
    assigned,
    power,
    assignments,
    attackerId,
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
    attackerId: string;
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
                        attackerId,
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
                        attackerId,
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

export default function DamageAssignmentPanel({
    combat,
    player,
    opponentBattlefield,
    blockersPerAttacker,
    combatGroupColors,
    gameId,
    playerId,
    defenderId,
}: {
    combat: Combat;
    player: Player;
    opponentBattlefield: CardInstance[];
    blockersPerAttacker: Record<string, string[]>;
    combatGroupColors: Record<string, number>;
    gameId: Id<"games">;
    playerId: string;
    defenderId: string;
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
                const hasTrample =
                    attacker.staticAbilities?.includes("trample") ?? false;
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
                                <DamageRow
                                    key={blockerId}
                                    targetId={blockerId}
                                    label={
                                        (blocker?.card?.name as string) ??
                                        "Blocker"
                                    }
                                    dmg={dmg}
                                    assigned={assigned}
                                    power={power}
                                    assignments={assignments}
                                    attackerId={attackerId}
                                    gameId={gameId}
                                    playerId={playerId}
                                    setDamageAssignment={setDamageAssignment}
                                />
                            );
                        })}
                        {hasTrample && (
                            <DamageRow
                                targetId={defenderId}
                                label="Defending Player"
                                dmg={assignments[defenderId] ?? 0}
                                assigned={assigned}
                                power={power}
                                assignments={assignments}
                                attackerId={attackerId}
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
