import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { isSortable } from "@dnd-kit/dom/sortable";
import type { Id } from "@convex/_generated/dataModel";
import type { Combat, CardInstance } from "~/types/game";
import { COMBAT_GROUP_BG } from "~/lib/combat-colors";
import ActionButton from "./action-button";

function SortableBlocker({
    blockerId,
    index,
    name,
}: {
    blockerId: string;
    index: number;
    name: string;
}) {
    const { ref, isDragSource } = useSortable({ id: blockerId, index });

    return (
        <div
            ref={ref}
            className={`flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded cursor-grab active:cursor-grabbing select-none ${isDragSource ? "opacity-50" : ""}`}
        >
            <span className="text-white/50 font-mono text-xs w-4">
                {index + 1}.
            </span>
            <span className="text-white text-sm">{name}</span>
            <span className="ml-auto text-white/30 text-xs">&#x2630;</span>
        </div>
    );
}

export default function BlockerOrderPanel({
    combat,
    opponentBattlefield,
    combatGroupColors,
    gameId,
    playerId,
}: {
    combat: Combat;
    opponentBattlefield: CardInstance[];
    combatGroupColors: Record<string, number>;
    gameId: Id<"games">;
    playerId: string;
}) {
    const setBlockerOrder = useMutation(api.game.setBlockerOrder);
    const confirmBlockerOrder = useMutation(api.game.confirmBlockerOrder);

    const blockerOrder = combat.blockerOrder ?? {};
    const attackersNeedingOrder = Object.entries(blockerOrder).filter(
        ([, blockerIds]) => blockerIds.length >= 2
    );

    if (attackersNeedingOrder.length === 0) return null;

    return (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 bg-black/90 border border-white/20 rounded-lg p-3 text-white text-sm max-w-md">
            <div className="font-bold mb-2">
                Order Blockers (drag to reorder)
            </div>
            {attackersNeedingOrder.map(([attackerId, blockerIds]) => {
                const colorIdx = combatGroupColors[attackerId];
                const groupColor =
                    colorIdx !== undefined
                        ? COMBAT_GROUP_BG[colorIdx]
                        : "bg-gray-500";

                return (
                    <div key={attackerId} className="mb-3 last:mb-0">
                        <div className="flex items-center gap-2 mb-1">
                            <div
                                className={`w-3 h-3 rounded-full ${groupColor}`}
                            />
                            <span className="text-white/70 text-xs">
                                Damage order:
                            </span>
                        </div>
                        <DragDropProvider
                            onDragEnd={(event) => {
                                const { source, target } = event.operation;
                                if (
                                    !source ||
                                    !target ||
                                    !isSortable(source) ||
                                    !isSortable(target)
                                )
                                    return;
                                const oldIndex = source.sortable.initialIndex;
                                const newIndex = target.sortable.index;
                                if (oldIndex === newIndex) return;

                                const newOrder = [...blockerIds];
                                const [moved] = newOrder.splice(oldIndex, 1);
                                newOrder.splice(newIndex, 0, moved);

                                setBlockerOrder({
                                    gameId,
                                    playerId,
                                    attackerId,
                                    orderedBlockerIds: newOrder,
                                });
                            }}
                        >
                            <div className="flex flex-col gap-1">
                                {blockerIds.map((blockerId, index) => {
                                    const blocker = opponentBattlefield.find(
                                        (c) => c.id === blockerId
                                    );
                                    const name =
                                        (blocker?.card?.name as string) ??
                                        "Blocker";
                                    return (
                                        <SortableBlocker
                                            key={blockerId}
                                            blockerId={blockerId}
                                            index={index}
                                            name={name}
                                        />
                                    );
                                })}
                            </div>
                        </DragDropProvider>
                    </div>
                );
            })}
            <ActionButton
                onClick={() => confirmBlockerOrder({ gameId, playerId })}
                label="Confirm Order"
                color="blue"
            />
        </div>
    );
}
