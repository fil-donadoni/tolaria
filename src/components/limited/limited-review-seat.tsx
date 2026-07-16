import type {
    LimitedEventSeatView,
    LimitedEventView,
} from "~/hooks/useLimitedEvent";
import { groupPoolCards } from "./limitedPoolGrouping";

/** One Seat's full post-mortem study card (PRD #1107 story 26, issue #1116):
 *  its built Deck (a human's `humanDeck` or a bot's `autoBuiltDeck` — never
 *  both) plus its Pool. Only ever rendered once the event is `completed`
 *  (`LimitedReviewPanel` gates this) — `seat.pool`/`seat.humanDeck` are the
 *  wire fields the server projection ONLY populates for every seat at that
 *  point (`convex/limited/eventProjection.ts`'s full-disclosure reveal). */
export default function LimitedReviewSeat({
    seat,
    eventType,
}: {
    seat: LimitedEventSeatView;
    eventType: LimitedEventView["type"];
}) {
    const label = seat.isBot
        ? (seat.nickname ?? "Bot Drafter")
        : (seat.nickname ?? "Open seat");
    const deck = seat.isBot ? seat.autoBuiltDeck : seat.humanDeck;
    const pool = seat.pool ?? [];
    // A DRAFT seat's `pool` array order IS its pick order (`applyPick`
    // appends one entry per Pick, never reorders) — numbered directly, no
    // separate "pick order" field on the wire.
    const isDraft = eventType === "draft";

    return (
        <div className="flex flex-col gap-2 rounded-sm border border-border-subtle/40 p-3">
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
                {deck && (
                    <span className="text-xs text-text-muted">
                        {deck.colors.join("/")} — {deck.cards.length} maindeck /{" "}
                        {deck.sideboard.length} sideboard
                    </span>
                )}
            </div>

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
    );
}
