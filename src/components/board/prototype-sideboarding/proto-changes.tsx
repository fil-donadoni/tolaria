// PROTOTYPE — throwaway. The swap ledger: what this window changed, each
// entry undoable on its own.
import { X } from "lucide-react";
import { setMainCount, type PoolRow } from "./proto-model";
import type { ProtoVariantProps } from "./proto-types";
import { cn } from "~/lib/utils";

export default function ProtoChanges({
    p,
    layout = "chips",
}: {
    p: ProtoVariantProps;
    layout?: "chips" | "list";
}) {
    const changed = p.pool.filter((r) => r.delta !== 0);
    const ins = changed.filter((r) => r.delta > 0);
    const outs = changed.filter((r) => r.delta < 0);
    if (changed.length === 0)
        return (
            <span className="text-xs text-text-disabled">
                No changes — same 60 as last game
            </span>
        );
    const undo = (r: PoolRow) =>
        p.setSplit((s) => setMainCount(s, r.cardId, r.startMain));
    const chip = (r: PoolRow) => (
        <span
            key={r.cardId}
            className={cn(
                "inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-xs tabular-nums",
                r.delta > 0
                    ? "border-success/50 bg-success-soft text-success-strong"
                    : "border-danger/50 bg-danger-soft text-danger-strong"
            )}
        >
            <span className="font-semibold">
                {r.delta > 0 ? `+${r.delta}` : r.delta}
            </span>
            <span className="max-w-40 truncate">{r.name}</span>
            <button
                type="button"
                onClick={() => undo(r)}
                aria-label={`Undo: ${r.name} back to ${r.startMain} in the Maindeck`}
                title={`Undo: ${r.name} back to ${r.startMain} in the Maindeck`}
                className="flex size-4 items-center justify-center rounded-full opacity-70 transition-colors hover:bg-current/20 hover:opacity-100"
            >
                <X className="size-3" strokeWidth={2.5} />
            </button>
        </span>
    );
    if (layout === "list")
        return (
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <div className="text-[10px] uppercase tracking-wide text-text-muted">
                        In · {ins.reduce((n, r) => n + r.delta, 0)}
                    </div>
                    <div className="flex flex-wrap gap-1">{ins.map(chip)}</div>
                </div>
                <div className="flex flex-col gap-1">
                    <div className="text-[10px] uppercase tracking-wide text-text-muted">
                        Out · {-outs.reduce((n, r) => n + r.delta, 0)}
                    </div>
                    <div className="flex flex-wrap gap-1">{outs.map(chip)}</div>
                </div>
                <button
                    type="button"
                    onClick={p.reset}
                    className="self-start text-xs text-text-muted underline-offset-4 hover:text-parchment hover:underline"
                >
                    Reset to last game's deck
                </button>
            </div>
        );
    return (
        <div className="flex flex-wrap items-center gap-1">
            {ins.map(chip)}
            {outs.map(chip)}
            <button
                type="button"
                onClick={p.reset}
                className="ml-1 text-xs text-text-muted underline-offset-4 hover:text-parchment hover:underline"
            >
                Reset
            </button>
        </div>
    );
}
