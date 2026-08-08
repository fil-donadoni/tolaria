import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import type { ActiveGameInfo } from "~/hooks/useScenarioTestGame";

type Props = {
    activeGame: ActiveGameInfo;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
};

/**
 * Confirm-and-retry prompt for the Scenarios admin panel's "Test" button
 * (issue #2400): the button used to just error out via the plain banner when
 * the user already had an active game — the exact rule `createSoloGame`
 * enforces (#155, one active game per user). This offers to concede that
 * game and retry the launch instead.
 *
 * Models the lobby's `ActiveGameNotice` "Concede Match?" prompt (not reused
 * directly — this dialog's action is "concede AND start the scenario", not
 * "resume"). The caller (`useScenarioTestGame`) already picked the correct
 * mutation for the game's type before this ever renders; this component only
 * describes it and confirms.
 */
export default function ScenarioActiveGameDialog({
    activeGame,
    busy,
    onCancel,
    onConfirm,
}: Props) {
    const typeLabel =
        activeGame.mode === "manual"
            ? "manual"
            : activeGame.solo
              ? "solo"
              : "2-player";
    const opponentSuffix = activeGame.opponentName
        ? ` vs ${activeGame.opponentName}`
        : "";

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
            title="Concede active game?"
            subtitle={`You have an active ${typeLabel} game${opponentSuffix} — concede it and start the scenario?`}
        >
            <div className="mt-4 flex justify-end gap-2">
                <ActionButton
                    onClick={onCancel}
                    label="Cancel"
                    tone="secondary"
                    disabled={busy}
                />
                <ActionButton
                    onClick={onConfirm}
                    label={busy ? "Conceding…" : "Concede & Start"}
                    tone="destructive"
                    disabled={busy}
                />
            </div>
        </GameDialog>
    );
}
