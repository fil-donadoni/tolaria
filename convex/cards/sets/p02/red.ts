// P02 — red cards, split by colour per ADR 0043. The registry's
// `import * as p02 from "./sets/p02"` resolves through p02/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Goblin Matron — {2}{R} 1/1 Goblin. "When this creature enters, you may
// search your library for a Goblin card, reveal that card, put it into your
// hand, then shuffle." (CR 603.6a ETB trigger; CR 701.23 search;
// CR 701.20a reveal; CR 701.24 shuffle.)
//
// The search template Elfhame Sanctuary (`inv/green.ts`) already exercises:
// a `choice` over the hidden library zone (the interpreter precomputes an
// explicit `candidateIds` allow-list from the filter, so the picker never
// leaks the rest of the library), then `reveal`, then `moveZone` out of the
// library into hand, then the mandatory shuffle. "You MAY search" is
// `count: { min: 0, max: 1 }` on the choice itself — a player who declines
// picks nothing, the binding stays uncaptured and every downstream Op skips
// (CR 608.2b) except the shuffle, which happens either way: the printed line
// shuffles as part of the search, not as part of finding something. The
// filter is the bare subtype — "a Goblin CARD", any type, not just a
// creature (Goblin Grenade and the Goblin lands are legal finds).
//
// compiler-gap: When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle. (#2693)
export const goblinMatron: CardDefinition = {
    id: "f99dc21c-8600-49bf-b0a3-c981f7ec7ac3", // P02 100
    rarity: "uncommon",
    name: "Goblin Matron",
    oracleText:
        "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "goblin-matron-tutor",
            oracleText:
                "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: "Goblin" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a Goblin card.",
                    bind: "$found",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$found" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        }),
    ],
};
