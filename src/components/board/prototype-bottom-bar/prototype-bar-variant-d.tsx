import { useState } from "react";
import { FastForward, Flag, Heart, Layers, Menu } from "lucide-react";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { phaseGroupLabel } from "~/lib/phase-labels";
import ControllerPhaseSheet from "../controller-phase-sheet";
import AttackAllConfirmDialog from "../attack-all-confirm-dialog";
import { splitControllerActions, zoneCount } from "./prototype-bar-actions";
import { usePrototypeSelfTarget } from "./use-prototype-self-target";

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  Variant D — "Refined fusion" (B + C after user feedback). C's app tab bar
 *  owns the bottom edge (You · Zones · Phase · Menu — life always visible,
 *  phase reachable), B's single morphing CTA owns the command row above it —
 *  but compact: h-11 rounded-full pills instead of the h-12/h-14 slabs the
 *  user called out as ugly/oversized. Priority is a 2px gradient hairline on
 *  the top edge instead of a chunky colored border; the whole bar sits on a
 *  blurred gradient so the board reads through it. */
export default function PrototypeBarVariantD({
    me,
    opponent,
    onOpenMenu,
}: {
    me: Player;
    opponent: Player | undefined;
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

    // Arena model: ONE morphing primary (first actionable contextual beats
    // Pass) in a fixed slot; remaining contextual render as small side pills.
    const primary = contextual.find((a) => !a.pill) ?? pass;
    const statusPill = contextual.find((a) => a.pill);
    const secondary = contextual.filter((a) => a !== primary && !a.pill);

    const zones: { label: string; count: number }[] = [
        { label: "Graveyard", count: zoneCount(me.graveyard) },
        { label: "Library", count: zoneCount(me.library) },
        { label: "Exile", count: zoneCount(me.exile) },
        { label: "Stack", count: stackCount },
    ];

    const tab =
        "flex h-[3.25rem] flex-col items-center justify-center gap-0.5 transition-colors";
    const tabLabel = "text-[9px] font-medium uppercase tracking-[0.14em]";

    return (
        <>
            <div
                data-controller-bottom-bar
                data-cue={cue}
                className="fixed inset-x-0 bottom-0 z-40 flex flex-col md:hidden"
            >
                {/* Command row — floats over the board, no opaque band. */}
                <div className="mx-3 mb-2 flex items-center justify-center gap-2">
                    {secondary.map((a) => (
                        <button
                            key={a.key}
                            type="button"
                            onClick={a.onClick}
                            disabled={a.disabled}
                            className={`h-9 rounded-full border px-4 text-xs font-semibold shadow-lg backdrop-blur-md transition-opacity disabled:opacity-40 ${
                                a.tone === "destructive"
                                    ? "border-danger/50 bg-surface-base/85 text-danger-strong"
                                    : "border-border-accent/50 bg-surface-base/85 text-accent-strong"
                            }`}
                        >
                            {a.label}
                        </button>
                    ))}
                    {statusPill && !primary ? (
                        <span className="flex h-11 min-w-[11rem] items-center justify-center rounded-full border border-border-subtle bg-surface-base/85 px-6 font-beleren text-sm tracking-wide text-text-muted shadow-lg backdrop-blur-md">
                            {statusPill.label}
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={primary?.onClick}
                            disabled={!primary || primary.disabled}
                            className={`h-11 min-w-[11rem] rounded-full px-6 font-beleren text-sm font-bold tracking-wide shadow-[0_4px_18px_rgba(0,0,0,0.45)] transition-all disabled:opacity-40 disabled:shadow-none ${
                                primary?.tone === "destructive"
                                    ? "border border-danger/60 bg-surface-base/90 text-danger-strong backdrop-blur-md"
                                    : "bg-gradient-to-b from-accent-strong to-accent text-surface-base shadow-[0_4px_18px_rgba(201,162,75,0.35)]"
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
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-danger/40 bg-surface-base/85 text-danger-strong shadow-lg backdrop-blur-md disabled:opacity-40"
                    >
                        <FastForward className="h-4 w-4" />
                    </button>
                </div>

                {/* Priority hairline + tab bar. */}
                <div
                    className={`h-0.5 bg-gradient-to-r from-transparent to-transparent ${
                        isMyTurn
                            ? "via-signal-self"
                            : "via-signal-opponent/70"
                    }`}
                />
                <div
                    className="grid grid-cols-4 bg-gradient-to-t from-surface-base to-surface-base/85 backdrop-blur-xl"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                    <button
                        type="button"
                        data-prototype-self-life
                        onClick={selfTarget.onClick}
                        className={`${tab} ${selfTarget.ringClass}`}
                    >
                        <span className="flex items-baseline gap-1 font-beleren text-lg font-bold leading-none text-text">
                            <Heart
                                className={`h-3 w-3 self-center ${
                                    isMyTurn
                                        ? "text-signal-self-strong"
                                        : "text-text-disabled"
                                }`}
                                aria-hidden
                            />
                            {me.life}
                        </span>
                        <span className={`${tabLabel} text-text-disabled`}>
                            {opponent ? `vs ${opponent.life}` : "You"}
                        </span>
                    </button>
                    <button
                        type="button"
                        aria-expanded={zonesOpen}
                        onClick={() => setZonesOpen((v) => !v)}
                        className={`${tab} ${
                            zonesOpen ? "text-accent-strong" : "text-text-muted"
                        }`}
                    >
                        <Layers className="h-[1.1rem] w-[1.1rem]" />
                        <span className={tabLabel}>
                            Zones{stackCount > 0 ? ` · ${stackCount}` : ""}
                        </span>
                    </button>
                    <button
                        type="button"
                        aria-expanded={sheetOpen}
                        aria-label="Toggle phase list"
                        onClick={() => setSheetOpen((v) => !v)}
                        className={`${tab} ${
                            sheetOpen ? "text-accent-strong" : "text-text-muted"
                        }`}
                    >
                        <Flag className="h-[1.1rem] w-[1.1rem]" />
                        <span className={`${tabLabel} max-w-[5.5rem] truncate`}>
                            T{turn} · {phaseGroupLabel(phase)}
                        </span>
                    </button>
                    <button
                        type="button"
                        aria-label="Open game menu"
                        onClick={onOpenMenu}
                        className={`${tab} text-text-muted`}
                    >
                        <Menu className="h-[1.1rem] w-[1.1rem]" />
                        <span className={tabLabel}>Menu</span>
                    </button>
                </div>
            </div>

            {/* Read-only zones drawer (prototype). */}
            {zonesOpen && (
                <div className="fixed bottom-32 left-3 right-3 z-50 grid grid-cols-4 gap-1.5 rounded-2xl border border-border-subtle bg-surface-base/95 p-2 shadow-2xl backdrop-blur-xl">
                    {zones.map((z) => (
                        <span
                            key={z.label}
                            className="flex flex-col items-center rounded-xl bg-surface-elevated/80 py-2.5"
                        >
                            <span className="font-beleren text-lg font-bold leading-none text-text">
                                {z.count}
                            </span>
                            <span className="mt-1 text-[8px] uppercase tracking-[0.14em] text-text-disabled">
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
