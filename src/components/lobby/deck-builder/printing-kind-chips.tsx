import { cn } from "~/lib/utils";
import { PRINTING_KINDS, type PrintingKindFilter } from "~/lib/printingPicker";

interface PrintingKindChipsProps {
    counts: Record<PrintingKindFilter, number>;
    value: PrintingKindFilter;
    onChange: (kind: PrintingKindFilter) => void;
    /** More pages remain — the counts cover only what is loaded so far. */
    partial: boolean;
}

const KIND_LABELS: Record<PrintingKindFilter, string> = {
    all: "All",
    paper: "Paper",
    promo: "Promo",
    digital: "Digital",
};

/** The printing picker's kind filter (issue #4122): All · Paper · Promo ·
 *  Digital, each with its count. A kind the loaded printings never show is
 *  left out, unless it is the active one — the chip that would clear it
 *  must not vanish. */
export default function PrintingKindChips({
    counts,
    value,
    onChange,
    partial,
}: PrintingKindChipsProps) {
    const kinds: PrintingKindFilter[] = [
        "all",
        ...PRINTING_KINDS.filter((k) => counts[k] > 0 || k === value),
    ];
    return (
        <div
            role="group"
            aria-label="Printing kind"
            className="flex items-center gap-1 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 p-0.5 text-[11px]"
        >
            {kinds.map((k) => (
                <button
                    key={k}
                    type="button"
                    onClick={() => onChange(k)}
                    aria-pressed={value === k}
                    className={cn(
                        "segment-pill",
                        value === k ? "segment-active" : "segment-inactive"
                    )}
                >
                    {KIND_LABELS[k]}{" "}
                    <span className="tabular-nums opacity-70">
                        {counts[k]}
                        {partial ? "+" : ""}
                    </span>
                </button>
            ))}
        </div>
    );
}
