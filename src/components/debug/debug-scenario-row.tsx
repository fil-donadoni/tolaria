import type { Doc } from "@convex/_generated/dataModel";
import DebugButton from "./debug-button";

/**
 * One saved debug-scenario row (issue #772, ADR 0044). Renders the golden toggle
 * (★ golden / ☆ ephemeral), the load button, regenerate/vary affordances (only
 * for a row carrying a stored prompt), and delete. Pure presentational — all
 * async work (load, toggle, regenerate, vary, delete, cleanup) is owned by the
 * parent `DebugDbScenarios`, which passes `disabled` while a mutation/action is
 * in flight so the buttons can't double-fire.
 */
export default function DebugScenarioRow({
    row,
    disabled,
    onLoad,
    onToggleGolden,
    onRegenerate,
    onVary,
    onDelete,
}: {
    row: Doc<"debugScenarios">;
    disabled: boolean;
    onLoad: () => void;
    onToggleGolden: () => void;
    onRegenerate: () => void;
    onVary: () => void;
    onDelete: () => void;
}) {
    const hasPrompt = typeof row.prompt === "string" && row.prompt.length > 0;
    return (
        <div className="flex items-center gap-1">
            <DebugButton onClick={onToggleGolden} disabled={disabled}>
                <span
                    className={row.golden ? "text-amber-300" : "text-white/40"}
                >
                    {row.golden ? "★" : "☆"}
                </span>
            </DebugButton>
            <DebugButton onClick={onLoad} disabled={disabled}>
                {row.label}
            </DebugButton>
            {hasPrompt && (
                <>
                    <DebugButton onClick={onRegenerate} disabled={disabled}>
                        {"↻"}
                    </DebugButton>
                    <DebugButton onClick={onVary} disabled={disabled}>
                        {"~"}
                    </DebugButton>
                </>
            )}
            <DebugButton
                variant="danger"
                onClick={onDelete}
                disabled={disabled}
            >
                {"×"}
            </DebugButton>
        </div>
    );
}
