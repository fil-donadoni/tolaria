// One archived Limited deck's full list, maindeck then sideboard, grouped by
// card name. Read-only; `getLimitedDeckAdmin` is `assertIsAdmin`-gated
// server-side (ADR 0033).
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";

function countByName(cards: readonly { cardName: string }[]) {
    const counts = new Map<string, number>();
    for (const { cardName } of cards) {
        counts.set(cardName, (counts.get(cardName) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function CardList({
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

export default function LimitedArchiveDeckDetail({
    deckId,
}: {
    deckId: Id<"userDecks">;
}) {
    const deck = useQuery(api.userDecks.getLimitedDeckAdmin, { deckId });

    if (deck === undefined || deck === null) {
        return (
            <Panel>
                <PanelBody>
                    <span className="text-sm text-text-muted">
                        {deck === null ? "Deck not found." : "Loading…"}
                    </span>
                </PanelBody>
            </Panel>
        );
    }

    return (
        <Panel>
            <PanelHeader
                title={deck.name}
                subtitle={`${deck.ownerNickname} · ${
                    deck.isLegal ? "legal" : "illegal"
                }`}
            />
            <PanelBody className="flex flex-col gap-4">
                {deck.reasons.length > 0 && (
                    <ul className="text-xs text-text-muted">
                        {deck.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                )}
                <CardList heading="Maindeck" cards={deck.cards} />
                {deck.sideboard.length > 0 && (
                    <CardList heading="Sideboard" cards={deck.sideboard} />
                )}
            </PanelBody>
        </Panel>
    );
}
