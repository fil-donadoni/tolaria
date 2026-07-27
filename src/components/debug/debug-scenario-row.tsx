import type { Doc } from "@convex/_generated/dataModel";
import DebugButton from "./debug-button";

/**
 * One saved debug-scenario row (issue #772, ADR 0044). Renders the golden toggle
 * (★ golden / ☆ ephemeral), the load button, regenerate/vary affordances (only
 * for a row carrying a stored prompt), and delete. Pure presentational — all
 * async work (load, toggle, regenerate, vary, delete, cleanup) is owned by the
 * parent (`DebugDbScenarios` in the board's debug blade, `ScenariosAdminPanel`
 * on `/admin/scenarios`), which passes `disabled` while a mutation/action is in
 * flight so the buttons can't double-fire.
 *
 * `onLoad` is OPTIONAL because the admin page manages scenarios with no game
 * open: loading a board setup needs a `gameId`, which only the in-game blade
 * has. Without it the label renders as plain text rather than a dead button.
 */
export default function DebugScenarioRow({
    row,
    disabled,
    onLoad,
    onToggleGolden,
    onEdit,
    onRegenerate,
    onVary,
    onDelete,
}: {
    row: Doc<"debugScenarios">;
    disabled: boolean;
    onLoad?: () => void;
    onToggleGolden: () => void;
    onEdit: () => void;
    onRegenerate: () => void;
    onVary: () => void;
    onDelete: () => void;
}) {
    const hasPrompt = typeof row.prompt === "string" && row.prompt.length > 0;
    return (
        <div className="flex items-center gap-1">
            <DebugButton onClick={onToggleGolden} disabled={disabled}>
                <span
                    className={
                        row.golden ? "text-accent-strong" : "text-text-disabled"
                    }
                >
                    {row.golden ? "★" : "☆"}
                </span>
            </DebugButton>
            {onLoad ? (
                <DebugButton onClick={onLoad} disabled={disabled}>
                    {row.label}
                </DebugButton>
            ) : (
                <span className="flex-1 truncate px-1 text-xs text-text">
                    {row.label}
                </span>
            )}
            <DebugButton onClick={onEdit} disabled={disabled}>
                {"✎"}
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
