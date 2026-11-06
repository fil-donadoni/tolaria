// A deck zone (maindeck or sideboard) of the Limited Deck Archive, grouped by
// card name. Presentational.
function countByName(cards: readonly { cardName: string }[]) {
    const counts = new Map<string, number>();
    for (const { cardName } of cards) {
        counts.set(cardName, (counts.get(cardName) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function LimitedArchiveCardList({
    heading,
    cards,
}: {
    heading: string;
    cards: readonly { cardName: string }[];
}) {
    return (
        <section>
            <h3 className="text-label">
                {heading} ({cards.length})
            </h3>
            <ul className="mt-1 text-sm text-text">
                {countByName(cards).map(([name, count]) => (
                    <li key={name}>
                        {count} {name}
                    </li>
                ))}
            </ul>
        </section>
    );
}
