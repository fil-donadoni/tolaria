import { Bot, ChevronDown, Lock } from "lucide-react";
import ManaSymbol from "~/components/cards/mana-symbol";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { SEAT_LOCKED_NOTE } from "~/lib/openDecklists";
import { cn } from "~/lib/utils";

/** The large, obvious header of one seat in the review (issue #5392): avatar,
 *  name, bot tag, deck colours as mana symbols, record, chevron. A locked seat
 *  has no button — it says when it unlocks and carries a lock instead. */
export default function LimitedReviewSeatTrigger({
    seat,
    record,
    locked,
    expanded,
    panelId,
    onToggle,
}: {
    seat: LimitedEventSeatView;
    record: string | null;
    locked: boolean;
    expanded: boolean;
    panelId: string;
    onToggle: () => void;
}) {
    const label = seat.isBot
        ? (seat.nickname ?? "Bot Drafter")
        : (seat.nickname ?? "Open seat");
    const colors = seat.deckSummary?.colors ?? [];

    const body = (
        <>
            <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border-subtle/60 bg-surface-base text-xs font-semibold uppercase text-text-muted"
            >
                {label.slice(0, 2)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                    <span
                        className={cn(
                            "truncate text-base font-semibold",
                            seat.isViewer
                                ? "text-accent-strong"
                                : "text-parchment"
                        )}
                    >
                        {seat.isViewer ? `${label} (you)` : label}
                    </span>
                    {seat.isBot && (
                        <span className="flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-elevated px-1 text-[10px] font-semibold tracking-wide uppercase text-text-muted">
                            <Bot className="size-3" aria-hidden /> Bot
                        </span>
                    )}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    {colors.length > 0 && (
                        <span
                            data-slot="deck-colors"
                            className="flex items-center gap-0.5"
                        >
                            {colors.map((color) => (
                                <ManaSymbol
                                    key={color}
                                    symbol={color}
                                    className="size-4"
                                />
                            ))}
                        </span>
                    )}
                    {record !== null && (
                        <span data-slot="seat-record" className="tabular-nums">
                            {record}
                        </span>
                    )}
                    {locked && (
                        <span className="italic">{SEAT_LOCKED_NOTE}</span>
                    )}
                </span>
            </span>
            <span
                className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full border transition",
                    locked
                        ? "border-border-strong text-text-disabled"
                        : expanded
                          ? "rotate-180 border-accent/60 bg-accent/15 text-accent-strong"
                          : "border-border-strong text-parchment"
                )}
            >
                {locked ? (
                    <Lock className="size-4" aria-hidden />
                ) : (
                    <ChevronDown className="size-5" aria-hidden />
                )}
            </span>
        </>
    );

    if (locked) {
        return (
            <div
                data-slot="review-seat-locked"
                className="flex w-full items-center gap-3 px-3 py-3 sm:px-4"
            >
                {body}
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-elevated/50 sm:px-4"
        >
            {body}
        </button>
    );
}
