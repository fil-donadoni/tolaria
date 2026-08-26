import { FastForward } from "lucide-react";
import type { ControllerCommandSlots } from "~/lib/controller-action-slots";
import {
    CONTROLLER_PRIMARY_TONE,
    CONTROLLER_SECONDARY_TONE,
} from "~/lib/controller-action-tone";

/** Shared geometry for the centre slot. Every state — actionable CTA, status
 *  pill, or the disabled placeholder — renders at exactly this size, which is
 *  what makes the row shift-free as priority changes. `min-w-` is a FLOOR, not
 *  a fixed width: the slot may grow with a long label, and on a narrow viewport
 *  flex-shrink pulls it back down (never below the floor) while `truncate`
 *  ellipsises the label — so it can never push Pass Turn off-screen. */
const CENTRE_SLOT = "h-11 min-w-[11rem] rounded-full px-6";

/** The quiet siblings of the ivory plate (ADR 0103 §3, issue #2727): a 1px
 *  edge over the base surface. Pass Turn used to be a `danger`-edged circle,
 *  which read as a warning for the single most routine action on the board;
 *  in v4 it is a plain edge, and the one loud control in the row is the plate.
 *
 *  `border-strong`, NOT the decorative `--hairline` pair the ADR's prose calls
 *  these (round-2 review, and the same call PR #2827 made for `.btn-base` /
 *  `.segment-pill`): `--hairline-strong` is ivory/30 = 2.37:1 on `surface`,
 *  under WCAG 1.4.11's 3:1 for a CONTROL boundary, and this edge is the only
 *  thing bounding the pill. `--color-border-strong` is 3.38:1 and reads the
 *  same at a glance. Panels, dividers and plaques — decoration — keep the
 *  translucent pair. See `src/index.css` around `.btn-base`. */
const EDGE_PILL =
    "border border-border-strong bg-surface-base/85 backdrop-blur-md";

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
 *  mutation the desktop pod dispatches. View layer only.
 *
 *  **Nothing may overflow a 390px viewport.** DECLARE_ATTACKERS is the widest
 *  real state — "Confirm Attackers (12)" in the centre slot, "Attack with all
 *  (12)" as a side pill, plus the circular Pass Turn — which together exceed a
 *  phone's width. A centred non-wrapping row clips BOTH ends there (and a
 *  centred overflow leaves the left end permanently unreachable, scrollbar or
 *  not), so Pass Turn simply vanished. The row therefore WRAPS: side pills fall
 *  to their own line, and the primary + Pass Turn stay glued together in a
 *  group narrow enough to fit any phone on one line. */
export default function ControllerCommandRow({
    slots,
}: {
    slots: ControllerCommandSlots;
}) {
    const { primary, statusPill, secondary, passTurn } = slots;

    return (
        <div
            data-controller-command-row
            className="mx-3 mb-2 flex flex-wrap items-center justify-center gap-2"
        >
            {/* `h-11` (44px, #1770 mobile QA sweep): was `h-9` (36px), below
                the touch-target floor the primary slot and Pass Turn already
                meet below. */}
            {secondary.map((action) => (
                <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    className={`h-11 min-w-0 max-w-full truncate rounded-full border px-4 text-xs font-semibold shadow-lg backdrop-blur-md transition-opacity disabled:opacity-40 ${
                        CONTROLLER_SECONDARY_TONE[action.tone]
                    }`}
                >
                    {action.label}
                </button>
            ))}

            {/* The primary group: centre slot + Pass Turn, kept on one line so
                the CTA and the always-available turn pass never separate. It is
                the row's widest atom and still fits a 390px phone, so it is
                never clipped — only the side pills above it wrap. */}
            <div
                data-controller-primary-group
                className="flex min-w-0 max-w-full items-center gap-2"
            >
                {/* The centre slot. A status pill (waiting / auto-passing) is
                informative chrome rather than a call-to-action, but it stays
                CLICKABLE when the engine gave it a real handler — cancelling
                auto-pass is a tap on that pill. */}
                {!primary && statusPill ? (
                    <button
                        type="button"
                        onClick={statusPill.onClick}
                        disabled={statusPill.disabled}
                        className={`${CENTRE_SLOT} ${EDGE_PILL} flex items-center justify-center truncate text-display text-sm text-text-muted shadow-lg disabled:opacity-70`}
                    >
                        {statusPill.label}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={primary?.onClick}
                        disabled={!primary || primary.disabled}
                        className={`${CENTRE_SLOT} truncate text-display text-sm shadow-[0_4px_18px_rgba(0,0,0,0.45)] transition-all disabled:opacity-40 disabled:shadow-none ${
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
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${EDGE_PILL} text-text-muted shadow-lg transition-colors hover:text-text disabled:opacity-40`}
                >
                    <FastForward className="h-4 w-4" aria-hidden />
                </button>
            </div>
        </div>
    );
}
