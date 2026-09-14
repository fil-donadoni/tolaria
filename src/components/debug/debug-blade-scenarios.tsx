import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
/** One entry, DERIVED from the query that returns it rather than restated
 *  here — the backend `returns` validator stays the single definition. */
type BladeScenarioRow = FunctionReturnType<
    typeof api.game.debugListBladeScenarios
>[number];

/**
 * The row's hover text (issue #3443): what the entry ASKS of the seat under
 * test, why it exists, and — when it carries one — the recorded verdict that
 * it is not solved at its declared budget.
 *
 * In `title` rather than in the layout on purpose. This panel is a scrollable
 * list of 130-odd entries inside a phone-width sheet; an expectation line is a
 * matcher rendering that routinely runs longer than the label above it, so
 * laying it out would cost either the list's scannability or a row per entry
 * that no longer fits the sheet. The budget is the one fact that earns a
 * column, because it is the one a developer compares against something else.
 */
function rowTitle(s: BladeScenarioRow): string {
    const lines = [
        `Load "${s.label}" into this game`,
        `Expects: ${s.expectation}`,
        `Budget: ${s.budget} iterations`,
    ];
    if (s.beyondBudget) lines.push(`Beyond budget — ${s.beyondBudget}`);
    if (s.note) lines.push(s.note);
    return lines.join("\n");
}

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
    const [notice, setNotice] = useState<string | null>(null);

    if (!isAdmin) return null;

    const handleLoad = async (label: string) => {
        if (pendingLabel) return;
        setError(null);
        setNotice(null);
        setPendingLabel(label);
        try {
            const result = await loadScenario({ gameId, label });
            // A conversion is permanent and invisible on the board itself
            // (issue #3443) — the seats do not change, the Brain simply starts
            // driving one of them — so it is announced here or not at all.
            setNotice(
                result.convertedToVsAi
                    ? "This solo game is now a vs-AI game: the Bot drives the seat under test."
                    : null
            );
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
                                title={rowTitle(s)}
                                // See `debug-scenario-row.tsx` (#3403): the
                                // label shrinks so the tier chip beside it
                                // stays inside the sheet at phone width.
                                className="min-w-0 shrink justify-start truncate text-left"
                            >
                                {pendingLabel === s.label
                                    ? "Loading…"
                                    : s.label}
                            </DebugButton>
                            {/* The entry's own search budget (issue #3443).
                                The browser's difficulty preset is a DIFFERENT
                                budget, and a Bot that sits still after a load
                                is either failing the entry or simply searching
                                at fewer iterations than the entry demands —
                                identical on the board, so the number the entry
                                asks for is on the row. */}
                            <span
                                className="ml-auto shrink-0 text-xs tabular-nums text-text-muted"
                                title={`Entry budget: ${s.budget} search iterations`}
                            >
                                {s.budget}
                            </span>
                        </div>
                    ))
                )}
            </div>
            {error ? (
                <span className="text-xs text-danger-strong">{error}</span>
            ) : notice ? (
                <span className="text-xs text-text-muted">{notice}</span>
            ) : null}
        </div>
    );
}
