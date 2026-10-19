import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";

/** Confirmation before a creator starts a Limited Event without a Seat
 *  (issue #5665): they will neither draft nor play, and bots fill every free
 *  Seat, including the one they could have taken. Cancelling leaves the event
 *  untouched. */
export default function LimitedStartUnseatedDialog({
    open,
    onOpenChange,
    onConfirm,
    pending,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    pending: boolean;
}) {
    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Start without playing?"
            subtitle="You are NOT in this event, so you will not play or draft. Every free Seat, including yours, will be filled by bots."
        >
            <div className="mt-4 flex justify-end gap-2">
                <ActionButton
                    onClick={() => onOpenChange(false)}
                    label="Join first"
                    tone="secondary"
                />
                <ActionButton
                    onClick={onConfirm}
                    label="Start without playing"
                    tone="primary"
                    disabled={pending}
                />
            </div>
        </GameDialog>
    );
}
