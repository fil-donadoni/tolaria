// PROTOTYPE — throwaway. Baseline: the pod's action area exactly as shipped.
import type {
    ControllerAction,
    ControllerCue,
} from "~/hooks/useControllerActions";
import ActionButton from "../action-button";
import ControllerCueBadge from "../controller-cue-badge";

export default function Variant0Current({
    cue,
    actions,
}: {
    cue: ControllerCue;
    actions: ControllerAction[];
}) {
    return (
        <>
            <ControllerCueBadge cue={cue} />
            {actions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    {actions.map((action) =>
                        action.pill ? (
                            <button
                                key={action.key}
                                type="button"
                                onClick={action.onClick}
                                disabled={action.disabled}
                                className="rounded-sm border border-border-strong bg-surface-elevated px-3 py-2 text-center text-xs text-text-muted shadow-md transition-colors hover:text-text disabled:cursor-default disabled:opacity-70"
                            >
                                {action.label}
                            </button>
                        ) : (
                            <ActionButton
                                key={action.key}
                                onClick={action.onClick}
                                label={action.label}
                                tone={action.tone}
                                disabled={action.disabled}
                                shortcut={action.shortcut}
                            />
                        )
                    )}
                </div>
            )}
        </>
    );
}
