import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { storeSession } from "~/lib/session";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";

export type ActiveGame = {
    gameId: Id<"games">;
    matchId: Id<"matches">;
    name: string;
    status: "waiting" | "pregame" | "playing" | "finished";
    solo: boolean;
    vsAi: boolean;
    mode: "manual" | null;
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
 *
 * For manual games (ADR 0080 S12), one user controls both seats (P1/P2). The
 * concede path uses `manualConcedeMatch` which operates on manual state instead
 * of GRE state. The resume path offers both seats so the player can pick which
 * viewpoint to enter.
 */
export default function ActiveGameNotice({ activeGame, userId }: Props) {
    const navigate = useNavigate();
    const leaveGame = useMutation(api.game.leaveGame);
    const forfeitMatch = useMutation(api.game.forfeitMatch);
    const manualConcede = useMutation(api.game.manualConcedeMatch);
    const [isBusy, setIsBusy] = useState(false);
    const [confirmForfeit, setConfirmForfeit] = useState(false);

    const isManual = activeGame.mode === "manual";
    const inProgress = activeGame.status === "playing";

    // Solo / vs-AI seats are `${userId}-p1`; a 2-player seat is the bare id.
    // For manual games the default seat is P1; the user picks the other seat
    // via the explicit buttons below.
    const p1Id = `${userId}-p1`;
    const p2Id = `${userId}-p2`;
    const playerId = activeGame.solo ? p1Id : userId;

    const handleResume = (seat: string) => {
        storeSession(activeGame.gameId, seat);
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
            if (isManual) {
                // #2400 review round 2 (blocking, round 3): `manualConcede`
                // now fails CLOSED on a seat that isn't in the Match
                // (`computeForfeitMatch` returning `null`). A genuine
                // 2-player Tabletop table (`createManualGame`/
                // `joinManualGame`) seats the caller as the bare user id, not
                // `-p1` — the same `playerId` already derived above for the
                // non-manual branch, so reuse it here instead of hardcoding
                // the solo seat.
                await manualConcede({
                    gameId: activeGame.gameId,
                    playerId,
                });
            } else {
                await forfeitMatch({
                    matchId: activeGame.matchId,
                    playerId,
                });
            }
            setConfirmForfeit(false);
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <>
            <Banner tone="prominent">
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <span>
                        You have an active game
                        {inProgress
                            ? " in progress."
                            : " waiting for an opponent."}{" "}
                        Finish or leave it before starting another.
                    </span>
                    <div className="flex shrink-0 gap-2">
                        {isManual ? (
                            <>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => handleResume(p1Id)}
                                    disabled={isBusy}
                                >
                                    Resume P1
                                </Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => handleResume(p2Id)}
                                    disabled={isBusy}
                                >
                                    Resume P2
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleResume(playerId)}
                                disabled={isBusy}
                            >
                                Resume
                            </Button>
                        )}
                        {inProgress ? (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setConfirmForfeit(true)}
                                disabled={isBusy}
                            >
                                Concede Match
                            </Button>
                        ) : (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleLeave()}
                                disabled={isBusy}
                            >
                                Leave
                            </Button>
                        )}
                    </div>
                </div>
            </Banner>

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
        </>
    );
}
