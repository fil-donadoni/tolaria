// PLS (Planeshift) — black cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { returnedToHandTrigger } from "../../abilities/triggers/returnedToHandTrigger";

// Warped Devotion — {2}{B} Enchantment. "Whenever a permanent is returned to
// a player's hand, that player discards a card." (CR 603.2 triggered
// ability; issue #1940, parent PRD #1935.) No engine event existed for "a
// permanent returned to hand" — PERMANENT_LEFT only exposes `toZone: "hand"`
// as one of four generic exits, with no dedicated `EVENT_FIELD_REGISTRY` row
// a DSL script could read the RETURNING player off. Per ADR 0001 (narrow,
// zone-of-origin-specific events, never a unified zone-change trigger) this
// ships as a new `PERMANENT_RETURNED_TO_HAND` event, emitted unconditionally
// alongside `PERMANENT_LEFT` from the same shared `removePermanentTo` funnel
// (`gre/state.ts`) — mirroring how `CREATURE_DIED` coexists with
// `PERMANENT_LEFT` — plus a new `EVENT_FIELD_REGISTRY` row (`ownerId`, ADR
// 0049) so `choice`/`discard`'s `player` can read
// `{ ref: "$event.ownerId" }` — the returning permanent's OWNER (CR 108.3 —
// always the owner's hand), i.e. "that player" — instead of `ctx.controller`.
// That keeps the ability a pure Effect Script even though it fires
// symmetrically on EITHER player's bounce (`scope: "any"`): no `resolve()`
// needed. The discard is the discarding player's own choice
// (`choice(kind: "choose-hand-card")`), never engine-auto-picked, per the
// project's sacrifice/discard-choice convention; an empty hand clamps the
// choice to zero candidates (CR 608.2b) and the ability quietly does
// nothing, matching "discard a card" against no cards to discard.
export const warpedDevotion: CardDefinition = {
    id: "3bce620f-799a-4ad8-9edb-6fb3d9ea1cc6", // PLS 57
    name: "Warped Devotion",
    rarity: "rare",
    oracleText:
        "Whenever a permanent is returned to a player's hand, that player discards a card.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        returnedToHandTrigger({
            id: "warped-devotion-bounce",
            oracleText:
                "Whenever a permanent is returned to a player's hand, that player discards a card.",
            scope: "any",
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: { ref: "$event.ownerId" },
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: { ref: "$event.ownerId" },
                    cards: { ref: "$discard" },
                },
            ],
        }),
    ],
};
