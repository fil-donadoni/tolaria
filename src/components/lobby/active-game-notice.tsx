import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { storeSession } from "~/lib/session";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";

export type ActiveGame = {
    gameId: Id<"games">;
    matchId: Id<"matches">;
    name: string;
    status: "waiting" | "pregame" | "playing" | "finished";
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
 * game at a time, so when one exists the lobby shows this prominent banner and
 * disables creating/joining (the server rejects a second creation anyway).
 * Resume rejoins it; a waiting room with no opponent can be abandoned (Leave);
 * an in-progress Match is abandoned by forfeiting it (#396) — leaving mid-Match
 * maps to a Forfeit so no orphaned active Match is left behind. (Conceding a
 * single Game from here would only end one Game of a Bo3 and keep the Match
 * active; Forfeit ends the whole Match, awarding the opponent.)
 */
export default function ActiveGameNotice({ activeGame, userId }: Props) {
    const navigate = useNavigate();
    const leaveGame = useMutation(api.game.leaveGame);
    const forfeitMatch = useMutation(api.game.forfeitMatch);
    const [isBusy, setIsBusy] = useState(false);
    const [confirmForfeit, setConfirmForfeit] = useState(false);

    // Solo / vs-AI seats are `${userId}-p1`; a 2-player seat is the bare id.
    const playerId = activeGame.solo ? `${userId}-p1` : userId;
    const inProgress = activeGame.status === "playing";

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

    const handleForfeit = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await forfeitMatch({ matchId: activeGame.matchId, playerId });
            setConfirmForfeit(false);
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border-2 border-accent bg-accent/20 px-4 py-3 text-sm font-medium text-text shadow-[0_0_0_1px] shadow-accent/30">
            <span>
                You have an active game
                {inProgress
                    ? " in progress."
                    : " waiting for an opponent."}{" "}
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
                {inProgress ? (
                    <button
                        onClick={() => setConfirmForfeit(true)}
                        disabled={isBusy}
                        className="btn-base btn-tone-destructive px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                        Concede Match
                    </button>
                ) : (
                    <button
                        onClick={() => void handleLeave()}
                        disabled={isBusy}
                        className="btn-base btn-tone-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                        Leave
                    </button>
                )}
            </div>

            <GameDialog
                open={confirmForfeit}
                onOpenChange={(open) => {
                    if (!open) setConfirmForfeit(false);
                }}
                title="Concede match?"
                subtitle="This ends the whole match as a loss and cannot be undone."
            >
                <div className="flex justify-end gap-2 mt-4">
                    <ActionButton
                        onClick={() => setConfirmForfeit(false)}
                        label="Cancel"
                        tone="secondary"
                        disabled={isBusy}
                    />
                    <ActionButton
                        onClick={() => void handleForfeit()}
                        label="Concede Match"
                        tone="destructive"
                        disabled={isBusy}
                    />
                </div>
            </GameDialog>
        </div>
    );
}
