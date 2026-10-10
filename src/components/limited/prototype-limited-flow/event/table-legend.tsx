// PROTOTYPE — throwaway. Variant C: the ring's seats as a legend list,
import type { ReactNode } from "react";
// table order from you, with the phase's per-seat status.
import { Check, Crown, Hourglass, Layers } from "lucide-react";
import { cn } from "~/lib/utils";
import ManaPips from "./mana-pips";
import SeatAvatar from "./seat-avatar";
import { recordText, type MockSeat } from "./event-mock";
import type { EventProto } from "./use-event-proto";

function seatStatus(s: MockSeat, p: EventProto): ReactNode {
    switch (p.phase) {
        case "waiting":
            return s.kind === "empty" ? (
                <span className="text-text-disabled">open</span>
            ) : (
                <span className="text-success-strong">seated</span>
            );
        case "drafting":
            return (
                <span className="flex items-center gap-1 tabular-nums">
                    {s.picked}
                    <Layers
                        className={cn(
                            "ml-1 size-3",
                            s.queued >= 3
                                ? "text-danger-strong"
                                : s.queued
                                  ? "text-amber-300"
                                  : "text-text-disabled"
                        )}
                    />
                    {s.queued}
                </span>
            );
        case "building":
            return s.hasDeck ? (
                <Check className="size-3.5 text-success" />
            ) : (
                <Hourglass className="size-3.5 text-text-disabled" />
            );
        case "playing":
            return (
                <span className="tabular-nums text-parchment">
                    {recordText(s.record)}
                </span>
            );
        case "finished":
            return (
                <span className="flex items-center gap-1 tabular-nums text-parchment">
                    {s.placement === 1 && (
                        <Crown className="size-3 text-amber-300" />
                    )}
                    #{s.placement}
                </span>
            );
    }
}

export default function TableLegend({
    p,
    className,
}: {
    p: EventProto;
    className?: string;
}) {
    return (
        <ol className={cn("flex flex-col gap-1", className)}>
            {p.seats.map((s) => (
                <li
                    key={s.seatIndex}
                    className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-1 text-xs",
                        s.isViewer
                            ? "bg-accent/10"
                            : "hover:bg-surface-elevated/50"
                    )}
                >
                    <span className="w-3 text-right text-[10px] tabular-nums text-text-disabled">
                        {s.seatIndex + 1}
                    </span>
                    <SeatAvatar seat={s} size="xs" />
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate",
                            s.kind === "empty"
                                ? "italic text-text-muted"
                                : "text-parchment"
                        )}
                    >
                        {s.isViewer ? "You" : s.name}
                    </span>
                    <ManaPips colors={s.colors} size="xs" />
                    <span className="flex w-12 justify-end text-text-muted">
                        {seatStatus(s, p)}
                    </span>
                </li>
            ))}
        </ol>
    );
}
