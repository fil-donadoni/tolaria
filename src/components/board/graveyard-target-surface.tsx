import type { ComponentProps } from "react";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { pendingTargetSourceName } from "~/lib/pending-target-title";
import GraveyardTargetDialog from "./graveyard-target-dialog";
import MinimizedChoiceIndicator from "./minimized-choice-indicator";

/** The viewer's graveyard target selection on the board (issue #8426): the
 *  full {@link GraveyardTargetDialog}, or — once minimized — the board
 *  indicator, like the other blocking pickers. Minimize and restore are the
 *  board's shared view toggle (`useMinimizedChoice`): no mutation fires and
 *  `pendingTarget.selected` is untouched, so a restore reopens the dialog on
 *  the same picks. The indicator names the source (a full ability text is
 *  the dialog's title, too long for a badge). */
export default function GraveyardTargetSurface(
    props: Omit<ComponentProps<typeof GraveyardTargetDialog>, "onMinimize">
) {
    const { isMinimized, minimize } = useMinimizedChoice();
    if (isMinimized) {
        return (
            <MinimizedChoiceIndicator
                label={pendingTargetSourceName(
                    props.pendingTarget,
                    props.me,
                    props.stack
                )}
            />
        );
    }
    return <GraveyardTargetDialog {...props} onMinimize={minimize} />;
}
