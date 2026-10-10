// PROTOTYPE — throwaway. One seat on the circular table: the avatar sits ON
// the ring point, badges hang off it (queued packs while drafting like
// Arena, deck-in check while building, crown when finished), name + deck
// colours + record hang below.
import { Check, Crown, Layers } from "lucide-react";
import { cn } from "~/lib/utils";
import ManaPips from "./mana-pips";
import SeatAvatar from "./seat-avatar";
import { recordText, type EventPhase, type MockSeat } from "./event-mock";

export default function RingSeat({
    seat,
    phase,
    x,
    y,
    viewerIsVisitor,
    onJoin,
    dense = false,
}: {
    seat: MockSeat;
    phase: EventPhase;
    /** Percent coordinates of the avatar centre. */
    x: number;
    y: number;
    viewerIsVisitor: boolean;
    onJoin: () => void;
    /** Small ring (phone dialog): smaller avatar, no secondary captions. */
    dense?: boolean;
}) {
    const empty = seat.kind === "empty";
    return (
        <div
            className={cn(
                "absolute flex -translate-x-1/2 flex-col items-center",
                dense
                    ? "w-[4.25rem] -translate-y-4 gap-0.5"
                    : "w-[5.5rem] -translate-y-[1.375rem] gap-1"
            )}
            style={{ left: `${x}%`, top: `${y}%` }}
            data-seat-index={seat.seatIndex}
        >
            <span className="relative">
                <SeatAvatar seat={seat} size={dense ? "sm" : "md"} />
                {phase === "drafting" && seat.queued > 0 && (
                    <span
                        className={cn(
                            "absolute -right-2 -top-1.5 flex items-center gap-0.5 rounded-full border px-1 py-px text-[10px] font-bold tabular-nums shadow",
                            seat.queued >= 3
                                ? "border-danger/70 bg-danger text-white"
                                : "border-amber-300/70 bg-amber-400 text-amber-950"
                        )}
                        title={`${seat.queued} packs queued`}
                    >
                        <Layers className="size-2.5" strokeWidth={3} />
                        {seat.queued}
                    </span>
                )}
                {phase === "building" && seat.hasDeck && (
                    <span
                        className="absolute -bottom-0.5 -right-1 flex size-4 items-center justify-center rounded-full bg-success text-white ring-2 ring-surface-base"
                        title="Deck in"
                    >
                        <Check className="size-2.5" strokeWidth={4} />
                    </span>
                )}
                {seat.placement === 1 && (
                    <Crown
                        className="absolute -top-3.5 left-1/2 size-4 -translate-x-1/2 fill-amber-400 text-amber-300 drop-shadow"
                        aria-label="Winner"
                    />
                )}
            </span>
            <span
                className={cn(
                    "max-w-full truncate rounded-full px-1.5 py-px leading-tight",
                    dense ? "text-[10px]" : "text-[11px]",
                    seat.isViewer
                        ? "bg-accent/20 font-semibold text-accent-strong"
                        : empty
                          ? "italic text-text-muted"
                          : seat.kind === "bot"
                            ? "text-text-muted"
                            : "font-medium text-parchment"
                )}
            >
                {seat.isViewer ? "You" : seat.name}
            </span>
            {empty &&
                phase === "waiting" &&
                (viewerIsVisitor ? (
                    <button
                        type="button"
                        onClick={onJoin}
                        className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-surface-base hover:brightness-110"
                    >
                        Sit here
                    </button>
                ) : dense ? null : (
                    <span className="text-[9px] uppercase tracking-wide text-text-disabled">
                        bot at start
                    </span>
                ))}
            {(seat.colors.length > 0 || seat.record) && (
                <span className="flex items-center gap-1">
                    <ManaPips colors={seat.colors} size="xs" />
                    {seat.record && (
                        <span className="rounded-sm bg-surface-base/80 px-1 text-[10px] font-semibold tabular-nums text-parchment">
                            {recordText(seat.record)}
                        </span>
                    )}
                </span>
            )}
        </div>
    );
}
