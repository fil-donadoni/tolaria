import { useState } from "react";
import type { PublicMatch } from "@convex/matches";
import GameDialog from "~/components/ui/game-dialog";
import { clearSession } from "~/lib/session";
import type { GameOver, Player } from "~/types/game";
import SideboardingDialog from "./sideboarding-dialog";

function SkullIcon() {
    return (
        <svg
            viewBox="0 0 100 100"
            className="w-16 h-16 sm:w-20 sm:h-20 fill-[#cfc5b0] opacity-90"
        >
            <ellipse cx="50" cy="42" rx="30" ry="32" />
            <circle cx="38" cy="38" r="8" fill="#0c0d12" />
            <circle cx="62" cy="38" r="8" fill="#0c0d12" />
            <path d="M44 55 L48 65 L52 65 L56 55" fill="#0c0d12" />
            <rect x="40" y="68" width="5" height="12" rx="1" />
            <rect x="48" y="68" width="5" height="12" rx="1" />
            <rect x="56" y="68" width="5" height="12" rx="1" />
        </svg>
    );
}

type GameOverDialogProps = {
    gameOver: GameOver;
    allPlayers: Player[];
    /** Owning Match (ADR 0029). Drives the interstitial-vs-terminal split: a
     *  decided Match ("finished") is the terminal result ("Back to Lobby"); an
     *  undecided Bo3 ("sideboarding") is an interstitial with the running score
     *  and a "Continue to Sideboarding" that opens the between-Games editor
     *  (PRD #387 / #395). */
    match: PublicMatch | null;
    /** The viewer's seat id — carried into the next Game's session so the
     *  client re-points to the same seat across Games of the Match. */
    viewerId: string;
};

export default function GameOverDialog({
    gameOver,
    allPlayers,
    match,
    viewerId,
}: GameOverDialogProps) {
    // Once the player clicks Continue on an undecided Bo3, the interstitial hands
    // off to the Sideboarding step (#395), which owns the swap editor, the
    // play/draw choice, and the Ready gate that builds the next Game.
    const [sideboarding, setSideboarding] = useState(false);

    const winner = allPlayers.find((p) => p.id === gameOver.winnerId);
    const loser = allPlayers.find((p) => p.id === gameOver.loserId);

    const isDraw = gameOver.isDraw === true || gameOver.reason === "draw";
    const loserName = loser?.name ?? "?";
    const reasonText = isDraw
        ? "The game is a draw"
        : gameOver.reason === "life"
          ? `${loserName} ran out of life`
          : gameOver.reason === "decked"
            ? `${loserName} tried to draw from an empty library`
            : gameOver.reason === "poison"
              ? `${loserName} succumbed to poison`
              : `${loserName} conceded`;

    // Terminal Match result: the Match is decided (Bo1 always; Bo3 at first to
    // two). "Back to Lobby" is shown only when the Match is over (PRD #387).
    const matchOver = match?.status === "finished";
    // Interstitial: an undecided Bo3 between Games. The player continues into the
    // Sideboarding step; the screen shows the running score, no "Back to Lobby".
    const interstitial = match?.status === "sideboarding";
    // When Match meta isn't available (still loading, or a legacy game without
    // a Match), fall back to the single-game terminal so the user is never
    // stranded without a "Back to Lobby".
    const showLeave = matchOver || match === null;
    const matchWinner = match?.players.find((p) => p.id === match.winner);
    const scoreLine = match
        ? match.players.map((p) => `${p.name}: ${p.score}`).join("  ·  ")
        : null;

    const handleLeave = () => {
        // Clear the session so the lobby is reachable (PRD #387 user story 32).
        clearSession();
        window.location.href = "/";
    };

    // Bo3 interstitial → Sideboarding step. The dialog owns submitSideboard +
    // setReady; the next Game builds once readiness is satisfied (#395).
    if (interstitial && sideboarding && match) {
        return <SideboardingDialog match={match} viewerId={viewerId} />;
    }

    return (
        <GameDialog
            open
            title={matchOver ? "Match Over" : "Game Over"}
            icon={<SkullIcon />}
            dismissable={false}
        >
            <div className="flex flex-col items-center text-center gap-2 mt-1">
                <p className="text-zinc-400 text-sm">{reasonText}</p>
                <span className="text-2xl sm:text-3xl font-bold text-amber-400 font-beleren tracking-wide">
                    {isDraw
                        ? "Draw"
                        : matchOver
                          ? `${matchWinner?.name ?? winner?.name ?? "?"} wins the match!`
                          : `${winner?.name ?? "?"} wins!`}
                </span>
                {scoreLine && (
                    <p className="text-zinc-500 text-xs tracking-wide">
                        {scoreLine}
                    </p>
                )}
                {interstitial && (
                    <button
                        type="button"
                        onClick={() => setSideboarding(true)}
                        className="mt-3 w-full py-2.5 rounded-sm bg-amber-700/30 border border-amber-500/45 text-amber-200 font-beleren tracking-wide hover:bg-amber-600/30 transition-colors cursor-pointer"
                    >
                        Continue to Sideboarding
                    </button>
                )}
                {showLeave && (
                    <button
                        type="button"
                        onClick={handleLeave}
                        className="mt-3 w-full py-2.5 rounded-sm bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 font-beleren tracking-wide hover:bg-zinc-700/40 transition-colors cursor-pointer"
                    >
                        Back to Lobby
                    </button>
                )}
            </div>
        </GameDialog>
    );
}
