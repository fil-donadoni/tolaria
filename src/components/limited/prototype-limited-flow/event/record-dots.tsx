// PROTOTYPE — throwaway. A match record as dots: wins green, losses red,
// unplayed rounds hollow.
import { cn } from "~/lib/utils";
import type { Record3 } from "./event-mock";

export default function RecordDots({
    record,
    rounds,
}: {
    record: Record3;
    rounds: number;
}) {
    const marks = [
        ...Array(record.w).fill("w"),
        ...Array(record.d).fill("d"),
        ...Array(record.l).fill("l"),
    ];
    while (marks.length < rounds) marks.push("-");
    return (
        <span className="flex items-center gap-1" aria-hidden>
            {marks.map((m, i) => (
                <span
                    key={i}
                    className={cn(
                        "size-2.5 rounded-full",
                        m === "w" && "bg-success",
                        m === "l" && "bg-danger",
                        m === "d" && "bg-text-muted",
                        m === "-" && "border border-border-strong"
                    )}
                />
            ))}
        </span>
    );
}
