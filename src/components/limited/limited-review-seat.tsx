import type {
    LimitedEventSeatView,
    LimitedEventView,
} from "~/hooks/useLimitedEvent";
import { groupPoolCards } from "./limitedPoolGrouping";

/** One Seat's row in the compact "Review the Table" summary (PRD #1107 story
 *  26, issue #1116; redesigned issue #1583). Always shows a tidy summary line
 *  (seat, nickname, bot badge, deck colors, maindeck / sideboard counts) from
 *  the ungated `seat.deckSummary`. The debug detail — the built deck's card
 *  list and, for a Draft, the numbered pick order — is DEBUG-only: the server
 *  projection populates another seat's `pool`/`humanDeck` solely for an admin
 *  (`convex/limited/eventProjection.ts`), and this collapses it behind a
 *  per-seat `<details>` disclosure (collapsed by default) so a full table
 *  stays scannable. `showDetail` gates the disclosure to an admin viewer or
 *  the viewer's OWN seat — a bot seat's `autoBuiltDeck` is on the wire for the
 *  vs-AI hookup regardless, so presence of deck data alone must NOT reveal it. */
export default function LimitedReviewSeat({
    seat,
    eventType,
    isAdmin,
}: {
    seat: LimitedEventSeatView;
    eventType: LimitedEventView["type"];
    isAdmin: boolean;
}) {
    const label = seat.isBot
        ? (seat.nickname ?? "Bot Drafter")
        : (seat.nickname ?? "Open seat");
    const summary = seat.deckSummary;
    // Detail (built deck list + pick order) reveals for an admin viewer, or
    // for the viewer's own seat (they always keep access to their own data).
    const showDetail = isAdmin || seat.isViewer;
    const deck = seat.isBot ? seat.autoBuiltDeck : seat.humanDeck;
    const pool = seat.pool ?? [];
    // A DRAFT seat's `pool` array order IS its pick order (`applyPick`
    // appends one entry per Pick, never reorders) — numbered directly, no
    // separate "pick order" field on the wire.
    const isDraft = eventType === "draft";

    const summaryLine = (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                    Seat {seat.seatIndex + 1}
                </span>
                <span className="font-medium text-text">{label}</span>
                {seat.isBot && (
                    <span className="rounded-sm border border-border-subtle/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                        Bot
                    </span>
                )}
            </div>
            <span className="text-xs text-text-muted">
                {summary
                    ? `${summary.colors.join("/") || "—"} — ${summary.maindeckCount} maindeck / ${summary.sideboardCount} sideboard`
                    : "No deck"}
            </span>
        </div>
    );

    if (!showDetail) {
        return (
            <div className="rounded-sm border border-border-subtle/40 p-3">
                {summaryLine}
            </div>
        );
    }

    return (
        <details className="rounded-sm border border-border-subtle/40 p-3">
            <summary className="cursor-pointer list-none">
                {summaryLine}
            </summary>

            <div className="mt-3 flex flex-col gap-3">
                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                        Built Deck
                    </h4>
                    {deck ? (
                        <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                            {deck.cards.map((card, i) => (
                                <li
                                    key={`${card.cardId}-${i}`}
                                    className="truncate text-text"
                                >
                                    {card.cardName}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-text-muted">
                            No deck submitted.
                        </p>
                    )}
                </div>

                <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                        {isDraft
                            ? `Pick Order (${pool.length})`
                            : `Pool (${pool.length})`}
                    </h4>
                    {pool.length === 0 ? (
                        <p className="text-sm text-text-muted">No Pool.</p>
                    ) : isDraft ? (
                        <ol className="grid list-inside list-decimal grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                            {pool.map((card, i) => (
                                <li
                                    key={`${card.scryfallId}-${i}`}
                                    className="truncate text-text"
                                >
                                    {card.cardName}
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                            {groupPoolCards(pool).map((card) => (
                                <li
                                    key={card.cardId}
                                    className="flex items-center justify-between text-text"
                                >
                                    <span className="truncate">
                                        {card.cardName}
                                    </span>
                                    <span className="ml-2 shrink-0 text-xs text-text-muted">
                                        ×{card.count}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </details>
    );
}
