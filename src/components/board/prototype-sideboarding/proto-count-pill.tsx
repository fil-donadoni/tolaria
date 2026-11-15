// PROTOTYPE — throwaway. "Main 60 / 60+" and "Side 15" pills.
import { cn } from "~/lib/utils";

export default function ProtoCountPill({
    label,
    value,
    of,
    ok = true,
}: {
    label: string;
    value: number;
    of?: string;
    ok?: boolean;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-xs tabular-nums",
                ok
                    ? "border-border-subtle bg-surface-elevated text-text"
                    : "border-danger bg-danger-soft text-danger-strong"
            )}
        >
            <span className="text-text-muted">{label}</span>
            <span className="text-sm font-semibold">{value}</span>
            {of && <span className="text-text-muted">{of}</span>}
        </span>
    );
}
