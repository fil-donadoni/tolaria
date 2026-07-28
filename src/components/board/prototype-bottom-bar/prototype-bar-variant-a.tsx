import { useState } from "react";
import { ChevronUp, Heart, Menu } from "lucide-react";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { phaseGroupLabel, phaseLabel } from "~/lib/phase-labels";
import ControllerPhaseSheet from "../controller-phase-sheet";
import AttackAllConfirmDialog from "../attack-all-confirm-dialog";
import { splitControllerActions } from "./prototype-bar-actions";
import { usePrototypeSelfTarget } from "./use-prototype-self-target";

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  Variant A — "Steady grid". Three FIXED rows, nothing ever appears or
 *  disappears, so the bar never shifts:
 *
 *  1. info row — seat chip · fixed-width phase button (opens sheet) · own life
 *     pill · menu;
 *  2. contextual slot — reserved height ALWAYS; confirm/cancel/status actions
 *     render here, otherwise an inert hint keeps the space;
 *  3. main row — Pass and Pass Turn permanently mounted, disabled when the
 *     engine doesn't offer them. */
export default function PrototypeBarVariantA({
    me,
    onOpenMenu,
}: {
    me: Player;
    onOpenMenu: () => void;
}) {
    const { phase, turn, activePlayerId, playerId } = useGameContext();
    const { cue, actions, attackAllConfirm } = useControllerActions();
    const [sheetOpen, setSheetOpen] = useState(false);
    const isMyTurn = activePlayerId === playerId;
    const { pass, passTurn, contextual } = splitControllerActions(actions);
    const selfTarget = usePrototypeSelfTarget(me);

    return (
        <>
            <div
                data-controller-bottom-bar
                data-cue={cue}
                className={`fixed inset-x-0 bottom-0 z-40 flex flex-col gap-1.5 border-t bg-surface-base/95 px-2 pt-1.5 shadow-2xl backdrop-blur-md md:hidden ${
                    isMyTurn
                        ? "border-signal-self/60"
                        : "border-signal-opponent/40"
                }`}
                style={{
                    paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
                }}
            >
                {/* Row 1 — info. Every element fixed-size: no shift on phase change. */}
                <div className="flex h-10 items-stretch gap-1.5">
                    <span
                        className={`flex w-11 items-center justify-center rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                            isMyTurn
                                ? "bg-signal-self/20 text-signal-self-strong"
                                : "bg-signal-opponent/20 text-signal-opponent-strong"
                        }`}
                    >
                        {isMyTurn ? "You" : "Opp"}
                    </span>
                    <button
                        type="button"
                        onClick={() => setSheetOpen((v) => !v)}
                        aria-expanded={sheetOpen}
                        aria-label="Toggle phase list"
                        className="flex w-[9.5rem] flex-col justify-center rounded-lg bg-surface-elevated px-2.5 text-left"
                    >
                        <span className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-text-disabled">
                            T{turn} · {phaseGroupLabel(phase)}
                            <ChevronUp className="h-3 w-3" aria-hidden />
                        </span>
                        <span className="truncate font-beleren text-sm font-bold text-accent-strong">
                            {phaseLabel(phase)}
                        </span>
                    </button>
                    <div className="flex flex-1 items-center justify-end gap-1.5">
                        <button
                            type="button"
                            data-prototype-self-life
                            onClick={selfTarget.onClick}
                            className={`flex h-full items-center gap-1 rounded-lg border border-border-subtle bg-surface-elevated px-2.5 font-beleren text-base font-bold text-text ${selfTarget.ringClass}`}
                        >
                            <Heart
                                className="h-3.5 w-3.5 text-signal-self-strong"
                                aria-hidden
                            />
                            {me.life}
                        </button>
                        <button
                            type="button"
                            aria-label="Open game menu"
                            onClick={onOpenMenu}
                            className="flex h-full w-10 items-center justify-center rounded-lg bg-surface-elevated text-text-muted"
                        >
                            <Menu className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Row 2 — contextual slot. Height reserved even when empty. */}
                <div className="flex h-11 items-stretch gap-1.5">
                    {contextual.length > 0 ? (
                        contextual.map((a) =>
                            a.pill ? (
                                <span
                                    key={a.key}
                                    className="flex flex-1 items-center justify-center rounded-lg border border-border-accent/40 bg-surface-elevated text-xs font-beleren text-text-muted"
                                >
                                    {a.label}
                                </span>
                            ) : (
                                <button
                                    key={a.key}
                                    type="button"
                                    onClick={a.onClick}
                                    disabled={a.disabled}
                                    className={`flex-1 rounded-lg text-sm font-bold disabled:opacity-50 ${
                                        a.tone === "destructive"
                                            ? "bg-danger/20 text-danger"
                                            : "bg-accent text-surface-base"
                                    }`}
                                >
                                    {a.label}
                                </button>
                            )
                        )
                    ) : (
                        <span className="flex flex-1 items-center justify-center text-[10px] uppercase tracking-wider text-text-disabled">
                            {cue === "mine" ? "You have priority" : "Waiting…"}
                        </span>
                    )}
                </div>

                {/* Row 3 — Pass / Pass Turn, permanently mounted. */}
                <div className="grid h-12 grid-cols-2 gap-1.5">
                    <button
                        type="button"
                        onClick={pass?.onClick}
                        disabled={!pass || pass.disabled}
                        className="rounded-xl bg-accent font-beleren text-sm font-bold text-surface-base disabled:opacity-40"
                    >
                        Pass
                    </button>
                    <button
                        type="button"
                        onClick={passTurn?.onClick}
                        disabled={!passTurn || passTurn.disabled}
                        className="rounded-xl border border-danger/50 bg-danger/15 font-beleren text-sm font-bold text-danger disabled:opacity-40"
                    >
                        Pass Turn
                    </button>
                </div>
            </div>

            {sheetOpen && (
                <ControllerPhaseSheet onClose={() => setSheetOpen(false)} />
            )}
            <AttackAllConfirmDialog confirm={attackAllConfirm} />
        </>
    );
}
