import { Crown } from "lucide-react";
import ManaSymbol from "~/components/cards/mana-symbol";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import type { RingPhaseFacts } from "~/lib/limitedTableRing";
import { cn } from "~/lib/utils";

/** One seat on the table ring. Humans (solid frame), bots (⌁ glyph, muted)
 *  and open seats (dashed frame, "open seat") read distinctly; the badges
 *  under the name follow the event phase (`RingPhaseFacts`): queued packs
 *  while drafting, deck colours as mana symbols from Deckbuilding on, the
 *  record while Games run, a crown on the winner at the end. Every figure is
 *  already public on the projection — a count or a colour set, never a
 *  hidden pack or deck list. */
export default function LimitedTableRingSeat({
    seat,
    facts,
    record,
}: {
    seat: LimitedEventSeatView;
    facts: RingPhaseFacts;
    record: string | null;
}) {
    const kind = seat.isBot
        ? "bot"
        : seat.userId !== undefined
          ? "human"
          : "open";
    const name =
        kind === "open"
            ? "Open seat"
            : (seat.nickname ??
              (kind === "bot" ? "Bot Drafter" : `Seat ${seat.seatIndex + 1}`));
    const isWinner = facts.winnerSeatIndex === seat.seatIndex;
    const colors = seat.deckSummary?.colors ?? [];

    return (
        <div
            data-seat-index={seat.seatIndex}
            data-seat-kind={kind}
            data-is-viewer={seat.isViewer ? "true" : "false"}
            data-is-winner={isWinner ? "true" : "false"}
            className="flex w-20 flex-col items-center gap-0.5 text-center sm:w-24"
        >
            <span
                aria-hidden="true"
                className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold tracking-wide uppercase",
                    kind === "open"
                        ? "border-dashed border-border-subtle/50 text-text-disabled"
                        : kind === "bot"
                          ? "border-border-subtle/60 bg-surface-base text-text-muted"
                          : "border-border-accent/50 bg-surface-elevated text-parchment",
                    seat.isViewer && "ring-2 ring-accent/60"
                )}
            >
                {kind === "open" ? "–" : name.slice(0, 2)}
                {isWinner && (
                    <Crown
                        data-slot="winner-mark"
                        className="absolute -top-3 h-4 w-4 text-accent-strong"
                    />
                )}
            </span>
            <span
                className={cn(
                    "w-full truncate text-xs",
                    kind === "open"
                        ? "text-text-muted italic"
                        : "font-medium text-text"
                )}
            >
                {name}
                {kind === "bot" && (
                    <span className="ml-1 text-text-disabled" title="Bot">
                        ⌁<span className="sr-only"> (bot)</span>
                    </span>
                )}
                {seat.isViewer && (
                    <span className="ml-1 text-accent-strong">(you)</span>
                )}
            </span>
            {facts.showQueued && seat.poolCount !== null && (
                <span
                    data-slot="picked"
                    className="text-[10px] tabular-nums text-text-muted"
                >
                    {seat.poolCount} picked
                </span>
            )}
            {facts.hint === "deckbuilding" && kind !== "open" && (
                <span
                    data-slot="deck-ready"
                    className="text-[10px] text-text-muted"
                >
                    {seat.hasDeck ? "Deck ready" : "Building"}
                </span>
            )}
            {facts.showQueued && seat.packQueueCount !== null && (
                <span
                    data-slot="queued-packs"
                    className="rounded-full border border-border-subtle/50 px-1.5 text-[10px] tabular-nums text-text-muted"
                >
                    {seat.packQueueCount} queued
                </span>
            )}
            {facts.showColors && colors.length > 0 && (
                <span
                    data-slot="deck-colors"
                    className="flex items-center gap-0.5"
                >
                    {colors.map((color) => (
                        <ManaSymbol
                            key={color}
                            symbol={color}
                            className="size-3.5"
                        />
                    ))}
                </span>
            )}
            {facts.showRecord && record !== null && (
                <span
                    data-slot="seat-record"
                    className="text-[10px] tabular-nums text-text-muted"
                >
                    {record}
                </span>
            )}
        </div>
    );
}
