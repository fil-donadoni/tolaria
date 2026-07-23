import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { phaseGroupLabel, phaseLabel } from "~/lib/phase-labels";
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
    const { cue, actions, attackAllConfirm } = useControllerActions();
    const [expanded, setExpanded] = useState(false);

    const isMyTurn = activePlayerId === playerId;

    return (
        // Right edge, above the viewer's bottom-right piles (variant H). It sits
        // below the center-right stack slot and never overlaps it. `bottom-32`
        // clears the pile row height in the corner.
        <div
            data-controller-pod
            className={`fixed bottom-32 right-4 z-hud flex w-52 flex-col gap-2 rounded-2xl border bg-surface-base p-2.5 shadow-2xl backdrop-blur-md ${
                isMyTurn
                    ? "border-signal-self/60 shadow-signal-self/10"
                    : "border-signal-opponent/40 shadow-signal-opponent/10"
            }`}
        >
            {/* Turn-ownership banner (#331 follow-up). The 8px "You/Opp" caption
             *  was too faint to read at a glance, so whose turn it is now reads
             *  as a full-width colored pill plus a matching pod border. */}
            <div
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    isMyTurn
                        ? "bg-signal-self/20 text-signal-self-strong"
                        : "bg-signal-opponent/20 text-signal-opponent-strong"
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
                className="flex items-center gap-2 rounded-xl bg-surface-elevated px-2.5 py-2 text-left hover:bg-surface-elevated cursor-pointer"
            >
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[8px] uppercase tracking-wider text-text-disabled">
                        T{turn} · {phaseGroupLabel(phase)}
                    </span>
                    <span className="truncate font-beleren text-sm font-bold text-accent-strong">
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
                                className="rounded-sm border border-border-accent/40 bg-surface-elevated px-3 py-2 text-center text-xs font-beleren tracking-wide text-text-muted shadow-md transition-colors hover:bg-surface-elevated disabled:cursor-default disabled:opacity-70"
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
