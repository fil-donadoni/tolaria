import { flyCard } from "~/lib/cardFly";
import type { DeckFlyZone } from "~/components/deckbuilder/deckCardFly";

/** The pick lands after one server round trip — two when it is filed to the
 *  Sideboard right after (`handlePickTo`). */
const PICK_LANDING_PATIENCE_MS = 2000;

/**
 * Flies a picked Booster card to the Pool or the Sideboard (issue #5397, PRD
 * #5384), on the shared card fly (`cardFly.ts`). `poolIndex` is the new card's
 * place in the append-only pool — its `pinKey`, the `data-card-copy` its tile
 * will carry (`deckCardFly.ts`). Call it immediately BEFORE submitting the
 * pick; it never defers or gates the pick, and the next Booster renders as
 * soon as the server answers.
 *
 * On a phone the Pool/Sideboard pane may be off screen: the strip half that
 * stands for that zone (`DraftPoolStrip`) takes the flight instead.
 */
export function flyDraftPick(
    pickId: string,
    to: DeckFlyZone,
    poolIndex: number
): void {
    flyCard(
        document.querySelector(
            `[data-draft-pick-tile][data-pick-id="${CSS.escape(pickId)}"]`
        ),
        {
            destination: () =>
                document.querySelector(
                    `[data-deck-pane="${to}"] [data-card-copy="${poolIndex}"]`
                ),
            standIn: () =>
                document.querySelector(
                    `[data-slot="draft-strip-drop"][data-zone="${to}"]`
                ),
            patienceMs: PICK_LANDING_PATIENCE_MS,
        }
    );
}
