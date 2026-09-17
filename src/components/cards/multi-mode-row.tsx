import { Minus, Plus } from "lucide-react";
import type { Color, ModeOption } from "@convex/cards/types";
import ManaSymbol from "~/components/cards/mana-symbol";
import { Button } from "~/components/ui/button";
import { formatOracleText } from "~/lib/oracle-text";

type MultiModeRowProps = {
    mode: ModeOption & { color?: Color };
    /** How many times this mode is picked so far. */
    count: number;
    /** CR 700.2d — the list allows the same mode more than once, so the row
     *  shows a counter instead of a toggle. */
    repeats: boolean;
    /** CR 700.2a — false for a mode that can't be chosen right now. */
    legal: boolean;
    /** Whether one more pick of this mode fits the declared count. */
    canAdd: boolean;
    onAdd: () => void;
    onRemove: () => void;
};

/** One mode of a multi-select mode list (ADR 0094, issue #2264). A distinct-
 *  modes list toggles the row; a repeats list gives it a `[−] N [+]` counter
 *  so Fiery Confluence's "the same mode +1 / +2 / +3" is one row, not three. */
export default function MultiModeRow({
    mode,
    count,
    repeats,
    legal,
    canAdd,
    onAdd,
    onRemove,
}: MultiModeRowProps) {
    const picked = count > 0;
    const text = (
        <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
            <span className="text-display flex items-center gap-1.5 text-sm tracking-wide text-text">
                {mode.color && (
                    <ManaSymbol symbol={mode.color} className="size-4" />
                )}
                {formatOracleText(mode.label)}
            </span>
            <span className="text-xs text-text-disabled">
                {formatOracleText(mode.oracleText)}
            </span>
        </span>
    );

    if (!repeats) {
        return (
            <button
                type="button"
                data-mode-id={mode.id}
                data-mode-count={count}
                aria-pressed={picked}
                disabled={!legal || (!picked && !canAdd)}
                onClick={picked ? onRemove : onAdd}
                className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                    picked
                        ? "border-signal-target bg-surface-elevated"
                        : "border-transparent hover:border-border-strong hover:bg-surface-elevated"
                }`}
            >
                {text}
            </button>
        );
    }

    return (
        <div
            data-mode-id={mode.id}
            data-mode-count={count}
            className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5 ${
                picked ? "border-signal-target" : "border-transparent"
            } ${legal ? "" : "opacity-50"}`}
        >
            {text}
            <span className="flex shrink-0 items-center gap-1.5">
                <Button
                    type="button"
                    variant="secondary"
                    // Pointer-token height (ADR 0101 §2): 44px on touch.
                    className="min-w-[max(var(--control-h),40px)] px-0"
                    aria-label={`Remove ${mode.label}`}
                    disabled={count === 0}
                    onClick={onRemove}
                >
                    <Minus />
                </Button>
                <span className="w-5 text-center text-sm tabular-nums text-text">
                    {count}
                </span>
                <Button
                    type="button"
                    variant="secondary"
                    // Pointer-token height (ADR 0101 §2): 44px on touch.
                    className="min-w-[max(var(--control-h),40px)] px-0"
                    aria-label={`Add ${mode.label}`}
                    disabled={!canAdd}
                    onClick={onAdd}
                >
                    <Plus />
                </Button>
            </span>
        </div>
    );
}
