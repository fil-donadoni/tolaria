import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import type { GameOver, Player } from "~/types/game";

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

    const loserName = loser?.name ?? "?";
    const reasonText =
        gameOver.reason === "life"
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
        <Dialog open onOpenChange={() => {}} disablePointerDismissal>
            <DialogContent showCloseButton={false} className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl">
                        Game Over
                    </DialogTitle>
                    <DialogDescription className="text-center">
                        {reasonText}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center gap-2 py-4">
                    <span className="text-3xl font-bold text-foreground">
                        {winner?.name ?? "?"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                        wins the game
                    </span>
                </div>
                <DialogFooter>
                    <Button onClick={handleLeave} className="w-full">
                        Back to lobby
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
