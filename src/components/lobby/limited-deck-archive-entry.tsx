import { Link } from "@tanstack/react-router";
import type { LobbyDeck } from "~/lib/deckTypes";

function cardCountLabel(deck: LobbyDeck): string {
    const main = `${deck.cards.length} ${deck.cards.length === 1 ? "card" : "cards"}`;
    const side = deck.sideboard?.length ?? 0;
    return side > 0 ? `${main} + ${side} side` : main;
}

/** One deck of the Limited Deck Archive (issue #8409): name, card count and
 *  derived legality, with an illegal deck's reasons in the open rather than in
 *  a tooltip a phone cannot reach. The whole row opens the deck. */
export default function LimitedDeckArchiveEntry({ deck }: { deck: LobbyDeck }) {
    return (
        <li>
            <Link
                data-limited-archive-deck=""
                to="/decks/$slug"
                params={{ slug: deck.presetId }}
                className="flex h-full flex-col gap-1 rounded-sm border border-border-subtle bg-surface-elevated px-3 py-2.5 hover:border-border-accent/60"
            >
                <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-display text-sm tracking-wide text-parchment">
                        {deck.name}
                    </span>
                    {deck.isLegal ? (
                        <span className="shrink-0 text-[10px] font-semibold tracking-wide text-success-strong uppercase">
                            Legal
                        </span>
                    ) : (
                        <span className="shrink-0 rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-danger-strong uppercase">
                            Illegal
                        </span>
                    )}
                </span>
                <span className="text-xs text-text-muted">
                    {cardCountLabel(deck)}
                </span>
                {!deck.isLegal && deck.reasons.length > 0 && (
                    <ul className="text-xs text-text-muted">
                        {deck.reasons.map((reason) => (
                            <li key={reason.code + reason.message}>
                                {reason.message}
                            </li>
                        ))}
                    </ul>
                )}
            </Link>
        </li>
    );
}
