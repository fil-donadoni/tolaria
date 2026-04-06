import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";

export default function PassPriorityButton() {
    const {
        gameId,
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        autoPassPlayers,
        combat,
    } = useGameContext();
    const passPriority = useMutation(api.game.passPriority);
    const endTurn = useMutation(api.game.endTurn);

    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        playerId === activePlayerId;

    const hasPriority =
        playerId === priorityPlayerId && !pendingCast && !isSelectingAttackers;
    const isAutoPass = autoPassPlayers?.includes(playerId) ?? false;

    const handlePass = () => {
        if (hasPriority && !isAutoPass) {
            passPriority({ gameId, playerId });
        }
    };

    const handleEndTurn = () => {
        if (hasPriority && !isAutoPass) {
            endTurn({ gameId, playerId });
        }
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Space" && !e.repeat) {
                e.preventDefault();
                handlePass();
            }
            if (e.code === "Enter" && !e.repeat) {
                e.preventDefault();
                handleEndTurn();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    });

    if (isAutoPass) {
        return (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-black/60 text-white/60 px-6 py-2 rounded-lg text-sm">
                Auto-passing...
            </div>
        );
    }

    if (!hasPriority) return null;

    return (
        <div className="fixed bottom-6 right-2 z-40 flex gap-2">
            <button
                onClick={handlePass}
                className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-8 py-2 rounded-lg transition-colors shadow-lg"
            >
                Pass
                <span className="ml-2 text-xs opacity-60">[space]</span>
            </button>
            <button
                onClick={handleEndTurn}
                className="bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-2 rounded-lg transition-colors shadow-lg"
            >
                Pass Turn
                <span className="ml-2 text-xs opacity-60">[enter]</span>
            </button>
        </div>
    );
}
