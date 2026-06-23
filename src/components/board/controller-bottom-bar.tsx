import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { phaseGroupLabel, phaseLabel } from "~/lib/phase-labels";
import ActionButton from "./action-button";
import ControllerPhaseSheet from "./controller-phase-sheet";
import PauseMenuButton from "./pause-menu-button";

/** Portrait controller (#335). On a narrow portrait viewport the desktop
 *  right-edge pod collapses to this FIXED BOTTOM ACTION BAR: a current-phase
 *  chip (taps open the full phase list as a bottom sheet) plus a full-width,
 *  thumb-reachable primary action button. The whole right control column goes
 *  away so the battlefield uses the full screen width (the battlefield drops its
 *  right gutter to 0 off the SAME `useIsPortrait` seam).
 *
 *  It is a pure presentation fork: it reads the SAME `useControllerActions`
 *  descriptors the desktop pod renders, so every button dispatches the IDENTICAL
 *  mutation with the same args, and the phase sheet reuses the SAME stop-toggle
 *  path (`useSkipPhasePreferences`). No GRE changes — view-layer only. */
export default function ControllerBottomBar({
    onOpenMenu,
}: {
    onOpenMenu: () => void;
}) {
    const { phase, turn, activePlayerId, playerId } = useGameContext();
    const { cue, actions } = useControllerActions();
    const [sheetOpen, setSheetOpen] = useState(false);

    const isMyTurn = activePlayerId === playerId;

    // The bar leads with the call-to-action for the current step; any remaining
    // actions (e.g. "Pass Turn" alongside "Pass") stack on a secondary row. Both
    // come from the same ordered `actions` array, so the wiring is untouched.
    const [primary, ...rest] = actions;

    return (
        <>
            <div
                data-controller-bottom-bar
                data-cue={cue}
                className={`fixed inset-x-2 bottom-2 z-40 flex flex-col gap-2 rounded-2xl border bg-surface-base p-2 shadow-2xl backdrop-blur-md md:hidden ${
                    isMyTurn ? "border-emerald-500/60" : "border-rose-500/40"
                }`}
            >
                <div className="flex items-stretch gap-2">
                    <span
                        className={`flex items-center rounded-lg px-2 text-[11px] font-bold uppercase tracking-wider ${
                            isMyTurn
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-rose-500/20 text-rose-300"
                        }`}
                    >
                        {isMyTurn ? "You" : "Opp"}
                    </span>
                    <button
                        type="button"
                        onClick={() => setSheetOpen((v) => !v)}
                        aria-expanded={sheetOpen}
                        aria-label="Toggle phase list"
                        className="flex min-w-[88px] flex-col justify-center rounded-xl bg-surface-elevated px-3 py-2 text-left active:bg-surface-elevated"
                    >
                        <span className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-text-disabled">
                            T{turn} · {phaseGroupLabel(phase)}
                            <ChevronUp className="h-3 w-3" aria-hidden />
                        </span>
                        <span className="truncate font-beleren text-sm font-bold text-accent-strong">
                            {phaseLabel(phase)}
                        </span>
                    </button>

                    <PauseMenuButton onOpen={onOpenMenu} />

                    {primary &&
                        (primary.pill ? (
                            <button
                                type="button"
                                onClick={primary.onClick}
                                disabled={primary.disabled}
                                className="flex flex-1 items-center justify-center rounded-xl border border-border-accent/40 bg-surface-elevated px-3 text-center text-xs font-beleren tracking-wide text-text-muted disabled:opacity-70"
                                style={{ minHeight: 48 }}
                            >
                                {primary.label}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={primary.onClick}
                                disabled={primary.disabled}
                                className={`flex-1 rounded-xl px-3 font-beleren text-sm font-bold ${
                                    primary.tone === "destructive"
                                        ? "btn-tone-destructive"
                                        : "btn-tone-primary"
                                } ${primary.disabled ? "btn-disabled" : ""}`}
                                style={{ minHeight: 48 }}
                            >
                                {primary.label}
                            </button>
                        ))}
                </div>

                {rest.length > 0 && (
                    <div className="flex items-stretch gap-2">
                        {rest.map((action) => (
                            <div key={action.key} className="flex-1">
                                <ActionButton
                                    onClick={action.onClick}
                                    label={action.label}
                                    tone={action.tone}
                                    disabled={action.disabled}
                                    shortcut={action.shortcut}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {sheetOpen && (
                <ControllerPhaseSheet onClose={() => setSheetOpen(false)} />
            )}
        </>
    );
}
