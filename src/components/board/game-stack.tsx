import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import CardImage from "../cards/card-image";

type GameStackProps = {
    stack: StackItem[];
};

export default function GameStack({ stack }: GameStackProps) {
    const { gameId, playerId, priorityPlayerId } = useGameContext();
    const passPriority = useMutation(api.game.passPriority);
    const hasPriority = playerId === priorityPlayerId;

    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    const handlePass = () => {
        passPriority({ gameId, playerId });
    };

    return (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
            <div className="flex flex-col items-center gap-2">
                <div className="flex items-center bg-black/60 rounded-lg p-3 backdrop-blur-sm">
                    {reversed.map((item, i) => (
                        <div
                            key={item.id}
                            className="w-32 shrink-0"
                            style={{
                                marginLeft: i > 0 ? "-4rem" : undefined,
                                zIndex: reversed.length - i,
                            }}
                        >
                            <CardImage card={item.card} />
                        </div>
                    ))}
                </div>
                {hasPriority && (
                    <button
                        onClick={handlePass}
                        className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-2 rounded-lg transition-colors"
                    >
                        OK
                    </button>
                )}
            </div>
        </div>
    );
}
