import GameDialog from "~/components/ui/game-dialog";
import type { GameOver, Player } from "~/types/game";

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
};

export default function GameOverDialog({
    gameOver,
    allPlayers,
}: GameOverDialogProps) {
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
            : `${loserName} conceded`;

    const handleLeave = () => {
        localStorage.removeItem("tolaria:gameId");
        localStorage.removeItem("tolaria:playerId");
        window.location.href = "/";
    };

    return (
        <GameDialog
            open
            title="Game Over"
            icon={<SkullIcon />}
            dismissable={false}
        >
            <div className="flex flex-col items-center text-center gap-2 mt-1">
                <p className="text-zinc-400 text-sm">{reasonText}</p>
                <span className="text-2xl sm:text-3xl font-bold text-amber-400 font-beleren tracking-wide">
                    {isDraw ? "Draw" : `${winner?.name ?? "?"} wins!`}
                </span>
                <button
                    type="button"
                    onClick={handleLeave}
                    className="mt-3 w-full py-2.5 rounded-sm bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 font-beleren tracking-wide hover:bg-zinc-700/40 transition-colors cursor-pointer"
                >
                    Back to Lobby
                </button>
            </div>
        </GameDialog>
    );
}
