import { FastForward } from "lucide-react";
import type { ControllerCommandSlots } from "~/lib/controller-action-slots";

/** Shared geometry for the centre slot. Every state — actionable CTA, status
 *  pill, or the disabled placeholder — renders at exactly this size, which is
 *  what makes the row shift-free as priority changes. */
const CENTRE_SLOT = "h-11 min-w-[11rem] rounded-full px-6";

/** The command row floating above the portrait tab bar (variant D, #1759).
 *
 *  Arena's model: ONE morphing primary call-to-action in a fixed centre slot
 *  (the first actionable contextual action beats Pass), an always-mounted
 *  circular Pass-Turn button that greys out instead of unmounting, and any
 *  remaining actions as small side pills. Nothing here decides WHICH action
 *  goes where — {@link selectCommandSlots} does, so the morphing rule is unit
 *  tested away from React.
 *
 *  Every button dispatches the descriptor's own `onClick`, i.e. the IDENTICAL
 *  mutation the desktop pod dispatches. View layer only. */
export default function ControllerCommandRow({
    slots,
}: {
    slots: ControllerCommandSlots;
}) {
    const { primary, statusPill, secondary, passTurn } = slots;

    return (
        <div className="mx-3 mb-2 flex items-center justify-center gap-2">
            {secondary.map((action) => (
                <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`h-9 shrink-0 rounded-full border px-4 text-xs font-semibold shadow-lg backdrop-blur-md transition-opacity disabled:opacity-40 ${
                        action.tone === "destructive"
                            ? "border-danger/50 bg-surface-base/85 text-danger-strong"
                            : "border-border-accent/50 bg-surface-base/85 text-accent-strong"
                    }`}
                >
                    {action.label}
                </button>
            ))}

            {/* The centre slot. A status pill (waiting / auto-passing) is
                informative chrome rather than a call-to-action, but it stays
                CLICKABLE when the engine gave it a real handler — cancelling
                auto-pass is a tap on that pill. */}
            {!primary && statusPill ? (
                <button
                    type="button"
                    onClick={statusPill.onClick}
                    disabled={statusPill.disabled}
                    className={`${CENTRE_SLOT} flex items-center justify-center border border-border-subtle bg-surface-base/85 font-beleren text-sm tracking-wide text-text-muted shadow-lg backdrop-blur-md disabled:opacity-70`}
                >
                    {statusPill.label}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={primary?.onClick}
                    disabled={!primary || primary.disabled}
                    className={`${CENTRE_SLOT} font-beleren text-sm font-bold tracking-wide shadow-[0_4px_18px_rgba(0,0,0,0.45)] transition-all disabled:opacity-40 disabled:shadow-none ${
                        primary?.tone === "destructive"
                            ? "border border-danger/60 bg-surface-base/90 text-danger-strong backdrop-blur-md"
                            : "bg-gradient-to-b from-accent-strong to-accent text-surface-base"
                    }`}
                >
                    {primary?.label ?? "Pass"}
                </button>
            )}

            <button
                type="button"
                aria-label="Pass Turn"
                onClick={passTurn?.onClick}
                disabled={!passTurn || passTurn.disabled}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-danger/40 bg-surface-base/85 text-danger-strong shadow-lg backdrop-blur-md disabled:opacity-40"
            >
                <FastForward className="h-4 w-4" aria-hidden />
            </button>
        </div>
    );
}
