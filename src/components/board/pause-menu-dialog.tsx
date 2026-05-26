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
    const [isBusy, setIsBusy] = useState(false);
    const concede = useMutation(api.game.concede);

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

    if (step === "confirm-concede") {
        return (
            <GameDialog
                open={open}
                onOpenChange={handleOpenChange}
                title="Concede"
                subtitle="Do you really want to concede?"
                dismissable
            >
                <div className="flex gap-3 mt-2">
                    <button
                        type="button"
                        onClick={() => setStep("menu")}
                        className="flex-1 py-2 rounded-sm bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 font-beleren tracking-wide hover:bg-zinc-700/40 transition-colors cursor-pointer"
                    >
                        No
                    </button>
                    <button
                        type="button"
                        onClick={handleConcede}
                        disabled={isBusy}
                        className="flex-1 py-2 rounded-sm bg-[#5c1e1e]/45 border border-[#a04040]/45 text-[#d48080] font-beleren tracking-wide hover:bg-[#5c1e1e]/65 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                        Yes
                    </button>
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
                <button
                    type="button"
                    onClick={() => setStep("confirm-concede")}
                    className="w-full py-2.5 rounded-sm bg-[#5c1e1e]/45 border border-[#a04040]/45 text-[#d48080] font-beleren tracking-wide hover:bg-[#5c1e1e]/65 transition-colors cursor-pointer"
                >
                    Concede
                </button>
            </div>
        </GameDialog>
    );
}
