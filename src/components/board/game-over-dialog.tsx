import { useState } from "react";
import type { PublicMatch } from "@convex/matches";
import GameDialog from "~/components/ui/game-dialog";
import TitleTreatment from "~/components/ui/title-treatment";
import { Button } from "~/components/ui/button";
import { clearSession } from "~/lib/session";
import { lobbyHrefForMatch } from "~/lib/matchNavigation";
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
    const winnerName = winner?.name ?? "?";
    const reasonText = isDraw
        ? "The game is a draw"
        : gameOver.reason === "life"
          ? `${loserName} ran out of life`
          : gameOver.reason === "decked"
            ? `${loserName} tried to draw from an empty library`
            : gameOver.reason === "poison"
              ? `${loserName} succumbed to poison`
              : gameOver.reason === "alternate-win"
                ? `${winnerName} won by an alternate win condition`
                : `${loserName} conceded`;

    // Terminal Match result: the Match is decided (Bo1 always; Bo3 at first to
    // two). "Back to Lobby" is shown only when the Match is over (PRD #387).
    const matchOver = match?.status === "finished";
    // Interstitial: an undecided Bo3 between Games. The player continues into the
    // Sideboarding step; the screen shows the running score, no "Back to Lobby".
    const interstitial = match?.status === "sideboarding";
    // "Back to Lobby" is ALWAYS available (QA): the game is over, so leaving is
    // legal in every state — a decided Match, a Bo3 between Games, and equally
    // the states this used to miss (Match meta still loading, or a status that
    // is neither `finished` nor `sideboarding`), where the screen offered no
    // action at all and stranded the player. On the Bo3 interstitial it is the
    // secondary action under "Continue to Sideboarding".
    const matchWinner = match?.players.find((p) => p.id === match.winner);
    const scoreLine = match
        ? match.players.map((p) => `${p.name}: ${p.score}`).join("  ·  ")
        : null;

    // The big result headline is viewer-relative (TitleTreatment, issue #597):
    // "Victory" when the viewer's seat took the game, "Defeat" otherwise. The
    // subtitle keeps the name line so the winner is still named for both seats.
    const resultTitle = isDraw
        ? "Draw"
        : gameOver.winnerId === viewerId
          ? "Victory"
          : "Defeat";
    const resultSubtitle = isDraw
        ? undefined
        : matchOver
          ? `${matchWinner?.name ?? winner?.name ?? "?"} wins the match!`
          : `${winner?.name ?? "?"} wins!`;

    const handleLeave = () => {
        // Clear the session so the lobby is reachable (PRD #387 user story 32).
        clearSession();
        // A Match played INSIDE a Limited Event (a seat challenge or a "Play vs
        // the Table" playtest) returns to that event's lobby, not the general
        // one — the event page is where the next opponent is picked.
        window.location.href = lobbyHrefForMatch(match);
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
                <TitleTreatment title={resultTitle} subtitle={resultSubtitle} />
                <p className="text-text-muted text-sm">{reasonText}</p>
                {scoreLine && (
                    <p className="text-text-disabled text-xs tracking-wide">
                        {scoreLine}
                    </p>
                )}
                {interstitial && (
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setSideboarding(true)}
                        className="mt-3 w-full"
                    >
                        Continue to Sideboarding
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
