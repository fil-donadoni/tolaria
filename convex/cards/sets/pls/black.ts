// PLS (Planeshift) — black cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Warped Devotion — {2}{B} Enchantment. "Whenever a permanent is returned to
// a player's hand, that player discards a card." (CR 603.2 triggered
// ability; issue #1940, parent PRD #1935.) `PERMANENT_LEFT` (CR 603.10)
// already IS the battlefield-departure event — it's emitted for every
// battlefield→(graveyard|exile|hand|library) transition and already carries
// `toZone` and `ownerId` — so a bounce to hand is just
// `leftTrigger({ toZone: "hand" })`; no dedicated event was needed (ADR 0001
// assigns one event per zone of ORIGIN — the battlefield — not one per
// destination). `scope: "any"` makes it fire symmetrically on EITHER
// player's bounce (Warped Devotion says "a permanent", not "a permanent you
// control"), and the discarding player is read off the LEAVING permanent's
// owner (CR 108.3 — always returned to the owner's hand) via a new
// `EVENT_FIELD_REGISTRY` row (`PERMANENT_LEFT.ownerId`, ADR 0049) —
// `{ ref: "$event.ownerId" }` — rather than `ctx.controller`, since the
// discarding player need not be this ability's own controller. That keeps
// the ability a pure Effect Script — no `resolve()` needed. The discard is
// the discarding player's own choice (`choice(kind: "choose-hand-card")`),
// never engine-auto-picked, per the project's sacrifice/discard-choice
// convention; an empty hand clamps the choice to zero candidates (CR
// 608.2b) and the ability quietly does nothing, matching "discard a card"
// against no cards to discard.
//
// Divergence from the issue spec (owner-arbitrated): #1940's original text
// assumed no engine event covered "returned to hand" and asked for a new
// `PERMANENT_RETURNED_TO_HAND` event. Review read `gre/state.ts` and found
// `PERMANENT_LEFT` already covers exactly this case (it already fires with
// `toZone: "hand"` and already carries `ownerId`); the new event would have
// been strictly weaker (no `cause` / `causerControllerId` / `wasAura` /
// LKI attachment fields) and created a latent double-fire trap for any
// future card whose ability listens for both events. This ships as a
// `leftTrigger` reuse plus the one missing `ownerId` field row instead.
export const warpedDevotion: CardDefinition = {
    id: "3bce620f-799a-4ad8-9edb-6fb3d9ea1cc6", // PLS 57
    name: "Warped Devotion",
    rarity: "uncommon",
    oracleText:
        "Whenever a permanent is returned to a player's hand, that player discards a card.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        leftTrigger({
            id: "warped-devotion-bounce",
            oracleText:
                "Whenever a permanent is returned to a player's hand, that player discards a card.",
            scope: "any",
            toZone: "hand",
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
