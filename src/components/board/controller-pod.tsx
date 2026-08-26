import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActionsSource } from "~/hooks/controllerActionsContext";
import { phaseGroupLabel, phaseLabel } from "~/lib/phase-labels";
import { V4_EYEBROW, V4_PLATE } from "~/lib/board-chrome-v4";
import ActionButton from "./action-button";
import ControllerCueBadge from "./controller-cue-badge";
import ControllerPhasePanel from "./controller-phase-panel";
import HotkeysLegend from "./hotkeys-legend";
import PauseMenuButton from "./pause-menu-button";
import AttackAllConfirmDialog from "./attack-all-confirm-dialog";

/** Collapsed controller pod (#331, variant H). Replaces the old left phase
 *  rail + bottom-right action bar with ONE surface docked to the board's right
 *  edge, ABOVE the viewer's piles. Collapsed it shows: the current phase/step
 *  in plain language, an unmistakable priority cue, and the action button(s)
 *  for the current step. A CTA reveals the full phase list (with per-phase
 *  stops). It reuses the priority helpers and dispatches the SAME mutations as
 *  the old action bar (`useControllerActions`) — view-layer only, no GRE
 *  changes. Keyboard shortcuts (Space/Enter/U) are wired in that hook. */
export default function ControllerPod({
    onOpenMenu,
}: {
    onOpenMenu: () => void;
}) {
    const { phase, turn, activePlayerId, playerId } = useGameContext();
    // Injected descriptor source (#2167): defaults to `useControllerActions`
    // absent a provider. One call, at a stable position — the pod is the ONE
    // controller layout `controller.tsx` mounted this render.
    const useControllerState = useControllerActionsSource();
    const { cue, actions, attackAllConfirm } = useControllerState();
    const [expanded, setExpanded] = useState(false);

    const isMyTurn = activePlayerId === playerId;

    return (
        // Right edge, above the viewer's bottom-right piles (variant H). It sits
        // below the center-right stack slot and never overlaps it. `bottom-32`
        // clears the pile row height in the corner.
        <div
            data-controller-pod
            // v4 (ADR 0103 §5, issue #2727): a HAIRLINE plate, not a heavy
            // rounded box with a seat-coloured frame. The turn-ownership
            // signal moves to the strip below and to the pill inside — the
            // frame itself is quiet, which is the whole register. The pod is a
            // panel, not a control, so it genuinely takes the decorative
            // `--hairline` pair; the BUTTONS inside it do not (round-2 review).
            className={`fixed bottom-32 right-4 z-hud flex w-52 flex-col gap-2 ${V4_PLATE} p-2.5 shadow-2xl`}
        >
            {/* Turn-ownership banner (#331 follow-up). The 8px "You/Opp" caption
             *  was too faint to read at a glance, so whose turn it is now reads
             *  as a full-width colored pill plus a matching pod border. */}
            <div
                data-controller-turn-strip
                className={`flex items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    isMyTurn
                        ? "bg-signal-self/15 text-signal-self-strong"
                        : "bg-signal-opponent/15 text-signal-opponent-strong"
                }`}
            >
                <span
                    className={`h-1.5 w-1.5 rounded-full ${
                        isMyTurn ? "bg-signal-self" : "bg-signal-opponent"
                    }`}
                    aria-hidden
                />
                {isMyTurn ? "Your turn" : "Opponent's turn"}
            </div>

            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-label="Toggle phase list"
                className="flex cursor-pointer items-center gap-2 rounded-sm border border-border-strong bg-surface-elevated px-2.5 py-2 text-left transition-colors hover:border-accent/60"
            >
                {/* Eyebrow TURN over the display-face phase (ADR 0103 §4):
                    the small uppercase label says which turn and which group,
                    the big Geist line says the step the player is in. */}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={V4_EYEBROW}>
                        T{turn} · {phaseGroupLabel(phase)}
                    </span>
                    <span className="truncate text-display text-base text-text">
                        {phaseLabel(phase)}
                    </span>
                </div>
                <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 text-text-disabled transition-transform ${
                        expanded ? "rotate-90" : ""
                    }`}
                    aria-hidden
                />
            </button>

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

            <div className="flex items-center justify-end gap-2">
                <HotkeysLegend />
                <PauseMenuButton onOpen={onOpenMenu} />
            </div>

            {expanded && (
                <ControllerPhasePanel onClose={() => setExpanded(false)} />
            )}

            <AttackAllConfirmDialog confirm={attackAllConfirm} />
        </div>
    );
}
