export interface DeckStatsTypeListProps {
    title: string;
    /** `DeckStats.types` or `DeckStats.subtypes` — already-counted, this
     *  component only sorts and renders. */
    counts: Record<string, number>;
    /** Shown once under the title (e.g. the multi-type caveat). Omit for a
     *  list that needs none (subtypes). */
    note?: string;
}

/**
 * A plain count list in the Stats dialog (PRD #1617 § "Stats dialog", issue
 * #1631) — used for Subtypes, whose cardinality is too high (dozens of
 * creature types alone) to fit the 8-slot categorical chart palette the
 * card-Type band uses (`DeckStatsTypeBand`, issue #2586). Ordering:
 * count-descending, then alphabetical for ties. Sorting is presentation, not
 * statistics — `computeDeckStats` hands back a plain `Record<string, number>`
 * and never orders it.
 */
export default function DeckStatsTypeList({
    title,
    counts,
    note,
}: DeckStatsTypeListProps) {
    const entries = Object.entries(counts).sort(
        ([nameA, countA], [nameB, countB]) =>
            countB - countA || nameA.localeCompare(nameB)
    );

    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                {title}
            </h3>
            {note && <p className="text-xs text-text-muted">{note}</p>}
            {entries.length === 0 ? (
                <p className="text-sm text-text-muted">
                    No cards in the Maindeck yet.
                </p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {entries.map(([name, count]) => (
                        <li
                            key={name}
                            className="flex items-center justify-between gap-3 text-sm"
                        >
                            <span className="text-text">{name}</span>
                            <span className="text-text-muted">{count}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
