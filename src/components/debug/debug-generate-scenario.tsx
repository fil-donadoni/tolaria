import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    normalizeScenarioSpec,
    type ScenarioSpec,
} from "@convex/debugScenarioSpec";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import DebugButton from "./debug-button";

/**
 * LLM debug-scenario generator (issue #771, ADR 0044). A textarea takes a
 * natural-language board description; "Generate" calls the server-side
 * `generateDebugScenario` action (Anthropic, admin-gated, key stays in the
 * Convex env). The returned spec + any unresolved card names land in a
 * PREVIEW/EDIT step: the JSON is shown editable and validation errors visible,
 * so nothing is written until the admin confirms. "Save" then goes through the
 * existing `assertIsAdmin`-gated `saveDebugScenario` mutation (which re-runs the
 * loadability check and throws on any still-unresolved name). Admin-only,
 * rendered alongside `DebugDbScenarios` — the parent already gates on admin.
 */
export default function DebugGenerateScenario() {
    const generate = useAction(api.debugScenarioGenerator.generateDebugScenario);
    const saveScenario = useMutation(api.debugScenarios.saveDebugScenario);

    const [description, setDescription] = useState("");
    const [label, setLabel] = useState("");
    // The editable JSON preview — null until a spec has been generated.
    const [previewText, setPreviewText] = useState<string | null>(null);
    const [unresolved, setUnresolved] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);

    const user = useCurrentUser();
    const isAdmin = user?.isAdmin === true;

    const handleGenerate = async () => {
        if (generating) return;
        setError(null);
        setUnresolved([]);
        if (!description.trim()) {
            setError("Describe a board first");
            return;
        }
        setGenerating(true);
        try {
            const result = await generate({ description: description.trim() });
            setPreviewText(JSON.stringify(result.spec, null, 2));
            setUnresolved(result.unresolved);
            if (!label.trim()) setLabel(description.trim().slice(0, 60));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Generation failed");
        } finally {
            setGenerating(false);
        }
    };

    const handleSave = async () => {
        if (saving || previewText === null) return;
        setError(null);
        let parsed: unknown;
        try {
            parsed = JSON.parse(previewText);
        } catch {
            setError("Preview is not valid JSON");
            return;
        }
        const spec: ScenarioSpec = normalizeScenarioSpec(parsed);
        setSaving(true);
        try {
            // saveDebugScenario re-validates loadability and throws on any
            // unresolved name — nothing is written on rejection.
            await saveScenario({
                label: label.trim() || "Generated scenario",
                spec,
                prompt: description.trim(),
            });
            // Reset back to the description-entry state on success.
            setDescription("");
            setLabel("");
            setPreviewText(null);
            setUnresolved([]);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleDiscard = () => {
        setPreviewText(null);
        setUnresolved([]);
        setError(null);
    };

    if (!isAdmin) return null;

    return (
        <div className="flex flex-col gap-1">
            <span className="text-white/40 text-[10px] uppercase tracking-wide">
                Generate from description
            </span>
            <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Mishra's Factory with the lands to animate it; opponent holds Shatter and has 2 Mountains"
                rows={2}
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40"
            />
            <DebugButton
                onClick={() => void handleGenerate()}
                disabled={generating}
            >
                {generating ? "Generating…" : "Generate"}
            </DebugButton>

            {previewText !== null && (
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
                        <DebugButton variant="danger" onClick={handleDiscard}>
                            Discard
                        </DebugButton>
                    </div>
                </div>
            )}

            {error && <span className="text-red-400 text-[10px]">{error}</span>}
        </div>
    );
}
