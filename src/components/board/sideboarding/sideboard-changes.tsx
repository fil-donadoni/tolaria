import type { SideboardPoolRow } from "~/lib/sideboard-pool";
import SideboardChangeChip from "./sideboard-change-chip";

/** The Changes row (issue #9820): one chip per changed card, ins before outs,
 *  then "Reset" restoring the whole window; a quiet line when nothing moved. */
export default function SideboardChanges({
    pool,
    onUndo,
    onReset,
    disabled,
}: {
    pool: SideboardPoolRow[];
    onUndo: (row: SideboardPoolRow) => void;
    onReset: () => void;
    disabled: boolean;
}) {
    const ins = pool.filter((r) => r.delta > 0);
    const outs = pool.filter((r) => r.delta < 0);
    if (ins.length + outs.length === 0)
        return (
            <span className="text-xs text-text-disabled">
                No changes — same deck as last game
            </span>
        );
    return (
        <div className="flex flex-wrap items-center gap-1">
            {[...ins, ...outs].map((r) => (
                <SideboardChangeChip
                    key={r.cardId}
                    row={r}
                    onUndo={onUndo}
                    disabled={disabled}
                />
            ))}
            <button
                type="button"
                onClick={onReset}
                disabled={disabled}
                className="ml-1 text-xs text-text-muted underline-offset-4 hover:text-parchment hover:underline disabled:pointer-events-none"
            >
                Reset
            </button>
        </div>
    );
}
