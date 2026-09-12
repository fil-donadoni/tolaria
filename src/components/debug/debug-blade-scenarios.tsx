import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import DebugButton from "./debug-button";

/**
 * READ-ONLY browser loader for the code-side blade-scenario registry (issue
 * #1432, PRD #1423). Lists every entry in `convex/gre/ai/blade/registry.ts`
 * (label + tier + note, fetched via `debugListBladeScenarios`) and, on
 * click, loads that entry's position into the CURRENT game via
 * `debugLoadBladeScenario` — the exact same `buildStateFromScenario` the
 * blade test harness uses, so the browser position matches the harness's
 * built state for that entry.
 *
 * Deliberately NOT the `debugScenarios` DB path (`DebugDbScenarios`): there
 * is no save/edit/delete/golden affordance here — the registry is the sole
 * source of truth and this component only reads and applies it.
 */
export default function DebugBladeScenarios({
    gameId,
}: {
    gameId: Id<"games">;
}) {
    const user = useCurrentUser();
    const isAdmin = user?.isAdmin === true;

    const scenarios = useQuery(
        api.game.debugListBladeScenarios,
        isAdmin ? {} : "skip"
    );
    const loadScenario = useMutation(api.game.debugLoadBladeScenario);

    const [pendingLabel, setPendingLabel] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (!isAdmin) return null;

    const handleLoad = async (label: string) => {
        if (pendingLabel) return;
        setError(null);
        setPendingLabel(label);
        try {
            await loadScenario({ gameId, label });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Load failed");
        } finally {
            setPendingLabel(null);
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            {/* "load-only", not "read-only": clicking a row APPLIES that
                registry position to the current game — the registry itself is
                the source of truth and isn't editable from here. */}
            <span className="text-sm font-medium text-text">
                Blade scenarios (click to load)
            </span>
            <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5 rounded-sm border border-border-subtle/60 p-1">
                {scenarios === undefined ? (
                    <span className="p-1 text-xs text-text-muted">
                        Loading…
                    </span>
                ) : scenarios.length === 0 ? (
                    <span className="p-1 text-xs text-text-muted">
                        No blade scenarios registered
                    </span>
                ) : (
                    scenarios.map((s) => (
                        <div
                            key={s.label}
                            className="flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-surface-elevated/60"
                        >
                            <span
                                className={
                                    s.tier === "must"
                                        ? "w-12 shrink-0 text-xs font-medium uppercase text-danger-strong"
                                        : "w-12 shrink-0 text-xs uppercase text-text-muted"
                                }
                                title={
                                    s.tier === "must"
                                        ? "Blocking CI check"
                                        : "Report-only, not blocking"
                                }
                            >
                                {s.tier}
                            </span>
                            <DebugButton
                                variant="primary"
                                size="sm"
                                onClick={() => void handleLoad(s.label)}
                                disabled={pendingLabel !== null}
                                title={`Load "${s.label}" into this game`}
                                // See `debug-scenario-row.tsx` (#3403): the
                                // label shrinks so the tier chip beside it
                                // stays inside the sheet at phone width.
                                className="min-w-0 shrink justify-start truncate text-left"
                            >
                                {pendingLabel === s.label
                                    ? "Loading…"
                                    : s.label}
                            </DebugButton>
                        </div>
                    ))
                )}
            </div>
            {error && (
                <span className="text-xs text-danger-strong">{error}</span>
            )}
        </div>
    );
}
