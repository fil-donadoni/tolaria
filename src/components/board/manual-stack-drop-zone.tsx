import { ABOVE_CONTROLLER_POD_EXPR } from "~/lib/controller-bar-metrics";

/**
 * The empty stack's drop target on a Manual Board (issue #2351).
 *
 * `GameStack` unmounts when the stack empties, and with it the stack's
 * `data-zone-drop` handle — so the first card could only reach the stack by
 * menu. This quiet placeholder keeps the handle present while the stack is
 * empty, anchored where the desktop panel will appear. The stack is game-wide,
 * so the handle carries no `data-zone-owner`.
 */
export default function ManualStackDropZone({
    desktop,
}: {
    /** Desktop anchors above the controller pod, like the panel itself; the
     *  other layouts sit on the right edge's midline. */
    desktop: boolean;
}) {
    return (
        <div
            data-testid="manual-stack-drop-zone"
            data-zone-drop="stack"
            className={`absolute right-2 z-stack rounded-[var(--panel-radius)] border border-dashed border-border-strong bg-surface-elevated/60 px-3 py-2 text-[10px] text-text-muted ${
                desktop ? "" : "top-1/2 -translate-y-1/2"
            }`}
            style={
                desktop
                    ? { bottom: `calc${ABOVE_CONTROLLER_POD_EXPR}` }
                    : undefined
            }
        >
            Stack — drop a card here
        </div>
    );
}
