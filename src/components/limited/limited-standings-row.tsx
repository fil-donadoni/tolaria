import { Medal } from "lucide-react";
import ManaSymbol from "~/components/cards/mana-symbol";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";

export const STANDINGS_COLUMNS = "2rem minmax(0,1fr) 3rem 4.5rem 3.5rem 6rem";

const MEDAL_TONE = [
    "text-accent-strong",
    "text-text",
    "text-text-muted",
] as const;

function formatPct(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/** One standings row (issue #5391): rank (medal for the top three), avatar,
 *  name with a Bot tag, the seat's deck colours as mana symbols (from the
 *  ungated `seat.deckSummary` every seat carries — bots included), record,
 *  game-win %, an OMW% bar and points. Below `sm` the stat cells fold under
 *  the name (`sm:contents` flattens them back into the grid). A seat with no
 *  deck yet (`deckSummary === null`) renders no symbols and no placeholder. */
export default function LimitedStandingsRow({
    row,
    seat,
    rank,
}: {
    row: LimitedEventView["standings"][number];
    seat: LimitedEventView["seats"][number] | undefined;
    rank: number;
}) {
    const label = seat
        ? seat.isBot
            ? (seat.nickname ?? "Bot Drafter")
            : (seat.nickname ?? "Open seat")
        : `Seat ${row.seatIndex + 1}`;
    const colors = seat?.deckSummary?.colors ?? [];
    const medalTone = rank <= 3 ? MEDAL_TONE[rank - 1] : null;

    return (
        <div
            data-testid="standings-row"
            data-seat-index={row.seatIndex}
            data-is-viewer={seat?.isViewer ?? false}
            className={cn(
                "grid grid-cols-[2rem_minmax(0,1fr)_3rem] items-center gap-x-2 gap-y-1 border-b border-border-subtle/20 px-2 py-1.5 text-xs last:border-b-0 sm:min-w-[34rem] sm:grid-cols-[var(--standings-cols)]",
                seat?.isViewer && "bg-accent/5"
            )}
            style={
                { "--standings-cols": STANDINGS_COLUMNS } as React.CSSProperties
            }
        >
            <span
                data-slot="rank"
                className="flex items-center justify-center tabular-nums text-text-muted"
            >
                {medalTone ? (
                    <Medal
                        data-slot="medal"
                        aria-label={`Rank ${rank}`}
                        className={cn("size-4", medalTone)}
                    />
                ) : (
                    rank
                )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
                <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-subtle/60 bg-surface-base text-[10px] font-semibold uppercase text-text-muted"
                >
                    {label.slice(0, 2)}
                </span>
                <span
                    className={cn(
                        "min-w-0 truncate",
                        seat?.isViewer
                            ? "font-semibold text-accent-strong"
                            : "text-text"
                    )}
                >
                    {label}
                </span>
                {seat?.isBot && (
                    <span className="shrink-0 rounded-sm border border-border-subtle/60 px-1 text-[10px] tracking-wide uppercase text-text-muted">
                        Bot
                    </span>
                )}
                {seat?.isDropped && (
                    <span
                        data-slot="dropped-marker"
                        className="shrink-0 rounded-sm border border-border-subtle/60 px-1 text-[10px] tracking-wide uppercase text-text-muted"
                    >
                        Dropped
                    </span>
                )}
                {colors.length > 0 && (
                    <span
                        data-slot="deck-colors"
                        className="flex shrink-0 items-center gap-0.5"
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
            </span>
            <span className="text-right font-semibold tabular-nums text-text">
                {row.points}
                <span className="ml-0.5 text-[10px] font-normal text-text-muted sm:hidden">
                    pts
                </span>
            </span>
            <span className="col-span-3 col-start-1 row-start-2 flex items-center gap-3 pl-8 text-text-muted sm:contents">
                <span className="tabular-nums sm:text-right">
                    {row.matchWins}-{row.matchLosses}
                    {row.matchDraws > 0 ? `-${row.matchDraws}` : ""}
                </span>
                <span className="tabular-nums sm:text-right">
                    {formatPct(row.gameWinPct)}
                    <span className="ml-0.5 text-[10px] sm:hidden">GW</span>
                </span>
                <span
                    data-slot="omw"
                    className="flex items-center gap-1.5 tabular-nums"
                >
                    <span
                        aria-hidden="true"
                        className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-surface-base sm:flex-1"
                    >
                        <span
                            data-slot="omw-bar"
                            className="block h-full rounded-full bg-accent"
                            style={{
                                width: formatPct(row.opponentMatchWinPct),
                            }}
                        />
                    </span>
                    <span className="w-8 text-right">
                        {formatPct(row.opponentMatchWinPct)}
                    </span>
                </span>
            </span>
        </div>
    );
}
