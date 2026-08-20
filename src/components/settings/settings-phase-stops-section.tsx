import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { useSkipPhasePrefsState } from "~/hooks/useSkipPhasePreferences";
import { isSkippablePhase } from "~/lib/skip-phase-prefs";
import { PHASE_GROUPS } from "~/lib/phase-labels";
import ControllerPhaseRow from "~/components/board/controller-phase-row";

/**
 * Phase stops Settings section (issue #2595). **Not a second store.** The
 * board pod's phase list (`ControllerPhaseList`) reads/writes phase stops
 * through `useSkipPhasePreferences()` (a Context consumer) backed by
 * `useSkipPhasePrefsState()` — the stateful half that lazily inits from
 * `loadSkipPrefs()` and persists every toggle via `saveSkipPrefs()`
 * (`localStorage["tolaria:skipPhasePrefs:v1"]`, `src/lib/skip-phase-prefs.ts`).
 * There is no Provider on the Settings route (no board is mounted here), so
 * this section calls `useSkipPhasePrefsState()` directly instead of going
 * through the Context — a SEPARATE React instance, but the SAME underlying
 * persisted store: same key, same `loadSkipPrefs`/`saveSkipPrefs`/
 * `togglePhaseStop` helpers, same cross-tab `storage` listener. `board.tsx`
 * and `manual-board-view.tsx` already do exactly this (two independent
 * `useSkipPhasePrefsState()` mounts unified only by the shared localStorage
 * key) — this is a third mount of that same pattern, not a new one.
 *
 * Renders the exact `ControllerPhaseRow` the board pod's phase list uses
 * (`ControllerPhaseList`, `src/components/board/controller-phase-list.tsx`)
 * for every phase in `PHASE_GROUPS`, with `isCurrent`/`isPast` both false
 * (there is no active game on this route) — so a stop toggled here is
 * pixel-for-pixel and behaviour-for-behaviour the same control the board
 * pod shows, not a re-implementation that could drift from it.
 */
export default function SettingsPhaseStopsSection() {
    const { prefs, toggle, reset } = useSkipPhasePrefsState();

    return (
        <Panel>
            <PanelHeader
                title="Phase stops"
                subtitle="Where priority stops automatically during a turn — the same list the board's phase panel edits"
            />
            <PanelBody className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-3 py-1 text-[8px] uppercase tracking-wider text-text-disabled">
                    <span className="w-6 text-center">You</span>
                    <span className="flex-1 text-center">Stop on</span>
                    <span className="w-6 text-center">Opp</span>
                </div>
                <div className="rounded-md border border-border-subtle">
                    {PHASE_GROUPS.map((group) => (
                        <div key={group.label}>
                            <div className="px-3 pb-0.5 pt-2 text-[9px] uppercase tracking-wider text-text-disabled">
                                {group.label}
                            </div>
                            {group.steps.map((step) => (
                                <ControllerPhaseRow
                                    key={step.id}
                                    phase={step.id}
                                    label={step.label}
                                    compact={step.compact}
                                    isCurrent={false}
                                    isPast={false}
                                    skippable={isSkippablePhase(step.id)}
                                    prefs={prefs}
                                    onToggle={toggle}
                                    showCompactDecoder={false}
                                />
                            ))}
                        </div>
                    ))}
                </div>
                <div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={reset}
                    >
                        Reset to defaults
                    </Button>
                </div>
            </PanelBody>
        </Panel>
    );
}
