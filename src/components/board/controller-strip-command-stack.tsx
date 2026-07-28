import { FastForward } from "lucide-react";
import type { ControllerCommandSlots } from "~/lib/controller-action-slots";
import {
    CONTROLLER_PRIMARY_TONE,
    CONTROLLER_SECONDARY_TONE,
} from "~/lib/controller-action-tone";

/** Shared geometry for the strip's primary slot. Every state — actionable CTA,
 *  status pill, or the disabled placeholder — renders at exactly this size,
 *  which is what makes the strip shift-free as priority changes. The strip is a
 *  fixed-width rail, so the slot is full-width and `truncate` (not `min-w-`)
 *  absorbs a long label: the CTA's POSITION never moves, only its text
 *  ellipsises. */
const PRIMARY_SLOT = "h-10 w-full rounded-full px-3";

/** The landscape-compact strip's command stack (#1769) — the vertical
 *  counterpart of {@link ControllerCommandRow}.
 *
 *  Same variant-D idioms, rotated: ONE morphing primary call-to-action (the
 *  first actionable contextual action beats Pass), an always-mounted Pass-Turn
 *  control that greys out instead of unmounting, and any remaining actions as
 *  small side pills. Nothing here decides WHICH action goes where —
 *  {@link selectCommandSlots} does, exactly as for portrait, so the morphing
 *  rule has ONE implementation and stays unit tested away from React.
 *
 *  Every button dispatches the descriptor's own `onClick`, i.e. the IDENTICAL
 *  mutation the desktop pod dispatches. View layer only.
 *
 *  **Why the primary gets its own line.** The rail is ~10rem wide, so pairing
 *  the CTA with Pass Turn on one line (the portrait arrangement) would leave
 *  the CTA ~7rem — enough to ellipsise "Confirm Attackers (12)" down to
 *  uselessness. Giving the primary the full rail width fits the widest real
 *  label, and Pass Turn drops to its own full-width row below, where it is also
 *  a far bigger touch target than the portrait circle. */
export default function ControllerStripCommandStack({
    slots,
}: {
    slots: ControllerCommandSlots;
}) {
    const { primary, statusPill, secondary, passTurn } = slots;

    return (
        <div
            data-controller-strip-command-stack
            className="flex flex-col gap-1.5"
        >
            {secondary.map((action) => (
                <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`h-7 w-full truncate rounded-full border px-2 text-[10px] font-semibold shadow-lg backdrop-blur-md transition-opacity disabled:opacity-40 ${
                        CONTROLLER_SECONDARY_TONE[action.tone]
                    }`}
                >
                    {action.label}
                </button>
            ))}

            {/* The primary slot. A status pill (waiting / auto-passing) is
                informative chrome rather than a call-to-action, but it stays
                CLICKABLE when the engine gave it a real handler — cancelling
                auto-pass is a tap on that pill. */}
            {!primary && statusPill ? (
                <button
                    type="button"
                    onClick={statusPill.onClick}
                    disabled={statusPill.disabled}
                    className={`${PRIMARY_SLOT} truncate border border-border-subtle bg-surface-base/85 font-beleren text-xs tracking-wide text-text-muted shadow-lg backdrop-blur-md disabled:opacity-70`}
                >
                    {statusPill.label}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={primary?.onClick}
                    disabled={!primary || primary.disabled}
                    className={`${PRIMARY_SLOT} truncate font-beleren text-xs font-bold tracking-wide shadow-[0_4px_18px_rgba(0,0,0,0.45)] transition-all disabled:opacity-40 disabled:shadow-none ${
                        CONTROLLER_PRIMARY_TONE[primary?.tone ?? "primary"]
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
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-danger/40 bg-surface-base/85 text-[10px] font-semibold uppercase tracking-[0.14em] text-danger-strong shadow-lg backdrop-blur-md disabled:opacity-40"
            >
                <FastForward className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Pass Turn
            </button>
        </div>
    );
}
