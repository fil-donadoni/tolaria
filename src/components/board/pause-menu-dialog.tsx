import { useContext, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PublicMatch } from "@convex/matches";
import { GameContext } from "~/hooks/useGameContext";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import { clearSession } from "~/lib/session";
import { requestBugReport } from "~/lib/bug-report-requests";
import ClearYieldsButton from "./clear-yields-button";
import { lobbyHrefForMatch } from "~/lib/matchNavigation";

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
    const manualConcede = useMutation(api.game.manualConcedeMatch);

    // Issue #2353 — the Manual Board mounts this same dialog. The mode rides
    // the board context's explicit discriminator (issue #2346), never a probe
    // for a missing GRE state: `makeManualGameContext` is the only value that
    // sets it, so the GRE board reads `undefined`. Structural read, same as
    // `PreviewGameCtx` — `GameContext`'s declared type has no such field.
    const gameCtx = useContext(GameContext) as {
        isManualGame?: boolean;
    } | null;
    const isManualGame = gameCtx?.isManualGame === true;

    // A Bo3 keeps Concede (loses one Game) distinct from Forfeit (ends the
    // Match). A Bo1 — or a match-less legacy game — collapses to Concede only,
    // since losing the single Game already ends everything. A Manual Game has
    // ONE terminator (ADR 0080), so it never splits either.
    const isBo3 = !isManualGame && match?.bestOf === 3;

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) setStep("menu");
        onOpenChange(nextOpen);
    };

    const handleConcede = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            // A Manual Game has no `gameStates` row, so `api.game.concede`
            // throws "Game not found" there. `manualConcedeMatch` is the
            // finalizing concede the lobby banner already calls: opponent
            // recorded as winner, Match finalized, manual state deleted. No
            // navigation here — the game route swaps a finished manual game
            // for `ManualGameOverDialog`, whose "Back to Lobby" owns the
            // session teardown. The server asserts the caller owns the seat.
            if (isManualGame) await manualConcede({ gameId, playerId });
            else await concede({ gameId, playerId });
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
            // no orphaned active Match is left behind (#396). An event Match
            // returns to its OWN event lobby (`lobbyHrefForMatch`).
            clearSession();
            handleOpenChange(false);
            window.location.href = lobbyHrefForMatch(match);
        } finally {
            setIsBusy(false);
        }
    };

    if (step === "confirm-concede") {
        return (
            <GameDialog
                open={open}
                onOpenChange={handleOpenChange}
                title={isManualGame ? "Concede" : "Concede Game"}
                subtitle={
                    isManualGame
                        ? "Do you really want to concede? Your opponent wins the match."
                        : "Do you really want to concede this game?"
                }
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
                {/* Issue #3556 §5 — the **Yield** reset's second home, so it
                    stays reachable when the **Stack** panel is collapsed.
                    Renders nothing while the viewing seat holds no yields. */}
                <ClearYieldsButton variant="menu" />
                {/* Issue #3419 — the bug report's in-game home on the portrait
                    bar, whose four tabs are already at their touch-target
                    budget. The menu closes first: the dialog belongs to the
                    router-root host, not to this menu. */}
                <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                        handleOpenChange(false);
                        requestBugReport();
                    }}
                >
                    Report a bug
                </Button>
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
