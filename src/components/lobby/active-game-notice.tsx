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
 * game at a time, so when one exists the lobby shows this prominent banner and
 * disables creating/joining (the server rejects a second creation anyway).
 * Resume rejoins it; a waiting room with no opponent can be abandoned (Leave);
 * a game in progress is closed by conceding (CR 104.3a — that player loses).
 */
export default function ActiveGameNotice({ activeGame, userId }: Props) {
    const navigate = useNavigate();
    const leaveGame = useMutation(api.game.leaveGame);
    const concede = useMutation(api.game.concede);
    const [isBusy, setIsBusy] = useState(false);
    const [confirmConcede, setConfirmConcede] = useState(false);

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

    const handleConcede = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await concede({ gameId: activeGame.gameId, playerId });
            setConfirmConcede(false);
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
                        onClick={() => setConfirmConcede(true)}
                        disabled={isBusy}
                        className="btn-base btn-tone-destructive px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                        Concede
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
                open={confirmConcede}
                onOpenChange={(open) => {
                    if (!open) setConfirmConcede(false);
                }}
                title="Concede game?"
                subtitle="This counts as a loss and cannot be undone."
            >
                <div className="flex justify-end gap-2 mt-4">
                    <ActionButton
                        onClick={() => setConfirmConcede(false)}
                        label="Cancel"
                        tone="secondary"
                        disabled={isBusy}
                    />
                    <ActionButton
                        onClick={() => void handleConcede()}
                        label="Concede"
                        tone="destructive"
                        disabled={isBusy}
                    />
                </div>
            </GameDialog>
        </div>
    );
}
