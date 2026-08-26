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
 *  ellipsises. `h-11` (44px, #1770 mobile QA sweep) — was `h-10` (40px),
 *  below the touch-target floor. */
const PRIMARY_SLOT = "h-11 w-full rounded-full px-3";

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
            {/* `h-11` (44px, #1770 mobile QA sweep): was `h-7` (28px), well
                below the touch-target floor. */}
            {secondary.map((action) => (
                <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`h-11 w-full truncate rounded-full border px-2 text-[10px] font-semibold shadow-lg backdrop-blur-md transition-opacity disabled:opacity-40 ${
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
                    className={`${PRIMARY_SLOT} truncate border border-border-strong bg-surface-base/85 text-display text-xs text-text-muted shadow-lg backdrop-blur-md disabled:opacity-70`}
                >
                    {statusPill.label}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={primary?.onClick}
                    disabled={!primary || primary.disabled}
                    className={`${PRIMARY_SLOT} truncate text-display text-xs shadow-[0_4px_18px_rgba(0,0,0,0.45)] transition-all disabled:opacity-40 disabled:shadow-none ${
                        CONTROLLER_PRIMARY_TONE[primary?.tone ?? "primary"]
                    }`}
                >
                    {primary?.label ?? "Pass"}
                </button>
            )}

            {/* `h-11` (44px, #1770 mobile QA sweep): was `h-9` (36px), below
                the touch-target floor. */}
            <button
                type="button"
                aria-label="Pass Turn"
                onClick={passTurn?.onClick}
                disabled={!passTurn || passTurn.disabled}
                // A quiet edge, not `danger` (ADR 0103 §3, issue #2727):
                // passing the turn is the most routine action on the board and
                // never deserved a warning edge. The one loud control in this
                // stack is the ivory plate above. `border-strong` rather than
                // the decorative `--hairline` pair — a control edge is bound by
                // WCAG 1.4.11 at 3:1 (round-2 review; see `.btn-base` in
                // `src/index.css`).
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border-strong bg-surface-base/85 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted shadow-lg backdrop-blur-md transition-colors hover:text-text disabled:opacity-40"
            >
                <FastForward className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Pass Turn
            </button>
        </div>
    );
}
