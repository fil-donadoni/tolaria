import { useState } from "react";
import { Heart, Layers, Menu, Flag } from "lucide-react";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { phaseLabel } from "~/lib/phase-labels";
import ControllerPhaseSheet from "../controller-phase-sheet";
import AttackAllConfirmDialog from "../attack-all-confirm-dialog";
import { splitControllerActions, zoneCount } from "./prototype-bar-actions";
import { usePrototypeSelfTarget } from "./use-prototype-self-target";

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  Variant C — "Tab bar + action strip". Bottom edge is a classic mobile app
 *  tab bar: You (life) · Zones (GY/LIB/EXL/Stack counts drawer) · Phase ·
 *  Menu. ABOVE it a persistent action strip renders Pass + Pass Turn always
 *  (disabled when unavailable) with contextual actions appended inline. The
 *  Zones drawer is read-only in the prototype — it answers "where do the
 *  unreachable chips live in this model", not "how do piles open". */
export default function PrototypeBarVariantC({
    me,
    onOpenMenu,
}: {
    me: Player;
    onOpenMenu: () => void;
}) {
    const { activePlayerId, playerId, stackCount, phase, turn } =
        useGameContext();
    const { cue, actions, attackAllConfirm } = useControllerActions();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [zonesOpen, setZonesOpen] = useState(false);
    const isMyTurn = activePlayerId === playerId;
    const { pass, passTurn, contextual } = splitControllerActions(actions);
    const selfTarget = usePrototypeSelfTarget(me);

    const zones: { label: string; count: number }[] = [
        { label: "GY", count: zoneCount(me.graveyard) },
        { label: "LIB", count: zoneCount(me.library) },
        { label: "EXL", count: zoneCount(me.exile) },
        { label: "STACK", count: stackCount },
    ];

    return (
        <>
            <div
                data-controller-bottom-bar
                data-cue={cue}
                className="fixed inset-x-0 bottom-0 z-40 flex flex-col md:hidden"
            >
                {/* Action strip — Pass / Pass Turn always mounted, contextual appended. */}
                <div className="mx-2 mb-1 flex h-12 items-stretch gap-1.5 overflow-x-auto">
                    <button
                        type="button"
                        onClick={pass?.onClick}
                        disabled={!pass || pass.disabled}
                        className="min-w-[5.5rem] flex-1 rounded-xl bg-accent font-beleren text-sm font-bold text-surface-base shadow-lg disabled:opacity-40"
                    >
                        Pass
                    </button>
                    <button
                        type="button"
                        onClick={passTurn?.onClick}
                        disabled={!passTurn || passTurn.disabled}
                        className="min-w-[5.5rem] flex-1 rounded-xl border border-danger/50 bg-danger/15 font-beleren text-sm font-bold text-danger shadow-lg disabled:opacity-40"
                    >
                        Pass Turn
                    </button>
                    {contextual.map((a) =>
                        a.pill ? (
                            <span
                                key={a.key}
                                className="flex min-w-[7rem] flex-1 items-center justify-center rounded-xl border border-border-accent/40 bg-surface-elevated px-2 text-center text-xs font-beleren text-text-muted"
                            >
                                {a.label}
                            </span>
                        ) : (
                            <button
                                key={a.key}
                                type="button"
                                onClick={a.onClick}
                                disabled={a.disabled}
                                className={`min-w-[7rem] flex-1 rounded-xl px-2 text-sm font-bold shadow-lg disabled:opacity-50 ${
                                    a.tone === "destructive"
                                        ? "bg-danger/20 text-danger"
                                        : "bg-surface-elevated text-text"
                                }`}
                            >
                                {a.label}
                            </button>
                        )
                    )}
                </div>

                {/* App tab bar. */}
                <div
                    className={`grid grid-cols-4 border-t bg-surface-base/95 backdrop-blur-md ${
                        isMyTurn
                            ? "border-signal-self/60"
                            : "border-signal-opponent/40"
                    }`}
                    style={{
                        paddingBottom: "env(safe-area-inset-bottom)",
                    }}
                >
                    <button
                        type="button"
                        data-prototype-self-life
                        onClick={selfTarget.onClick}
                        className={`flex h-14 flex-col items-center justify-center gap-0.5 ${selfTarget.ringClass}`}
                    >
                        <span className="flex items-center gap-1 font-beleren text-base font-bold text-text">
                            <Heart
                                className="h-3.5 w-3.5 text-signal-self-strong"
                                aria-hidden
                            />
                            {me.life}
                        </span>
                        <span className="text-[8px] uppercase tracking-wider text-text-disabled">
                            {isMyTurn ? "Your turn" : "Their turn"}
                        </span>
                    </button>
                    <button
                        type="button"
                        aria-expanded={zonesOpen}
                        onClick={() => setZonesOpen((v) => !v)}
                        className={`flex h-14 flex-col items-center justify-center gap-0.5 ${
                            zonesOpen ? "text-accent-strong" : "text-text-muted"
                        }`}
                    >
                        <Layers className="h-4 w-4" />
                        <span className="text-[8px] uppercase tracking-wider">
                            Zones{stackCount > 0 ? ` · ${stackCount}` : ""}
                        </span>
                    </button>
                    <button
                        type="button"
                        aria-expanded={sheetOpen}
                        aria-label="Toggle phase list"
                        onClick={() => setSheetOpen((v) => !v)}
                        className="flex h-14 flex-col items-center justify-center gap-0.5 text-text-muted"
                    >
                        <Flag className="h-4 w-4" />
                        <span className="max-w-[5.5rem] truncate text-[8px] uppercase tracking-wider">
                            T{turn} {phaseLabel(phase)}
                        </span>
                    </button>
                    <button
                        type="button"
                        aria-label="Open game menu"
                        onClick={onOpenMenu}
                        className="flex h-14 flex-col items-center justify-center gap-0.5 text-text-muted"
                    >
                        <Menu className="h-4 w-4" />
                        <span className="text-[8px] uppercase tracking-wider">
                            Menu
                        </span>
                    </button>
                </div>
            </div>

            {/* Read-only zones drawer (prototype). */}
            {zonesOpen && (
                <div className="fixed bottom-32 left-2 right-2 z-50 flex items-stretch gap-1.5 rounded-xl border border-border-subtle bg-surface-base p-2 shadow-2xl">
                    {zones.map((z) => (
                        <span
                            key={z.label}
                            className="flex flex-1 flex-col items-center rounded-lg bg-surface-elevated py-2"
                        >
                            <span className="font-beleren text-base font-bold text-text">
                                {z.count}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-text-disabled">
                                {z.label}
                            </span>
                        </span>
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
