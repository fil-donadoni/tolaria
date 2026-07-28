import { useState } from "react";
import { FastForward, Menu, MoreVertical } from "lucide-react";
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
 *  Variant B — "Morphing CTA" (Arena-like). ONE compact row: a square phase
 *  dial (opens the sheet), a single large primary call-to-action whose LABEL
 *  morphs (Pass → Confirm Attackers → Cancel Cast…) inside a fixed-size slot,
 *  an always-mounted Pass-Turn icon button, overflow "⋮" for extra contextual
 *  actions, and the menu. A thin life strip above the row shows both players'
 *  life with a glow on the priority side. Most vertical space returned to the
 *  board of any variant. */
export default function PrototypeBarVariantB({
    me,
    opponent,
    onOpenMenu,
}: {
    me: Player;
    opponent: Player | undefined;
    onOpenMenu: () => void;
}) {
    const { phase, turn, activePlayerId, playerId } = useGameContext();
    const { cue, actions, attackAllConfirm } = useControllerActions();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [overflowOpen, setOverflowOpen] = useState(false);
    const isMyTurn = activePlayerId === playerId;
    const { pass, passTurn, contextual } = splitControllerActions(actions);
    const selfTarget = usePrototypeSelfTarget(me);

    // Exactly one primary: first actionable contextual beats Pass; a status
    // pill (waiting / auto-pass) renders inert in the same slot.
    const primary = contextual.find((a) => !a.pill) ?? pass;
    const statusPill = !primary ? contextual.find((a) => a.pill) : undefined;
    const overflow = contextual.filter((a) => a !== primary && !a.pill);

    return (
        <>
            <div
                data-controller-bottom-bar
                data-cue={cue}
                className="fixed inset-x-0 bottom-0 z-40 flex flex-col md:hidden"
            >
                {/* Life strip — both players, priority glow side. */}
                <div className="mx-2 flex h-6 items-center justify-between rounded-t-lg bg-surface-base/80 px-3 text-xs font-bold backdrop-blur">
                    <span
                        className={
                            !isMyTurn
                                ? "text-signal-opponent-strong drop-shadow"
                                : "text-text-muted"
                        }
                    >
                        {opponent ? `${opponent.name} ${opponent.life}` : "—"}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-text-disabled">
                        T{turn} · {phaseGroupLabel(phase)}
                    </span>
                    <button
                        type="button"
                        data-prototype-self-life
                        onClick={selfTarget.onClick}
                        className={`rounded px-1 ${
                            isMyTurn
                                ? "text-signal-self-strong drop-shadow"
                                : "text-text-muted"
                        } ${selfTarget.ringClass}`}
                    >
                        {me.name} {me.life}
                    </button>
                </div>

                <div
                    className={`flex items-stretch gap-1.5 border-t bg-surface-base/95 p-1.5 backdrop-blur-md ${
                        isMyTurn
                            ? "border-signal-self/60"
                            : "border-signal-opponent/40"
                    }`}
                    style={{
                        paddingBottom:
                            "max(0.375rem, env(safe-area-inset-bottom))",
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setSheetOpen((v) => !v)}
                        aria-expanded={sheetOpen}
                        aria-label="Toggle phase list"
                        className="flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-surface-elevated"
                    >
                        <span className="text-[8px] uppercase text-text-disabled">
                            T{turn}
                        </span>
                        <span className="truncate px-1 font-beleren text-[10px] font-bold text-accent-strong">
                            {phaseLabel(phase)}
                        </span>
                    </button>

                    {statusPill ? (
                        <span className="flex h-14 flex-1 items-center justify-center rounded-xl border border-border-accent/40 bg-surface-elevated font-beleren text-sm text-text-muted">
                            {statusPill.label}
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={primary?.onClick}
                            disabled={!primary || primary.disabled}
                            className={`h-14 flex-1 rounded-xl font-beleren text-base font-bold disabled:opacity-40 ${
                                primary?.tone === "destructive"
                                    ? "bg-danger/20 text-danger"
                                    : "bg-accent text-surface-base"
                            }`}
                        >
                            {primary?.label ?? "Pass"}
                        </button>
                    )}

                    {overflow.length > 0 && (
                        <button
                            type="button"
                            aria-label="More actions"
                            onClick={() => setOverflowOpen((v) => !v)}
                            className="flex h-14 w-10 items-center justify-center rounded-xl bg-surface-elevated text-text-muted"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                    )}

                    <button
                        type="button"
                        aria-label="Pass Turn"
                        onClick={passTurn?.onClick}
                        disabled={!passTurn || passTurn.disabled}
                        className="flex h-14 w-12 flex-col items-center justify-center rounded-xl border border-danger/40 bg-danger/10 text-danger disabled:opacity-40"
                    >
                        <FastForward className="h-4 w-4" />
                        <span className="text-[8px] font-bold uppercase">
                            Turn
                        </span>
                    </button>

                    <button
                        type="button"
                        aria-label="Open game menu"
                        onClick={onOpenMenu}
                        className="flex h-14 w-10 items-center justify-center rounded-xl bg-surface-elevated text-text-muted"
                    >
                        <Menu className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {overflowOpen && overflow.length > 0 && (
                <div className="fixed bottom-24 right-2 z-50 flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface-base p-1.5 shadow-2xl">
                    {overflow.map((a) => (
                        <button
                            key={a.key}
                            type="button"
                            onClick={() => {
                                setOverflowOpen(false);
                                a.onClick();
                            }}
                            disabled={a.disabled}
                            className={`rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${
                                a.tone === "destructive"
                                    ? "bg-danger/20 text-danger"
                                    : "bg-surface-elevated text-text"
                            }`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            {sheetOpen && (
                <ControllerPhaseSheet onClose={() => setSheetOpen(false)} />
            )}
            <AttackAllConfirmDialog confirm={attackAllConfirm} />
        </>
    );
}
