import type { Reason } from "@convex/formats";
import { FORMAT_RULES } from "@convex/formats";
import type { AutoBuiltDeck } from "@convex/limited/autoBuild";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import { assignPoolCopies } from "@convex/limited/poolArrangement";
import type { ZoneCard } from "~/types/game";
import { countBasicLandCopies } from "./basicLands";
import type { WorkingDeck } from "./deckBuilderVariant";
import { toZoneCards } from "./poolZoneCards";

/** The working deck an Auto-Build suggestion becomes (issue #9976): the
 *  server's `{ cardId, cardName }` lists re-attached to PHYSICAL Pool copies by
 *  `assignPoolCopies` — the same once-per-open rebuild a saved deck goes
 *  through — so every Pool card keeps its `poolIndex` (Pins, printing) and the
 *  builder's "Main + Side equals the Pool" invariant holds. Basics the builder
 *  added match no Pool copy and come back with no `poolIndex`, like a Basic
 *  added from the bar. The deck's name and Column Layout are the player's and
 *  stay. */
export function autoBuiltWorkingDeck(
    current: WorkingDeck,
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[],
    built: Pick<AutoBuiltDeck, "cards" | "sideboard">
): WorkingDeck {
    const identified = assignPoolCopies(pool, arrangement, built);
    return {
        ...current,
        cards: toZoneCards(identified.cards),
        sideboard: toZoneCards(identified.sideboard),
    };
}

/** The advisory reason raised while a Maindeck still looks like the raw Pool
 *  (issue #9976): over the Limited floor AND not one basic land. A draft opens
 *  with every pick in the Maindeck (`continuousWorkingDeck`), which reads LEGAL
 *  at 45 cards; this is what stops that pile passing as a built deck.
 *
 *  Chosen over opening on the Auto-Built suggestion because the builder never
 *  rewrites a player's cards behind their back — a deck they reopen, a
 *  Pool Arrangement they made during the draft — and the flag costs one
 *  derived line, no server round-trip at mount. Both conditions are needed:
 *  "over 40" alone flags a deliberate 41-card deck, "no basics" alone a
 *  legitimate 40-card deck of nonbasic lands. Trimming to 40 or adding a basic
 *  clears it. */
export function unbuiltPoolDeckReason(
    cards: readonly ZoneCard[]
): Reason | null {
    const { minMain } = FORMAT_RULES.limited;
    if (cards.length <= minMain) return null;
    const basics = Object.values(countBasicLandCopies(cards)).reduce(
        (sum, n) => sum + n,
        0
    );
    if (basics > 0) return null;
    return {
        code: "pool-not-built",
        message: `Deck not built yet: ${cards.length} cards and no basic lands. Press Auto-Build, or cut to ${minMain} and add basics.`,
    };
}
