import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

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
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent showCloseButton={false} className="max-w-sm">
                {step === "menu" ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-center">
                                Game menu
                            </DialogTitle>
                        </DialogHeader>
                        <DialogFooter className="sm:justify-center">
                            <Button
                                variant="destructive"
                                onClick={() => setStep("confirm-concede")}
                                className="w-full"
                            >
                                Concede
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-center">
                                Do you really want to concede?
                            </DialogTitle>
                        </DialogHeader>
                        <DialogFooter className="sm:justify-center">
                            <Button
                                variant="outline"
                                onClick={() => setStep("menu")}
                                className="flex-1"
                            >
                                No
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleConcede}
                                className="flex-1"
                            >
                                Yes
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
