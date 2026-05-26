import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import GameDialog from "~/components/ui/game-dialog";

type Step = "menu" | "confirm-concede";

type PauseMenuDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    gameId: Id<"games">;
    playerId: string;
};

export default function PauseMenuDialog({
    open,
    onOpenChange,
    gameId,
    playerId,
}: PauseMenuDialogProps) {
    const [step, setStep] = useState<Step>("menu");
    const concede = useMutation(api.game.concede);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) setStep("menu");
        onOpenChange(nextOpen);
    };

    const handleConcede = async () => {
        await concede({ gameId, playerId });
        handleOpenChange(false);
    };

    return (
        <GameDialog
            open={open}
            onOpenChange={handleOpenChange}
            title="Game Menu"
            showCloseButton
            dismissable
        >
            <div className="flex flex-col gap-3 mt-2">
                {step === "menu" ? (
                    <button
                        type="button"
                        onClick={() => setStep("confirm-concede")}
                        className="w-full py-2.5 rounded-sm bg-red-900/30 border border-red-800/50 text-red-400 font-[var(--font-beleren)] tracking-wider hover:bg-red-900/50 transition-colors cursor-pointer"
                    >
                        Concede
                    </button>
                ) : (
                    <>
                        <p className="text-zinc-300 text-sm text-center">
                            Do you really want to concede?
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setStep("menu")}
                                className="flex-1 py-2 rounded-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                            >
                                No
                            </button>
                            <button
                                type="button"
                                onClick={handleConcede}
                                className="flex-1 py-2 rounded-sm bg-red-900/40 border border-red-800/50 text-red-400 hover:bg-red-900/60 transition-colors cursor-pointer"
                            >
                                Yes
                            </button>
                        </div>
                    </>
                )}
            </div>
        </GameDialog>
    );
}
