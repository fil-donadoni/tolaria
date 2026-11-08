// `transmuteAbility` — the declarative template for Transmute (CR 702.53), the
// keyword ability that trades a card in hand for another of the same mana
// value from the library.
//
// CR 702.53a: Transmute is an activated ability that functions only while the
//   card with transmute is in a player's hand. "Transmute [cost]" means
//   "[Cost], Discard this card: Search your library for a card with the same
//   mana value as the discarded card, reveal that card, and put it into your
//   hand. Then shuffle your library. Activate only as a sorcery."
//
// Built from seams that already exist, in the shape `cyclingAbility` set for
// the other discard-from-hand keyword (CR 702.29a) — nothing here is a new
// engine path:
//
//   - `activateFromHand: true` — "functions only while … in a player's hand";
//   - `cost.discardThis` — the discard leg, routed through the discard choke
//     point (CR 701.9) so "whenever you discard" triggers see it. NOT a
//     cycling cost: `cyclingCost` stays off, so a "when you cycle" trigger
//     never fires on a transmute discard (CR 702.29c);
//   - `sorcerySpeedOnly: true` — "Activate only as a sorcery" (CR 602.5d);
//   - the tutor-to-hand Effect Script typecycling already uses
//     (`choice`/search-library → `reveal` → `moveZone` → shuffle), filtered by
//     `manaValueEquals`.
//
// "The same mana value as the discarded card" is a NUMBER fixed by the card's
// printed mana cost: a card in a graveyard has the mana value of its printed
// cost (CR 202.3), which is exactly what the engine's own graveyard-card read
// (`getManaValue`, `graveyard-card` branch) computes from the definition. So
// the caller passes the printed mana value and the filter carries it as a
// literal — the reading Tolaria West's own reminder text prints ("a card with
// mana value 0").
//
// The Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) is the name
// authority: Transmute is row `id: "transmute"`.

import type { ActivatedAbility, ManaCost } from "../types";
import { keywordCostLabel } from "./keywordCostLabel";

/** The default ability id. A card never prints two transmute abilities, so it
 *  stays unique per card. */
export const TRANSMUTE_ABILITY_ID = "transmute";

/** Builds the Transmute activated ability (CR 702.53a) for a card whose printed
 *  transmute cost is `cost` and whose printed mana value is `manaValue`. Add
 *  the returned ability to the card's `activatedAbilities`. */
export function transmuteAbility(
    cost: ManaCost,
    manaValue: number,
    id = TRANSMUTE_ABILITY_ID
): ActivatedAbility {
    const label = keywordCostLabel(cost);
    return {
        id,
        oracleText: `Transmute ${label} (${label}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)`,
        // CR 702.53a — "[Cost], Discard this card".
        cost: { mana: cost, discardThis: true },
        // CR 702.53a — functions only while the card is in a player's hand.
        activateFromHand: true,
        // CR 605.1a — not a mana ability: it uses the stack.
        useStack: true,
        // CR 702.53a — "Activate only as a sorcery."
        sorcerySpeedOnly: true,
        effects: [
            // CR 701.23a / 701.23b — a genuine library search, which never
            // compels a find; the choice is raised even with no legal hit.
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { manaValueEquals: manaValue },
                count: { min: 0, max: 1 },
                prompt: `Search your library for a card with mana value ${manaValue} (or none).`,
                bind: "$transmuted",
            },
            // CR 702.53a — "reveal that card, and put it into your hand."
            {
                op: "reveal",
                player: "controller",
                cards: { ref: "$transmuted" },
            },
            {
                op: "moveZone",
                cards: { ref: "$transmuted" },
                player: "controller",
                from: "library",
                to: "hand",
            },
            // CR 702.53a — "Then shuffle your library." (CR 701.24)
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ],
    };
}
