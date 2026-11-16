import type { ControllerAction } from "~/hooks/useControllerActions";
import type { ControllerCommandSlots } from "~/lib/controller-action-slots";
import ActionButton from "./action-button";

/** The pod's action LIST — one button per action, stacked — kept for a
 *  controller with no priority to come and go (the Manual Board's verbs,
 *  `hotkeyScope: "manual"`): its eight verbs never change, so nothing
 *  shifts, and they would not fit the GRE pod's one-line command row
 *  (issue #9835). It marks the SAME action the command row puts in its
 *  centre slot, so `check:ui`'s one `data-controller-primary` promise
 *  addresses every controller layout (issue #3651). */
export default function ControllerPodActionList({
    actions,
    slots,
}: {
    actions: ControllerAction[];
    slots: ControllerCommandSlots;
}) {
    if (actions.length === 0) return null;
    const primaryMark = (
        action: ControllerAction
    ): "action" | "status" | undefined =>
        action === slots.primary
            ? "action"
            : !slots.primary && action === slots.statusPill
              ? "status"
              : undefined;
    return (
        <div className="flex flex-col gap-1.5">
            {actions.map((action) =>
                action.pill ? (
                    <button
                        key={action.key}
                        type="button"
                        data-controller-primary={primaryMark(action)}
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
                        controllerPrimary={primaryMark(action)}
                    />
                )
            )}
        </div>
    );
}
