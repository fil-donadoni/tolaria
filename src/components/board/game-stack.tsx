import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import CardImage from "../cards/card-image";
import {
    getAbilityOracleText,
    getTriggeredAbilityOracleText,
} from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { useGameContext } from "~/hooks/useGameContext";
import { useDraggable } from "~/hooks/useDraggable";
import DragHandle from "./drag-handle";

type GameStackProps = {
    stack: StackItem[];
};

function wantsSpellTarget(targetType: string | string[] | undefined): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.includes("spell");
}

export default function GameStack({ stack }: GameStackProps) {
    const { gameId, playerId, pendingTarget } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const { offset, dragHandlers } = useDraggable();

    const canTargetSpell =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsSpellTarget(pendingTarget.targetType);

    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    return (
        <div
            className="absolute top-1/2 right-4 z-50"
            style={{
                transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            <div className="bg-black/60 rounded-lg backdrop-blur-sm overflow-hidden">
                <DragHandle label="Stack" handlers={dragHandlers} />
                <div className="flex items-start p-3">
                    {reversed.map((item, i) => {
                        const abilityText = item.abilityId
                            ? getAbilityOracleText(item.card.id, item.abilityId)
                            : item.triggeredAbilityId
                              ? getTriggeredAbilityOracleText(
                                    item.card.id,
                                    item.triggeredAbilityId
                                )
                              : null;
                        const isTargetable = canTargetSpell;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                disabled={!isTargetable}
                                onClick={() => {
                                    if (!isTargetable) return;
                                    selectTarget({
                                        gameId,
                                        playerId,
                                        targetType: "spell",
                                        targetId: item.id,
                                    });
                                }}
                                className={`w-32 shrink-0 flex flex-col items-center bg-transparent border-0 p-0 ${
                                    isTargetable
                                        ? "cursor-pointer ring-2 ring-amber-400 rounded hover:ring-amber-300"
                                        : "cursor-default"
                                }`}
                                style={{
                                    marginLeft: i > 0 ? "-4rem" : undefined,
                                    zIndex: reversed.length - i,
                                }}
                            >
                                <CardImage card={item.card} />
                                {abilityText && (
                                    <div className="mt-1 p-1 bg-black/80 rounded text-[10px] text-left max-w-32">
                                        {formatOracleText(abilityText)}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
