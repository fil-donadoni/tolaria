import { flyCard } from "~/lib/cardFly";

/** The two deck zones a card travels between — the `data-deck-pane` /
 *  `data-deck-pane-tab` ids `deck-zones-surface.tsx` and `deck-pane-tab.tsx`
 *  render. */
export type DeckFlyZone = "maindeck" | "sideboard";

function copySelector(zone: DeckFlyZone, copyKey: string): string {
    return `[data-deck-pane="${zone}"] [data-card-copy="${CSS.escape(copyKey)}"]`;
}

/**
 * Flies one deck-builder card from `from` to `to` (issue #5395). `copyKey` is
 * the tile's `data-card-copy` — the `pinKey`, or the `cardId` for a copy
 * without one (`deck-card-tile.tsx`) — which a move carries unchanged
 * (`deckSideboard.ts`), so the same key finds the card on both sides.
 *
 * Call it immediately BEFORE applying the move: it measures the source now and
 * the landing after the commit. The destination zone's Pane Tab is the
 * stand-in for a pane that is off screen (portrait's snap strip).
 */
export function flyDeckCard(
    from: DeckFlyZone,
    to: DeckFlyZone,
    copyKey: string
): void {
    flyCard(document.querySelector(copySelector(from, copyKey)), {
        destination: () => document.querySelector(copySelector(to, copyKey)),
        standIn: () => document.querySelector(`[data-deck-pane-tab="${to}"]`),
    });
}
