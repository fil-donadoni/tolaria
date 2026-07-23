import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { normalizeScenarioSpec } from "@convex/debugScenarioSpec";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import DebugButton from "./debug-button";
import DebugScenarioRow from "./debug-scenario-row";
import DebugScenarioPreview from "./debug-scenario-preview";

/** A regenerated/varied spec awaiting the preview/edit/save step. */
type Preview = {
    spec: unknown;
    unresolved: string[];
    prompt: string;
    initialLabel: string;
};

/**
 * DB-backed debug scenarios (issue #769/#770/#772, ADR 0044). Lists the current
 * admin's saved scenarios and, on click, passes the TOLERANTLY normalized spec
 * straight to the unchanged `debugSetupScenario` builder. Rows are disposable and
 * promotable (issue #772): each can be flagged golden (kept) or left ephemeral
 * (prunable), regenerated/varied from its stored prompt into a NEW row (the
 * source never mutates), and the whole ephemeral set cleaned up past a bound.
 * Admin-only: the queries/mutations/action are `assertIsAdmin`-gated.
 */
export default function DebugDbScenarios({
    gameId,
    onEdit,
}: {
    gameId: Id<"games">;
    onEdit: (row: Doc<"debugScenarios">) => void;
}) {
    const user = useCurrentUser();
    const isAdmin = user?.isAdmin === true;

    const scenarios = useQuery(
        api.debugScenarios.listDebugScenarios,
        isAdmin ? {} : "skip"
    );
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const deleteScenario = useMutation(api.debugScenarios.deleteDebugScenario);
    const setGolden = useMutation(api.debugScenarios.setDebugScenarioGolden);
    const cleanup = useMutation(api.debugScenarios.cleanupEphemeralScenarios);
    const regenerate = useAction(
        api.debugScenarioGenerator.regenerateDebugScenario
    );

    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<Id<"debugScenarios"> | null>(null);
    const [cleaning, setCleaning] = useState(false);
    const [varyingId, setVaryingId] = useState<Id<"debugScenarios"> | null>(
        null
    );
    const [tweak, setTweak] = useState("");
    const [preview, setPreview] = useState<Preview | null>(null);
    const [filter, setFilter] = useState("");

    if (!isAdmin) return null;

    const handleLoad = (spec: unknown) => {
        // Tolerant load (ADR 0044): drop unknown fields, default missing ones,
        // then hand the clean args to the unchanged builder.
        const normalized = normalizeScenarioSpec(spec);
        void setupScenario({ gameId, ...normalized });
    };

    const handleToggleGolden = (row: Doc<"debugScenarios">) => {
        void setGolden({ id: row._id, golden: row.golden !== true });
    };

    const handleCleanup = async () => {
        if (cleaning) return;
        setError(null);
        setCleaning(true);
        try {
            await cleanup({});
        } catch (e) {
            setError(e instanceof Error ? e.message : "Cleanup failed");
        } finally {
            setCleaning(false);
        }
    };

    // Regenerate (no tweak) / vary (with tweak) both re-run the generator against
    // the row's stored prompt and land the NEW spec in the shared preview — the
    // source row is never mutated (only a subsequent save inserts a new row).
    const runRegenerate = async (
        row: Doc<"debugScenarios">,
        tweakText?: string
    ) => {
        if (busyId) return;
        setError(null);
        setBusyId(row._id);
        try {
            const result = await regenerate({
                id: row._id,
                ...(tweakText ? { tweak: tweakText } : {}),
            });
            setPreview({
                spec: result.spec,
                unresolved: result.unresolved,
                prompt: result.prompt,
                initialLabel: `${row.label} (copy)`,
            });
            setVaryingId(null);
            setTweak("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Regenerate failed");
        } finally {
            setBusyId(null);
        }
    };

    const rows = (scenarios ?? []).filter((s) =>
        s.label.toLowerCase().includes(filter.toLowerCase())
    );
    const total = scenarios?.length ?? 0;
    const varyingRow = rows.find((r) => r._id === varyingId) ?? null;

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <span className="text-label">Load scenario</span>
                {total > 0 && (
                    <span className="text-[10px] text-text-disabled tabular-nums">
                        {filter.trim() ? `${rows.length} / ${total}` : total}
                    </span>
                )}
            </div>
            <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search scenarios…"
                className="input-field w-full px-2 py-1 text-xs"
                autoFocus
            />
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                {rows.length === 0 ? (
                    <span className="text-[10px] text-text-disabled">
                        {scenarios === undefined
                            ? "Loading…"
                            : "No saved scenarios"}
                    </span>
                ) : (
                    rows.map((s) => (
                        <DebugScenarioRow
                            key={s._id}
                            row={s}
                            disabled={busyId !== null}
                            onLoad={() => handleLoad(s.spec)}
                            onToggleGolden={() => handleToggleGolden(s)}
                            onEdit={() => onEdit(s)}
                            onRegenerate={() => void runRegenerate(s)}
                            onVary={() => {
                                setVaryingId(s._id);
                                setTweak("");
                            }}
                            onDelete={() => void deleteScenario({ id: s._id })}
                        />
                    ))
                )}
            </div>

            {rows.length > 0 && (
                <DebugButton
                    onClick={() => void handleCleanup()}
                    disabled={cleaning}
                >
                    {cleaning ? "Cleaning…" : "Clean up ephemeral"}
                </DebugButton>
            )}

            {varyingRow && (
                <div className="flex flex-col gap-1 mt-1 pt-2 border-t border-border-accent/20">
                    <span className="text-label">
                        {`Vary: ${varyingRow.label}`}
                    </span>
                    <input
                        type="text"
                        value={tweak}
                        onChange={(e) => setTweak(e.target.value)}
                        placeholder="Tweak, e.g. add a second Mountain to opp"
                        className="input-field w-full px-2 py-1 text-xs"
                    />
                    <div className="flex gap-1">
                        <DebugButton
                            onClick={() =>
                                void runRegenerate(varyingRow, tweak.trim())
                            }
                            disabled={busyId !== null}
                        >
                            {busyId !== null
                                ? "Generating…"
                                : "Generate variation"}
                        </DebugButton>
                        <DebugButton
                            variant="danger"
                            onClick={() => {
                                setVaryingId(null);
                                setTweak("");
                            }}
                        >
                            Cancel
                        </DebugButton>
                    </div>
                </div>
            )}

            {preview !== null && (
                <DebugScenarioPreview
                    spec={preview.spec}
                    unresolved={preview.unresolved}
                    prompt={preview.prompt}
                    initialLabel={preview.initialLabel}
                    onSaved={() => setPreview(null)}
                    onDiscard={() => setPreview(null)}
                />
            )}

            {error && (
                <span className="text-[10px] text-danger-strong">{error}</span>
            )}
        </div>
    );
}
