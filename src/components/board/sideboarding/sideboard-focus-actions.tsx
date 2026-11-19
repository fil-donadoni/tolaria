import {
    ArrowLeft,
    ArrowRight,
    ChevronsLeft,
    ChevronsRight,
} from "lucide-react";
import type { SideboardPoolRow, SideboardZone } from "~/lib/sideboard-pool";

const BUTTON =
    "inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1.5 text-xs text-text transition-colors hover:border-accent/60 hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-35";

/** The inspector's explicit moves for the focused card (issue #9820):
 *  `← 1`, `« All N` to the Maindeck, `1 →`, `All N »` to the Sideboard. */
export default function SideboardFocusActions({
    row,
    onMove,
    disabled,
}: {
    row: SideboardPoolRow;
    onMove: (cardId: string, to: SideboardZone, all: boolean) => void;
    disabled: boolean;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-parchment">{row.name}</span>
                <span className="shrink-0 text-text-muted tabular-nums">
                    Main <b className="text-text">{row.main}</b> · Side{" "}
                    <b className="text-text">{row.side}</b>
                </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">
                        ← To Maindeck
                    </span>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            className={BUTTON}
                            aria-label={`Move 1 ${row.name} to the Maindeck`}
                            disabled={disabled || row.side === 0}
                            onClick={() => onMove(row.cardId, "main", false)}
                        >
                            <ArrowLeft className="size-3.5" /> 1
                        </button>
                        <button
                            type="button"
                            className={BUTTON}
                            aria-label={`Move all ${row.side} ${row.name} to the Maindeck`}
                            disabled={disabled || row.side < 2}
                            onClick={() => onMove(row.cardId, "main", true)}
                        >
                            <ChevronsLeft className="size-3.5" /> All{" "}
                            {row.side > 1 ? row.side : ""}
                        </button>
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-right text-[10px] uppercase tracking-wide text-text-muted">
                        To Sideboard →
                    </span>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            className={BUTTON}
                            aria-label={`Move 1 ${row.name} to the Sideboard`}
                            disabled={disabled || row.main === 0}
                            onClick={() => onMove(row.cardId, "side", false)}
                        >
                            1 <ArrowRight className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            className={BUTTON}
                            aria-label={`Move all ${row.main} ${row.name} to the Sideboard`}
                            disabled={disabled || row.main < 2}
                            onClick={() => onMove(row.cardId, "side", true)}
                        >
                            All {row.main > 1 ? row.main : ""}{" "}
                            <ChevronsRight className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
