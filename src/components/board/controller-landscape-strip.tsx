import { useState } from "react";
import { Flag, Menu } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { useControllerStripWidth } from "~/hooks/useControllerStripWidth";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import { phaseGroupLabel } from "~/lib/phase-labels";
import ControllerStripCommandStack from "./controller-strip-command-stack";
import ControllerPhasePanel from "./controller-phase-panel";
import AttackAllConfirmDialog from "./attack-all-confirm-dialog";

/** Landscape-compact controller (#335 seam, #1758/#1769): a THIN control strip
 *  docked to the board's right edge, replacing the desktop pod on a phone held
 *  sideways.
 *
 *  **Why the right edge and not the bottom.** A landscape phone is wide
 *  (667–932px) but very short (320–450px of usable height, the
 *  `landscape-compact` discriminator in {@link useViewportMode}). HEIGHT is the
 *  scarce dimension, so the controls spend the plentiful one: portrait owns the
 *  bottom edge, landscape owns the right edge, and each mode protects its own
 *  scarce axis. It also keeps continuity with the desktop pod, which already
 *  docks right — landscape is the reduced desktop, not a rotated portrait.
 *
 *  **What it replaces.** {@link ControllerPod} is ~13rem wide and stacks a turn
 *  banner, an oversized two-line phase box, a cue badge, one full-size button
 *  per action, and a hotkeys legend — roughly 200px of vertical content pinned
 *  128px off the bottom, which simply does not fit a 320px-tall viewport, and
 *  eats the board while it overflows. The strip keeps only what a touch player
 *  needs and borrows the variant-D idioms from the portrait bar (#1759):
 *
 *  - a fixed-width phase label (`T3 · Combat`) that OPENS the phase surface
 *    rather than spelling the step out inline — the step name is what made the
 *    pod's phase box oversized;
 *  - ONE morphing primary CTA in a fixed slot, plus an always-mounted Pass Turn
 *    that greys out instead of unmounting ({@link selectCommandSlots} — the
 *    SAME morphing rule the portrait bar uses, not a second copy);
 *  - priority as a 2px gradient hairline rather than a coloured slab + banner;
 *  - no hotkeys legend (there is no keyboard on the device this mode targets).
 *
 *  **Phase surface: the panel, not the sheet.** {@link ControllerPhaseSheet} is
 *  the portrait surface and is hard-gated `md:hidden`; a landscape phone is
 *  ≥768px WIDE, so the sheet would render invisible here. Lifting that gate is
 *  the wrong fix anyway — a bottom sheet is `max-h-[70vh]`, i.e. ~70% of the one
 *  dimension this mode is short of. {@link ControllerPhasePanel} is already the
 *  right shape: right-edge, vertically centred, non-modal (the board stays live
 *  behind it), and its list is capped at `100vh - 24px` with internal scroll, so
 *  it fits a 320px-tall viewport unchanged. It anchors BESIDE the strip via the
 *  published `--controller-strip-w` seam, so neither surface hard-codes the
 *  other's size.
 *
 *  It stays a pure presentation fork: it reads the SAME `useControllerActions`
 *  descriptors, so every control dispatches the IDENTICAL mutation, and the
 *  phase panel reuses the SAME `useSkipPhasePreferences` stop-toggle path.
 *  Exactly one of pod / bar / strip mounts (the #335 seam), so the hook — and
 *  its keyboard-shortcut effect — never doubles. No GRE changes. */
export default function ControllerLandscapeStrip({
    onOpenMenu,
}: {
    onOpenMenu: () => void;
}) {
    const { phase, turn, activePlayerId, playerId } = useGameContext();
    const { actions, attackAllConfirm } = useControllerActions();
    const [panelOpen, setPanelOpen] = useState(false);
    // The strip publishes the width it MEASURES; the phase panel (and, later,
    // the landscape board layout #1768) anchor to that rather than to a
    // hard-coded inset. See controller-bar-metrics.ts.
    const stripRef = useControllerStripWidth<HTMLDivElement>();

    const isMyTurn = activePlayerId === playerId;
    const slots = selectCommandSlots(actions);

    return (
        <>
            <div
                ref={stripRef}
                data-controller-landscape-strip
                className="fixed right-2 top-1/2 z-hud flex w-40 -translate-y-1/2 flex-col gap-1.5"
            >
                {/* Priority hairline — the whole priority signal, 2px wide.
                    Absolutely positioned so it can never change the strip's
                    own measured width, which the panel anchors to. */}
                <div
                    data-controller-priority-hairline
                    className={`pointer-events-none absolute inset-y-2 -left-1.5 w-0.5 rounded-full bg-gradient-to-b from-transparent to-transparent ${
                        isMyTurn ? "via-signal-self" : "via-signal-opponent/70"
                    }`}
                />

                {/* Fixed-width phase label. `T<n> · <group>` only — the step
                    name varies in width and lives inside the panel, so this
                    row can never resize the strip. */}
                {/* `h-11`/`w-11` (44px, #1770 mobile QA sweep): both were
                    `h-9`/`w-9` (36px), below the touch-target floor. */}
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setPanelOpen((v) => !v)}
                        aria-label="Toggle phase list"
                        aria-expanded={panelOpen}
                        className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-border-subtle bg-surface-base/85 px-2 text-[11px] font-semibold shadow-lg backdrop-blur-md transition-colors ${
                            panelOpen ? "text-accent-strong" : "text-text-muted"
                        }`}
                    >
                        <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                            T{turn} · {phaseGroupLabel(phase)}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={onOpenMenu}
                        aria-label="Open game menu"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-accent/40 bg-surface-base/85 text-text-muted shadow-lg backdrop-blur-md transition-colors hover:text-text"
                    >
                        <Menu className="h-4 w-4" aria-hidden />
                    </button>
                </div>

                <ControllerStripCommandStack slots={slots} />
            </div>

            {panelOpen && (
                <ControllerPhasePanel onClose={() => setPanelOpen(false)} />
            )}

            <AttackAllConfirmDialog confirm={attackAllConfirm} />
        </>
    );
}
