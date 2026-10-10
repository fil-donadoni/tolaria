// PROTOTYPE — throwaway. Phone (≤640px) stand-in for the circle: a tile with
// the seats as an avatar row + one-line read-out; tapping opens the full
// ring in a dialog.
import { useState } from "react";
import { ChevronRight, RotateCcw, RotateCw } from "lucide-react";
import GameDialog from "~/components/ui/game-dialog";
import { cn } from "~/lib/utils";
import SeatAvatar from "./seat-avatar";
import TableRing from "./table-ring";
import { tableSummary } from "./table-summary";
import { EVENT_META, passDirectionFor } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export default function TableCompactTile({
    p,
    className,
}: {
    p: EventProto;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const DirIcon =
        passDirectionFor(EVENT_META.draftPack) === "left"
            ? RotateCw
            : RotateCcw;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 px-3 py-2.5 text-left transition hover:border-accent/60",
                    className
                )}
            >
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        The table
                        {p.phase === "drafting" && (
                            <DirIcon className="size-3 text-accent-strong" />
                        )}
                        <span className="normal-case tracking-normal text-parchment">
                            {tableSummary(p)}
                        </span>
                    </span>
                    <span className="flex -space-x-1.5">
                        {p.seats.map((s) => (
                            <span key={s.seatIndex} className="relative">
                                <SeatAvatar
                                    seat={s}
                                    size="sm"
                                    className="ring-2 ring-surface"
                                />
                                {p.phase === "drafting" && s.queued > 0 && (
                                    <span className="absolute -right-0.5 -top-1 rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-tight text-amber-950">
                                        {s.queued}
                                    </span>
                                )}
                            </span>
                        ))}
                    </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-text-muted" />
            </button>
            <GameDialog
                open={open}
                onOpenChange={setOpen}
                title="The Table"
                subtitle={`${EVENT_META.seatCount} seats · ${tableSummary(p)}`}
                showCloseButton
                size="wide"
            >
                <TableRing
                    p={p}
                    radius={37}
                    className="w-[min(calc(100vw-6.5rem),26rem)]"
                />
            </GameDialog>
        </>
    );
}
