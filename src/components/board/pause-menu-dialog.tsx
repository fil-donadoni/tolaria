import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PublicMatch } from "@convex/matches";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import { clearSession } from "~/lib/session";

type Step = "menu" | "confirm-concede" | "confirm-forfeit";

type PauseMenuDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    gameId: Id<"games">;
    playerId: string;
    /** Owning Match (ADR 0029). Drives the Concede-vs-Forfeit split (#396): the
     *  in-game Concede loses only the current Game, while Forfeit Match ends the
     *  whole Match. In a Bo1 the two coincide, so the menu only offers Forfeit.
     *  Null while the Match meta is still loading or for a legacy match-less
     *  game — then only the single-game Concede is shown. */
    match: PublicMatch | null;
};

export default function PauseMenuDialog({
    open,
    onOpenChange,
    gameId,
    playerId,
    match,
}: PauseMenuDialogProps) {
    const [step, setStep] = useState<Step>("menu");
    const [isBusy, setIsBusy] = useState(false);
    const concede = useMutation(api.game.concede);
    const forfeitMatch = useMutation(api.game.forfeitMatch);

    // A Bo3 keeps Concede (loses one Game) distinct from Forfeit (ends the
    // Match). A Bo1 — or a match-less legacy game — collapses to Concede only,
    // since losing the single Game already ends everything.
    const isBo3 = match?.bestOf === 3;

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) setStep("menu");
        onOpenChange(nextOpen);
    };

    const handleConcede = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await concede({ gameId, playerId });
            handleOpenChange(false);
        } finally {
            setIsBusy(false);
        }
    };

    const handleForfeit = async () => {
        if (isBusy || !match) return;
        setIsBusy(true);
        try {
            await forfeitMatch({ matchId: match.matchId, playerId });
            // Forfeiting ends the Match; drop the session and return to lobby so
            // no orphaned active Match is left behind (#396).
            clearSession();
            handleOpenChange(false);
            window.location.href = "/";
        } finally {
            setIsBusy(false);
        }
    };

    if (step === "confirm-concede") {
        return (
            <GameDialog
                open={open}
                onOpenChange={handleOpenChange}
                title="Concede Game"
                subtitle="Do you really want to concede this game?"
                dismissable
            >
                <div className="flex gap-3 mt-2">
                    <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setStep("menu")}
                    >
                        No
                    </Button>
                    <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={handleConcede}
                        disabled={isBusy}
                    >
                        Yes
                    </Button>
                </div>
            </GameDialog>
        );
    }

    if (step === "confirm-forfeit") {
        return (
            <GameDialog
                open={open}
                onOpenChange={handleOpenChange}
                title="Forfeit Match"
                subtitle="Do you really want to forfeit the entire match?"
                dismissable
            >
                <div className="flex gap-3 mt-2">
                    <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setStep("menu")}
                    >
                        No
                    </Button>
                    <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={handleForfeit}
                        disabled={isBusy}
                    >
                        Yes
                    </Button>
                </div>
            </GameDialog>
        );
    }

    return (
        <GameDialog
            open={open}
            onOpenChange={handleOpenChange}
            title="Game Menu"
            showCloseButton
            dismissable
        >
            <div className="flex flex-col gap-3 mt-2">
                <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => setStep("confirm-concede")}
                >
                    {isBo3 ? "Concede Game" : "Concede"}
                </Button>
                {isBo3 && match && (
                    <Button
                        variant="destructive"
                        className="w-full"
                        onClick={() => setStep("confirm-forfeit")}
                    >
                        Concede Match
                    </Button>
                )}
            </div>
        </GameDialog>
    );
}
