// The "Next" button of a multi-control setup step (issue #5934): a step with
// several fields has no single click that means "done", so the player says it.
// Shared by the Constructed and Limited flows. Disabled until the step holds a
// valid answer.
import { PanelFooter } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";

export default function SetupNextButton({
    disabled,
    onNext,
}: {
    disabled: boolean;
    onNext: () => void;
}) {
    return (
        <PanelFooter>
            <ActionButton label="Next" disabled={disabled} onClick={onNext} />
        </PanelFooter>
    );
}
