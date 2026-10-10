// PROTOTYPE — throwaway. The event's identity chips: type · source, Games
// Format, seats, pick timer.
import { cn } from "~/lib/utils";
import { EVENT_META } from "./event-mock";

export default function EventChips({ className }: { className?: string }) {
    const chips = [
        `${EVENT_META.type} · ${EVENT_META.source}`,
        EVENT_META.gamesFormat,
        `${EVENT_META.seatCount} seats`,
        EVENT_META.pickTimer,
    ];
    return (
        <span className={cn("flex flex-wrap gap-1.5", className)}>
            {chips.map((c, i) => (
                <span
                    key={c}
                    className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                        i === 1
                            ? "border-accent/60 bg-accent/15 text-accent-strong"
                            : "border-[var(--hairline-strong)] bg-surface-base/70 text-parchment"
                    )}
                >
                    {c}
                </span>
            ))}
        </span>
    );
}
