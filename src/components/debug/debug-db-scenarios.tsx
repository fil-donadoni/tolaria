import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    normalizeScenarioSpec,
    type ScenarioSpec,
} from "@convex/debugScenarioSpec";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import DebugButton from "./debug-button";

/**
 * DB-backed debug scenarios (issue #769/#770, ADR 0044). Lists the current
 * admin's saved scenarios from `listDebugScenarios` — the SOLE scenario source
 * since the `PRESET_SCENARIOS` code literal was migrated to DB rows (issue
 * #770) — and, on click, passes the TOLERANTLY normalized spec straight to the
 * unchanged `debugSetupScenario` builder. A minimal manual save path (label +
 * JSON spec) demos the full schema → mutation → query → UI → load loop; the LLM
 * generator is a later slice. Admin-only: the queries/mutations are
 * `assertIsAdmin`-gated, so the list is skipped for non-admins.
 */
export default function DebugDbScenarios({
    gameId,
    filter,
}: {
    gameId: Id<"games">;
    filter: string;
}) {
    const user = useCurrentUser();
    const isAdmin = user?.isAdmin === true;

    const scenarios = useQuery(
        api.debugScenarios.listDebugScenarios,
        isAdmin ? {} : "skip"
    );
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const saveScenario = useMutation(api.debugScenarios.saveDebugScenario);
    const deleteScenario = useMutation(api.debugScenarios.deleteDebugScenario);

    const [label, setLabel] = useState("");
    const [specText, setSpecText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    if (!isAdmin) return null;

    const handleLoad = (spec: unknown) => {
        // Tolerant load (ADR 0044): drop unknown fields, default missing ones,
        // then hand the clean args to the unchanged builder.
        const normalized = normalizeScenarioSpec(spec);
        void setupScenario({ gameId, ...normalized });
    };

    const handleSave = async () => {
        if (pending) return;
        setError(null);
        let parsed: unknown;
        try {
            parsed = JSON.parse(specText);
        } catch {
            setError("Spec is not valid JSON");
            return;
        }
        const spec: ScenarioSpec = normalizeScenarioSpec(parsed);
        setPending(true);
        try {
            await saveScenario({ label: label.trim() || "Untitled", spec });
            setLabel("");
            setSpecText("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setPending(false);
        }
    };

    const rows = (scenarios ?? []).filter((s) =>
        s.label.toLowerCase().includes(filter.toLowerCase())
    );

    return (
        <div className="flex flex-col gap-1">
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                {rows.length === 0 ? (
                    <span className="text-white/30 text-[10px]">
                        {scenarios === undefined
                            ? "Loading…"
                            : "No saved scenarios"}
                    </span>
                ) : (
                    rows.map((s) => (
                        <div key={s._id} className="flex items-center gap-1">
                            <DebugButton onClick={() => handleLoad(s.spec)}>
                                {s.label}
                            </DebugButton>
                            <DebugButton
                                variant="danger"
                                onClick={() =>
                                    void deleteScenario({ id: s._id })
                                }
                            >
                                {"×"}
                            </DebugButton>
                        </div>
                    ))
                )}
            </div>

            <span className="text-white/40 text-[10px] uppercase tracking-wide mt-1 pt-2 border-t border-white/10">
                Save scenario
            </span>
            <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label…"
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40"
            />
            <textarea
                value={specText}
                onChange={(e) => setSpecText(e.target.value)}
                placeholder='{"cards":[{"name":"Plains","owner":"me"}],"landCount":2}'
                rows={3}
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40 font-mono"
            />
            {error && (
                <span className="text-red-400 text-[10px]">{error}</span>
            )}
            <DebugButton onClick={() => void handleSave()} disabled={pending}>
                {pending ? "Saving…" : "Save to DB"}
            </DebugButton>
        </div>
    );
}
