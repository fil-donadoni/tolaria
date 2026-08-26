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
    showCompactDecoder = false,
}: {
    onClose: () => void;
    /** Forwarded to every {@link ControllerPhaseRow} — see its doc comment.
     *  Defaults off (the desktop pod's panel, and any other bare mount of
     *  this list, has no compact tab to decode); `ControllerPhaseSheet` is
     *  the sole caller that turns it on (#1860 review round 3, finding 2). */
    showCompactDecoder?: boolean;
}) {
    const { phase, turn } = useGameContext();
    const { prefs, toggle } = useSkipPhasePreferences();

    const order = PHASE_GROUPS.flatMap((g) => g.steps).map((s) => s.id);
    const currentIdx = order.indexOf(phase);

    return (
        <div
            role="dialog"
            aria-label="Turn phases"
            className="flex w-[248px] flex-col overflow-hidden rounded-[var(--panel-radius)] border border-[var(--hairline)] bg-surface shadow-2xl backdrop-blur-md"
            style={{ maxHeight: "calc(100dvh - 24px)" }}
        >
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-2">
                <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-text-muted">
                    Turn {turn} — Phases
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close phase list"
                    className="cursor-pointer text-sm text-text-muted hover:text-text"
                >
                    ✕
                </button>
            </div>

            {/* Column heads aligned to the rows below: a YOU head over the
             *  left stop column, the centered "Stop on" caption over the phase
             *  names, and an OPP head over the right stop column. Same
             *  `gap-2 px-3` + `w-6` gutters as ControllerPhaseRow so the heads
             *  sit directly above their dots. */}
            <div className="flex items-center gap-2 px-3 py-1 text-[8px] uppercase tracking-wider text-text-disabled">
                <span className="w-6 text-center">You</span>
                <span className="flex-1 text-center">Stop on</span>
                <span className="w-6 text-center">Opp</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {PHASE_GROUPS.map((group) => (
                    <div key={group.label}>
                        <div className="px-3 pb-0.5 pt-2 text-[9px] uppercase tracking-wider text-text-disabled">
                            {group.label}
                        </div>
                        {group.steps.map((step) => {
                            const idx = order.indexOf(step.id);
                            return (
                                <ControllerPhaseRow
                                    key={step.id}
                                    phase={step.id}
                                    label={step.label}
                                    compact={step.compact}
                                    isCurrent={step.id === phase}
                                    isPast={currentIdx >= 0 && idx < currentIdx}
                                    skippable={isSkippablePhase(step.id)}
                                    prefs={prefs}
                                    onToggle={toggle}
                                    showCompactDecoder={showCompactDecoder}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
