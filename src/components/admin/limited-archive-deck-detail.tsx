// One archived Limited deck's full list, maindeck then sideboard, grouped by
// card name. Read-only; `getLimitedDeckAdmin` is `assertIsAdmin`-gated
// server-side (ADR 0033).
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import LimitedArchiveCardList from "./limited-archive-card-list";

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
                            <li key={reason.code + reason.message}>
                                {reason.message}
                            </li>
                        ))}
                    </ul>
                )}
                <LimitedArchiveCardList heading="Maindeck" cards={deck.cards} />
                {deck.sideboard.length > 0 && (
                    <LimitedArchiveCardList
                        heading="Sideboard"
                        cards={deck.sideboard}
                    />
                )}
            </PanelBody>
        </Panel>
    );
}
