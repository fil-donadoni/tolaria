import type { StackItem } from "~/types/game";
import CardImage from "../cards/card-image";
import { getAbilityOracleText } from "~/lib/card-utils";

type GameStackProps = {
    stack: StackItem[];
};

export default function GameStack({ stack }: GameStackProps) {
    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    return (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
            <div className="flex items-start bg-black/60 rounded-lg p-3 backdrop-blur-sm">
                {reversed.map((item, i) => {
                    const abilityText = item.abilityId
                        ? getAbilityOracleText(item.card.id, item.abilityId)
                        : null;

                    return (
                        <div
                            key={item.id}
                            className="w-32 shrink-0 flex flex-col items-center"
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
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
