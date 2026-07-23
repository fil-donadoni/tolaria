import type { AttackAllConfirm } from "~/hooks/useControllerActions";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";

/** Confirmation for the Space-triggered "Attack with all" (design 2026-07-23).
 *  During DECLARE_ATTACKERS the Space hotkey now offers to send in every
 *  eligible creature instead of skipping the attack, so it is gated here —
 *  Space is the same reflex keystroke that used to mean "Skip Attack", and
 *  declaring a whole board of attackers by accident is not recoverable once
 *  confirmed. The pod's own "Attack with all" button bypasses this dialog: a
 *  click is already a deliberate act.
 *
 *  Rendered by whichever controller surface is mounted (pod or bottom bar);
 *  exactly one of them mounts, so the dialog never doubles. */
export default function AttackAllConfirmDialog({
    confirm: state,
}: {
    confirm: AttackAllConfirm;
}) {
    return (
        <GameDialog
            open={state.open}
            onOpenChange={(open) => {
                if (!open) state.cancel();
            }}
            title="Attack with all"
            subtitle={`Declare ${state.eligibleCount} creature${
                state.eligibleCount === 1 ? "" : "s"
            } as attackers`}
        >
            <div className="mt-3 flex justify-end gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => state.cancel()}
                >
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    autoFocus
                    onClick={() => state.confirm()}
                >
                    Attack
                </Button>
            </div>
        </GameDialog>
    );
}
