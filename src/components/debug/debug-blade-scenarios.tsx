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
        <div className="flex flex-col gap-1">
            <span className="text-white/40 text-[10px] uppercase tracking-wide">
                Blade scenarios (read-only)
            </span>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                {scenarios === undefined ? (
                    <span className="text-white/30 text-[10px]">Loading…</span>
                ) : scenarios.length === 0 ? (
                    <span className="text-white/30 text-[10px]">
                        No blade scenarios registered
                    </span>
                ) : (
                    scenarios.map((s) => (
                        <div key={s.label} className="flex items-center gap-1">
                            <span
                                className={
                                    s.tier === "must"
                                        ? "text-red-300 text-[10px] uppercase w-12 shrink-0"
                                        : "text-white/30 text-[10px] uppercase w-12 shrink-0"
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
                                onClick={() => void handleLoad(s.label)}
                                disabled={pendingLabel !== null}
                            >
                                {pendingLabel === s.label
                                    ? "Loading…"
                                    : s.label}
                            </DebugButton>
                        </div>
                    ))
                )}
            </div>
            {error && <span className="text-red-400 text-[10px]">{error}</span>}
        </div>
    );
}
