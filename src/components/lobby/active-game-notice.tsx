import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { storeSession } from "~/lib/session";

export type ActiveGame = {
    gameId: Id<"games">;
    name: string;
    status: "waiting" | "playing" | "finished";
    solo: boolean;
    vsAi: boolean;
};

type Props = {
    activeGame: ActiveGame;
    /** The current user's id — needed to derive the seat handle to resume. */
    userId: Id<"users">;
};

/**
 * Surfaces the user's single active game (#155). A user may hold at most one
 * game at a time, so when one exists the lobby shows this instead of letting a
 * (server-rejected) second creation through. Resume rejoins it; a waiting room
 * with no opponent can be abandoned to free the user.
 */
export default function ActiveGameNotice({ activeGame, userId }: Props) {
    const navigate = useNavigate();
    const leaveGame = useMutation(api.game.leaveGame);
    const [isBusy, setIsBusy] = useState(false);

    // Solo / vs-AI seats are `${userId}-p1`; a 2-player seat is the bare id.
    const playerId = activeGame.solo ? `${userId}-p1` : userId;

    const handleResume = () => {
        storeSession(activeGame.gameId, playerId);
        void navigate({ to: "/game" });
    };

    const handleLeave = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await leaveGame({ gameId: activeGame.gameId });
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text">
            <span>
                You have an active game
                {activeGame.status === "waiting"
                    ? " waiting for an opponent."
                    : " in progress."}{" "}
                Finish or leave it before starting another.
            </span>
            <div className="flex shrink-0 gap-2">
                <button
                    onClick={handleResume}
                    disabled={isBusy}
                    className="btn-base btn-tone-primary px-3 py-1.5 text-xs disabled:opacity-50"
                >
                    Resume
                </button>
                {activeGame.status === "waiting" && (
                    <button
                        onClick={() => void handleLeave()}
                        disabled={isBusy}
                        className="btn-base btn-tone-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                        Leave
                    </button>
                )}
            </div>
        </div>
    );
}
