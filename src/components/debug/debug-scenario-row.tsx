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
 * `onTest` is its counterpart for that caller — start a FRESH solo game on this
 * scenario — and is absent in the blade, where a game is already open and Load
 * is the right verb.
 */
export default function DebugScenarioRow({
    row,
    disabled,
    onLoad,
    onTest,
    testing = false,
    onToggleGolden,
    onEdit,
    onRegenerate,
    onVary,
    onDelete,
}: {
    row: Doc<"debugScenarios">;
    disabled: boolean;
    onLoad?: () => void;
    /** Start a new solo game on this scenario (admin Scenarios page). */
    onTest?: () => void;
    /** True while THIS row's game is being created — labels the button and,
     *  via the parent's `disabled`, keeps every row from double-firing. */
    testing?: boolean;
    onToggleGolden: () => void;
    onEdit: () => void;
    onRegenerate: () => void;
    onVary: () => void;
    onDelete: () => void;
}) {
    const hasPrompt = typeof row.prompt === "string" && row.prompt.length > 0;
    return (
        <div className="flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-surface-elevated/60">
            <DebugButton
                onClick={onToggleGolden}
                disabled={disabled}
                title={row.golden ? "Golden — kept" : "Ephemeral — prunable"}
            >
                <span
                    className={
                        row.golden ? "text-accent-strong" : "text-text-disabled"
                    }
                >
                    {row.golden ? "★" : "☆"}
                </span>
            </DebugButton>
            {onLoad ? (
                // The row's VERB, so it carries the primary tone (issue
                // #3494): it read exactly like the ★/✎/× glyphs beside it while
                // every control on the surface was `secondary`.
                <DebugButton
                    variant="primary"
                    size="sm"
                    onClick={onLoad}
                    disabled={disabled}
                    title={`Load "${row.label}" into this game`}
                    // The label is the only elastic cell in the row (#3403):
                    // everything else is a one-glyph verb that must stay
                    // reachable at the debug sheet's 293px phone width.
                    className="min-w-0 shrink justify-start truncate text-left"
                >
                    {row.label}
                </DebugButton>
            ) : (
                <span className="flex-1 truncate px-1 text-xs text-text">
                    {row.label}
                </span>
            )}
            {onTest && (
                <DebugButton
                    variant="primary"
                    size="sm"
                    onClick={onTest}
                    disabled={disabled}
                    title="Start a fresh solo game on this scenario"
                >
                    {testing ? "Starting…" : "Test"}
                </DebugButton>
            )}
            <DebugButton onClick={onEdit} disabled={disabled} title="Edit">
                {"✎"}
            </DebugButton>
            {hasPrompt && (
                <>
                    <DebugButton
                        onClick={onRegenerate}
                        disabled={disabled}
                        title="Regenerate from the stored prompt"
                    >
                        {"↻"}
                    </DebugButton>
                    <DebugButton
                        onClick={onVary}
                        disabled={disabled}
                        title="Vary with a tweak"
                    >
                        {"~"}
                    </DebugButton>
                </>
            )}
            <DebugButton
                variant="danger"
                onClick={onDelete}
                disabled={disabled}
                title="Delete"
            >
                {"×"}
            </DebugButton>
        </div>
    );
}
