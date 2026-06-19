import { useGameContext } from "~/hooks/useGameContext";
import { useSkipPhasePreferences } from "~/hooks/useSkipPhasePreferences";
import { isSkippablePhase } from "~/lib/skip-phase-prefs";
import { PHASE_GROUPS } from "~/lib/phase-labels";
import ControllerPhaseRow from "./controller-phase-row";

/** Full turn-structure list revealed by the pod's CTA (#331). Sized to its
 *  content (every phase visible), capped at the viewport height with internal
 *  scroll only past that. Phase names are centered between two stop-toggle
 *  columns headed YOU / OPP. The stop model is the live `useSkipPhasePreferences`
 *  — only its presentation moved out of the cramped left rail. */
export default function ControllerPhaseList({
    onClose,
}: {
    onClose: () => void;
}) {
    const { phase, turn } = useGameContext();
    const { prefs, toggle } = useSkipPhasePreferences();

    const order = PHASE_GROUPS.flatMap((g) => g.steps).map((s) => s.id);
    const currentIdx = order.indexOf(phase);

    return (
        <div
            role="dialog"
            aria-label="Turn phases"
            className="flex w-[248px] flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-[#0e1016]/95 shadow-2xl backdrop-blur-md"
            style={{ maxHeight: "calc(100vh - 24px)" }}
        >
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
                <span className="font-beleren text-xs text-amber-300">
                    Turn {turn} — Phases
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close phase list"
                    className="cursor-pointer text-sm text-white/50 hover:text-white/80"
                >
                    ✕
                </button>
            </div>

            <div className="flex items-center px-3 py-1 text-[8px] uppercase tracking-wider text-white/30">
                <span className="w-6 text-center">You</span>
                <span className="flex-1 pl-2">Stop on</span>
                <span className="w-6 text-center">Opp</span>
            </div>

            <div className="flex-1 overflow-y-auto pb-2">
                {PHASE_GROUPS.map((group) => (
                    <div key={group.label}>
                        <div className="px-3 pb-0.5 pt-2 text-[9px] uppercase tracking-wider text-white/40">
                            {group.label}
                        </div>
                        {group.steps.map((step) => {
                            const idx = order.indexOf(step.id);
                            return (
                                <ControllerPhaseRow
                                    key={step.id}
                                    phase={step.id}
                                    label={step.label}
                                    isCurrent={step.id === phase}
                                    isPast={currentIdx >= 0 && idx < currentIdx}
                                    skippable={isSkippablePhase(step.id)}
                                    prefs={prefs}
                                    onToggle={toggle}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
