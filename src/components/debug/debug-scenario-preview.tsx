import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    normalizeScenarioSpec,
    type ScenarioSpec,
} from "@convex/debugScenarioSpec";
import DebugButton from "./debug-button";

/**
 * Preview / edit / save step for a generated OR regenerated scenario (issue
 * #771/#772, ADR 0044). Shows the resolved spec as editable JSON plus any
 * unresolved card names, and saves through the `assertIsAdmin`-gated
 * `saveDebugScenario` mutation (which re-runs the loadability guard and throws on
 * any still-unresolved name) — nothing is written until the admin confirms. The
 * originating `prompt` is stored as metadata on the new row; the frozen spec is
 * always what loads, never the prompt. Save always INSERTS a new row, so a
 * regenerate never mutates the source. Shared by the generate and regenerate
 * flows so the human-in-the-loop step lives in one place.
 */
export default function DebugScenarioPreview({
    spec,
    unresolved,
    prompt,
    initialLabel,
    onSaved,
    onDiscard,
}: {
    spec: unknown;
    unresolved: string[];
    prompt?: string;
    initialLabel: string;
    onSaved: () => void;
    onDiscard: () => void;
}) {
    const saveScenario = useMutation(api.debugScenarios.saveDebugScenario);
    const [label, setLabel] = useState(initialLabel);
    const [previewText, setPreviewText] = useState(() =>
        JSON.stringify(spec, null, 2)
    );
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (saving) return;
        setError(null);
        let parsed: unknown;
        try {
            parsed = JSON.parse(previewText);
        } catch {
            setError("Preview is not valid JSON");
            return;
        }
        const normalized: ScenarioSpec = normalizeScenarioSpec(parsed);
        setSaving(true);
        try {
            await saveScenario({
                label: label.trim() || "Generated scenario",
                spec: normalized,
                ...(prompt ? { prompt } : {}),
            });
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-1 mt-1 pt-2 border-t border-white/10">
            <span className="text-white/40 text-[10px] uppercase tracking-wide">
                Preview &amp; edit
            </span>
            {unresolved.length > 0 && (
                <span className="text-red-400 text-[10px]">
                    {`Unknown card(s): ${unresolved.join(", ")} — fix before saving`}
                </span>
            )}
            <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label…"
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40"
            />
            <textarea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                rows={8}
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40 font-mono"
            />
            <div className="flex gap-1">
                <DebugButton
                    onClick={() => void handleSave()}
                    disabled={saving}
                >
                    {saving ? "Saving…" : "Save to DB"}
                </DebugButton>
                <DebugButton variant="danger" onClick={onDiscard}>
                    Discard
                </DebugButton>
            </div>
            {error && <span className="text-red-400 text-[10px]">{error}</span>}
        </div>
    );
}
