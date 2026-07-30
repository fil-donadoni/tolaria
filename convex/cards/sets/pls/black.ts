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

// Noxious Vapors — {1}{B}{B} Sorcery. "Each player reveals their hand,
// chooses one card of each color from it, then discards all other nonland
// cards." (CR 601.2b / 701.9, issue #1945, parent PRD #1935.) Symmetric —
// every clause runs once per side, in APNAP order (CR 101.4), each acting on
// their OWN hand only.
//
// TWO sibling `forEach { set: "players" }` blocks, not one, because the
// Oracle sequencing is "each player reveals their hand, [then] chooses …":
// ALL reveals precede ANY choice. Folding them into one loop would let the
// active player choose before the opponent's hand was revealed, deciding with
// less information than the card grants. The first loop only reveals (CR
// 701.20a); the second raises the per-player pick. Splitting is safe across
// the suspend/resume protocol precisely because the interpreter checkpoints
// each Op's own position — the reveal loop is not re-run when the choice loop
// suspends.
//
// The pick itself: `chooseCategorized` offers the five colours as categories
// (`{ color: "W"|"U"|"B"|"R"|"G" }`), `onPicked: "keep"` (a kept pick just
// survives — no move), and `sweep` discards every OTHER nonland card
// (`excludeType: "Land"` — deliberately BROADER than the categorization
// domain: a colourless nonland card matches no colour category, so it can
// never be picked, yet it is still swept; a land is never swept even if
// uncategorized). One card may be the card chosen for SEVERAL of its colours
// — a WU gold card can answer both white and blue, keeping only it — so the
// pick is validated by `categorizedPick.ts`'s COVER rule and its floor is the
// smallest covering set, not the maximum matching. A colour with no matching
// card in hand is simply not filled (CR 608.2b). Mandatory ("chooses", not
// "may choose") — `optional` defaults to false.
export const noxiousVapors: CardDefinition = {
    id: "e3cf9326-6e1c-4a05-abea-16d6b6cb2a6d", // PLS 49
    name: "Noxious Vapors",
    rarity: "uncommon",
    oracleText:
        "Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [{ op: "reveal", player: { ref: "$each" }, zone: "hand" }],
        },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "chooseCategorized",
                    player: { ref: "$each" },
                    zone: "hand",
                    categories: [
                        { label: "White", filter: { color: "W" } },
                        { label: "Blue", filter: { color: "U" } },
                        { label: "Black", filter: { color: "B" } },
                        { label: "Red", filter: { color: "R" } },
                        { label: "Green", filter: { color: "G" } },
                    ],
                    onPicked: "keep",
                    sweep: {
                        filter: { excludeType: "Land" },
                        action: "discard",
                    },
                    prompt: "Choose one card of each color to keep.",
                },
            ],
        },
    ],
};
