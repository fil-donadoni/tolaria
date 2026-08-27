// The Tabletop (Manual Mode) result screen — ADR 0080's "a game ends by
// concede only" made visible.
//
// It is a SEPARATE component from `game-over-dialog.tsx`, not a branch inside
// it, for two reasons that are both structural rather than cosmetic:
//
//  1. A Bo3 interstitial in the real engine continues into
//     `SideboardingDialog`, which reads `useGameContext()` and enforces the
//     15-card limit. A Manual Game mounts no `GameProvider` (it would crash)
//     and ADR 0080 explicitly rejects the between-games sideboard dialog —
//     the sideboard is a permanently visible zone there. So the interstitial
//     action is "Next game", which builds G2/G3 directly.
//  2. `manualConcedeMatch` DELETES the `manualStates` rows for the finished
//     game, so there is no board left to render behind this dialog. It is the
//     whole screen, not an overlay.

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import GameDialog from "~/components/ui/game-dialog";
import TitleTreatment from "~/components/ui/title-treatment";
import OrnamentalDivider from "~/components/ui/ornamental-divider";
import { Button } from "~/components/ui/button";
import { clearSession, storeSession } from "~/lib/session";
import { lobbyHrefForMatch } from "~/lib/matchNavigation";

export default function ManualGameOverDialog({
    players,
    winnerId,
    matchId,
    viewerId,
    onSwitchGame,
}: {
    /** Both seats of the finished game, for naming winner and loser. */
    players: { id: string; name: string }[];
    /** The game row's `winner` — the seat that did NOT concede. */
    winnerId?: string;
    matchId?: Id<"matches">;
    /** The seat this client sits in; decides Victory vs Defeat. */
    viewerId: string;
    /** Re-points the route's session at the next game of a Bo3, in place — a
     *  full reload would 404 on a static host (see `sideboarding-dialog`). */
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
}) {
    const match =
        useQuery(api.matches.getMatch, matchId ? { matchId } : "skip") ?? null;
    const continueMatch = useMutation(api.game.continueManualMatch);
    const [busy, setBusy] = useState(false);

    const winner = players.find((p) => p.id === winnerId);
    const loser = players.find((p) => p.id !== winnerId);
    const matchOver = match?.status === "finished";
    // Undecided Bo3: the Match sits in "sideboarding" until someone starts the
    // next game. No swap editor here (ADR 0080) — just the button.
    const interstitial = match?.status === "sideboarding";
    const scoreLine = match
        ? match.players.map((p) => `${p.name}: ${p.score}`).join("  ·  ")
        : null;

    const handleNextGame = async () => {
        if (busy || !matchId) return;
        setBusy(true);
        try {
            const next = await continueMatch({ matchId });
            if (next) {
                storeSession(next.gameId, viewerId);
                onSwitchGame(next.gameId, viewerId);
            }
        } finally {
            setBusy(false);
        }
    };

    const handleLeave = () => {
        clearSession();
        window.location.href = lobbyHrefForMatch(match);
    };

    return (
        <GameDialog
            open
            // The result treatment and every line under it are centred.
            align="center"
            title={matchOver ? "Match Over" : "Game Over"}
            dismissable={false}
        >
            <div className="mt-1 flex flex-col items-center gap-2 text-center">
                <TitleTreatment
                    title={winnerId === viewerId ? "Victory" : "Defeat"}
                    subtitle={
                        matchOver
                            ? `${winner?.name ?? "?"} wins the match!`
                            : `${winner?.name ?? "?"} wins!`
                    }
                />
                <p className="text-sm text-text-muted">
                    {`${loser?.name ?? "?"} conceded`}
                </p>
                {/* The one ornament (ADR 0103 §5) — same shape as
                    `game-over-dialog.tsx`'s "moment". No stats row here: a
                    Manual (Tabletop) game passes only `{id, name}` for its
                    two players, not life totals — ADR 0080 keeps this screen
                    a concede-only result with no board-state tracking. */}
                <OrnamentalDivider className="w-full max-w-40" />
                {scoreLine && (
                    <p className="text-xs tracking-wide text-text-disabled">
                        {scoreLine}
                    </p>
                )}
                {interstitial && (
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleNextGame()}
                        className="mt-3 w-full"
                    >
                        Next game
                    </Button>
                )}
                <Button
                    type="button"
                    variant={interstitial ? "secondary" : "primary"}
                    onClick={handleLeave}
                    className="mt-3 w-full"
                >
                    Back to Lobby
                </Button>
            </div>
        </GameDialog>
    );
}
