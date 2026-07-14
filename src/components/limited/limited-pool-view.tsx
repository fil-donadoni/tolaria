import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { groupPoolCards } from "./limitedPoolGrouping";

/** The viewer's own opened Sealed Pool (PRD #1107 story 17), grouped into
 *  counts. Only ever receives the viewer's own seat's `pool` — every other
 *  seat's is stripped by `projectLimitedEvent` before it reaches the client
 *  (ADR 0054/0055), so there is no privacy check to do here. */
export default function LimitedPoolView({
    pool,
}: {
    pool: LimitedPoolCard[];
}) {
    const grouped = groupPoolCards(pool);

    if (grouped.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                No Pool has been generated for your seat yet.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <p className="text-xs text-text-muted">
                {pool.length} card{pool.length === 1 ? "" : "s"} opened.
            </p>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {grouped.map((card) => (
                    <li
                        key={card.cardId}
                        className="flex items-center justify-between text-sm"
                    >
                        <span className="truncate text-text">
                            {card.cardName}
                        </span>
                        <span className="ml-2 shrink-0 text-xs text-text-muted">
                            ×{card.count}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
