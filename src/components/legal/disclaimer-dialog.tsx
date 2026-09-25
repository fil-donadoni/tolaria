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
            {/* A focusable, named region (issue #4423): the disclaimer is
                text only, so on a landscape phone the dialog body scrolls with
                nothing inside it a keyboard can land on — axe's
                `scrollable-region-focusable`. Focus here lets the arrow keys
                scroll the body. */}
            <div
                role="region"
                aria-label="Disclaimer text"
                tabIndex={0}
                className="flex flex-col gap-3 text-sm leading-relaxed text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
                {LEGAL_PARAGRAPHS.map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                ))}
            </div>
        </GameDialog>
    );
}
