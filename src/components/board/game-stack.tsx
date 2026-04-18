import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import CardImage from "../cards/card-image";
import { getAbilityOracleText } from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";

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

    const canTargetSpell =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsSpellTarget(pendingTarget.targetType);

    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    return (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
            <div className="flex items-start bg-black/60 rounded-lg p-3 backdrop-blur-sm">
                {reversed.map((item, i) => {
                    const abilityText = item.abilityId
                        ? getAbilityOracleText(item.card.id, item.abilityId)
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
                                <div className="mt-1 px-1 py-0.5 bg-black/80 rounded text-[10px] text-amber-200 text-center leading-tight max-w-32">
                                    {abilityText}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
