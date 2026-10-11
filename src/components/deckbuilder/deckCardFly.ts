import { flyCard } from "~/lib/cardFly";
import type { DeckPaneId } from "./deckPanes";

/** The two deck zones a card travels between — the `data-deck-pane` /
 *  `data-deck-pane-tab` ids `deck-zones-surface.tsx` and `deck-pane-tab.tsx`
 *  render. */
export type DeckFlyZone = "maindeck" | "sideboard";

/** A Maindeck card can sit in one of the two band panes (issue #5400), whose
 *  `data-deck-pane` ids all start with the zone's. */
function copySelector(zone: DeckFlyZone, copyKey: string): string {
    return `[data-deck-pane^="${zone}"] [data-card-copy="${CSS.escape(copyKey)}"]`;
}

/**
 * Flies one deck-builder card from `from` to `to` (issue #5395). `copyKey` is
 * the tile's `data-card-copy` — the `pinKey`, or the `cardId` for a copy
 * without one (`deck-card-tile.tsx`) — which a move carries unchanged
 * (`deckSideboard.ts`), so the same key finds the card on both sides.
 *
 * Call it immediately BEFORE applying the move: it measures the source now and
 * the landing after the commit. The destination zone's Pane Tab is the
 * stand-in for a pane that is off screen (portrait's snap strip), and it pulses
 * when the card arrives. `toPane` names that tab when the zone has several
 * (the Maindeck's Creatures / Non-creatures tabs, `maindeckPaneIdFor`).
 */
export function flyDeckCard(
    from: DeckFlyZone,
    to: DeckFlyZone,
    copyKey: string,
    toPane: DeckPaneId = to
): void {
    flyCard(document.querySelector(copySelector(from, copyKey)), {
        destination: () => document.querySelector(copySelector(to, copyKey)),
        standIn: () =>
            document.querySelector(`[data-deck-pane-tab="${toPane}"]`),
    });
}
