// Seed + Pack Source inputs, plus Start/Step/Auto-play controls (issue
// #1612: "generate a draft from an arbitrary seed" / "step and auto-play
// controls"). Pack Source options come from `listDraftableSets()` — the SAME
// live Draftability computation the real Limited Event creation flow uses —
// so the Lab can never offer a source the server would refuse to deal.
//
// Draftable-only filter (issue #1612 fixup, pre-merge review): the real
// dialog (`create-limited-event-dialog.tsx#isSourceSelectable`) and the
// server (`limitedEvents.ts#createLimitedEvent`, via `isDraftableSet`) both
// gate on `draftable` — a set below the ≥80% coverage floor is listed by
// `listDraftableSets()` for INFORMATIONAL reasons (Incompleteness UI) but
// can't actually be dealt. Filtering here keeps that same golden-path
// invariant the file's own header already claims. Memoized (`useMemo`) since
// `listDraftableSets()` recomputes the Draftability sweep on every call and
// this component re-renders every `AUTO_PLAY_INTERVAL_MS` (350ms) during
// auto-play — the Booster Config catalogue doesn't change within a session,
// so there is nothing to recompute after the first render.
import { useMemo } from "react";
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
    canStart,
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
    /** False until the Card Profile query has resolved (issue #1611) — see
     *  `UseDraftLabResult.canStart`. Starting earlier would snapshot an empty
     *  profile set into the session and score the whole draft without the
     *  synergy terms. */
    canStart: boolean;
    onStart: () => void;
    onStep: () => void;
    onToggleAutoPlay: () => void;
}) {
    const sources = useMemo(
        () => listDraftableSets().filter((s) => s.draftable),
        []
    );
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
                disabled={!canStart}
                className="rounded-sm border border-border-strong px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-accent hover:text-parchment disabled:opacity-40"
            >
                {canStart
                    ? state
                        ? "Restart draft"
                        : "Start draft"
                    : "Loading profiles…"}
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
