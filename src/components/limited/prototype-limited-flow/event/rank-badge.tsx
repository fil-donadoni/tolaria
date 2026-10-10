// PROTOTYPE — throwaway. Rank as a medal disc (gold/silver/bronze), plain
// number below the podium.
import { cn } from "~/lib/utils";

const MEDAL = [
    "bg-gradient-to-b from-amber-200 to-amber-500 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,0.35)]",
    "bg-gradient-to-b from-slate-100 to-slate-400 text-slate-900",
    "bg-gradient-to-b from-orange-300 to-orange-700 text-orange-950",
];

export default function RankBadge({ rank }: { rank: number }) {
    return (
        <span
            className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                MEDAL[rank - 1] ?? "border border-border-strong text-text-muted"
            )}
        >
            {rank}
        </span>
    );
}
