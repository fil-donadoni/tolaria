import GameDialog from "@/components/ui/game-dialog";
import { LEGAL_PARAGRAPHS, LEGAL_TITLE } from "@/lib/legal";

type DisclaimerDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/** Full fan-content disclaimer, surfaced from the lobby footer link. */
export default function DisclaimerDialog({
    open,
    onOpenChange,
}: DisclaimerDialogProps) {
    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title={LEGAL_TITLE}
            showCloseButton
        >
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-text-muted">
                {LEGAL_PARAGRAPHS.map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                ))}
            </div>
        </GameDialog>
    );
}
