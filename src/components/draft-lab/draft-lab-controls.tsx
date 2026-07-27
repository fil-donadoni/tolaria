// Seed + Pack Source inputs, plus Start/Step/Auto-play controls (issue
// #1612: "generate a draft from an arbitrary seed" / "step and auto-play
// controls"). Pack Source options come from `listDraftableSets()` — the SAME
// live Draftability computation the real Limited Event creation flow uses —
// so the Lab can never offer a source the server would refuse to deal.
import { listDraftableSets } from "@convex/limited/registry";
import { CUBE_SOURCE_KEY, CUBE_DISPLAY_NAME } from "@convex/limited/cubeSource";
import type { DraftLabState } from "@/lib/limited/draftLabEngine";

function sourceLabel(setCode: string): string {
    return setCode === CUBE_SOURCE_KEY
        ? CUBE_DISPLAY_NAME
        : setCode.toUpperCase();
}

export default function DraftLabControls({
    seedInput,
    onSeedInputChange,
    sourceKey,
    onSourceKeyChange,
    state,
    isAutoPlaying,
    onStart,
    onStep,
    onToggleAutoPlay,
}: {
    seedInput: number;
    onSeedInputChange: (seed: number) => void;
    sourceKey: string;
    onSourceKeyChange: (key: string) => void;
    state: DraftLabState | null;
    isAutoPlaying: boolean;
    onStart: () => void;
    onStep: () => void;
    onToggleAutoPlay: () => void;
}) {
    const sources = listDraftableSets();
    const canStep = !!state && !state.completed && !isAutoPlaying;
    const canAutoPlay = !!state && !state.completed;

    return (
        <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
                Pack source
                <select
                    value={sourceKey}
                    onChange={(e) => onSourceKeyChange(e.target.value)}
                    className="rounded-sm border border-border-strong bg-surface-elevated px-2 py-1 text-sm text-text"
                >
                    {sources.map((s) => (
                        <option key={s.setCode} value={s.setCode}>
                            {sourceLabel(s.setCode)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
                Seed
                <input
                    type="number"
                    value={seedInput}
                    onChange={(e) => onSeedInputChange(Number(e.target.value))}
                    className="w-32 rounded-sm border border-border-strong bg-surface-elevated px-2 py-1 text-sm text-text"
                />
            </label>
            <button
                type="button"
                onClick={onStart}
                className="rounded-sm border border-border-strong px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-accent hover:text-parchment"
            >
                {state ? "Restart draft" : "Start draft"}
            </button>
            <button
                type="button"
                onClick={onStep}
                disabled={!canStep}
                className="rounded-sm border border-border-strong px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-accent hover:text-parchment disabled:opacity-40"
            >
                Step
            </button>
            <button
                type="button"
                onClick={onToggleAutoPlay}
                disabled={!canAutoPlay}
                className={`rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
                    isAutoPlaying
                        ? "border-accent text-accent-strong"
                        : "border-border-strong text-text-muted hover:border-accent hover:text-parchment"
                }`}
            >
                {isAutoPlaying ? "Pause" : "Auto-play"}
            </button>
            {state && (
                <span className="text-xs text-text-disabled">
                    {state.completed
                        ? `Draft complete — ${state.pickLog.length} picks`
                        : `Round ${state.draftRound + 1} · pick ${
                              state.pickLog.length + 1
                          }`}
                </span>
            )}
        </div>
    );
}
