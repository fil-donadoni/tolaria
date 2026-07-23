import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import DebugButton from "./debug-button";
import DebugScenarioPreview from "./debug-scenario-preview";

/** A generated spec awaiting the preview/edit/save step. */
type Preview = { spec: unknown; unresolved: string[]; prompt: string };

/**
 * LLM debug-scenario generator (issue #771, ADR 0044). A textarea takes a
 * natural-language board description; "Generate" calls the server-side
 * `generateDebugScenario` action (Anthropic, admin-gated, key stays in the
 * Convex env). The returned spec + any unresolved card names land in a
 * PREVIEW/EDIT step (`DebugScenarioPreview`) so nothing is written until the
 * admin confirms. Admin-only, rendered alongside `DebugDbScenarios` — the parent
 * already gates on admin.
 */
export default function DebugGenerateScenario() {
    const generate = useAction(
        api.debugScenarioGenerator.generateDebugScenario
    );

    const [description, setDescription] = useState("");
    const [preview, setPreview] = useState<Preview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const user = useCurrentUser();
    const isAdmin = user?.isAdmin === true;

    const handleGenerate = async () => {
        if (generating) return;
        setError(null);
        const trimmed = description.trim();
        if (!trimmed) {
            setError("Describe a board first");
            return;
        }
        setGenerating(true);
        try {
            const result = await generate({ description: trimmed });
            setPreview({
                spec: result.spec,
                unresolved: result.unresolved,
                prompt: trimmed,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Generation failed");
        } finally {
            setGenerating(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <div className="flex flex-col gap-1">
            <span className="text-label">Generate from description</span>
            <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                    // Ctrl/Cmd+Enter submits, mirroring the Generate button.
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void handleGenerate();
                    }
                }}
                placeholder="e.g. Mishra's Factory with the lands to animate it; opponent holds Shatter and has 2 Mountains"
                rows={2}
                className="input-field w-full px-2 py-1 text-xs"
            />
            <DebugButton
                onClick={() => void handleGenerate()}
                disabled={generating}
            >
                {generating ? "Generating…" : "Generate"}
            </DebugButton>

            {preview !== null && (
                <DebugScenarioPreview
                    spec={preview.spec}
                    unresolved={preview.unresolved}
                    prompt={preview.prompt}
                    initialLabel={description.trim().slice(0, 60)}
                    onSaved={() => {
                        setDescription("");
                        setPreview(null);
                    }}
                    onDiscard={() => setPreview(null)}
                />
            )}

            {error && (
                <span className="text-[10px] text-danger-strong">{error}</span>
            )}
        </div>
    );
}
