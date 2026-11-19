import { X } from "lucide-react";
import type { SideboardPoolRow } from "~/lib/sideboard-pool";
import { cn } from "~/lib/utils";

/** One changed card (issue #9820): `+3 <card>` / `−1 <card>`, its X undoing
 *  that card back to its Maindeck count at window open. */
export default function SideboardChangeChip({
    row,
    onUndo,
    disabled,
}: {
    row: SideboardPoolRow;
    onUndo: (row: SideboardPoolRow) => void;
    disabled: boolean;
}) {
    const label = `Undo: ${row.name} back to ${row.startMain} in the Maindeck`;
    return (
        <span
            data-change-chip={row.cardId}
            className={cn(
                "inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-xs tabular-nums",
                row.delta > 0
                    ? "border-success/50 bg-success-soft text-success-strong"
                    : "border-danger/50 bg-danger-soft text-danger-strong"
            )}
        >
            <span className="font-semibold">
                {row.delta > 0 ? `+${row.delta}` : `−${-row.delta}`}
            </span>
            <span className="max-w-40 truncate">{row.name}</span>
            <button
                type="button"
                onClick={() => onUndo(row)}
                disabled={disabled}
                aria-label={label}
                title={label}
                className="flex size-5 items-center justify-center rounded-full opacity-70 transition-colors hover:bg-current/20 hover:opacity-100 disabled:pointer-events-none"
            >
                <X className="size-3" strokeWidth={2.5} />
            </button>
        </span>
    );
}
