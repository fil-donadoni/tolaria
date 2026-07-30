// lrw — colorless cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004). Lands and colourless artifacts (no coloured cost)
// live here per the colour-split convention.

import type { CardDefinition } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shelldock Isle (issue #783) — the Hideaway (CR 702.75) proving card.
//
// Three separate abilities, exactly as the Oracle text prints them:
//   1. `hideaway 4` — a KEYWORD string only. The ETB "look at the top four
//      cards of your library, exile one face down, then put the rest on the
//      bottom in a random order" trigger is injected implicitly by
//      `expandHideaway` (convex/cards/abilities/hideaway.ts) at the
//      `getDefinition` seam (ADR 0054), so it is never spelled out here.
//   2. `entersTapped` — CR 702.75b: hideaway does NOT tap the permanent. Cards
//      printed with a bare "Hideaway" were errataed to `Hideaway 4` PLUS a
//      SEPARATE "this land enters tapped" ability, which is this data flag —
//      never folded into the keyword.
//   3. The two activated abilities: the mana ability, and the CR 607 LINKED
//      "play the exiled card" ability. The latter reaches exactly the card
//      hideaway exiled via `castDuringResolution`'s `{ exiledWithSource: true }`
//      selector (the link `linkExileToSource` stamped at exile time) — no
//      target, no picker, nothing to disambiguate — and plays it DURING its own
//      resolution (CR 608.2g), the timing that makes the card what it is.
//
// "if a library has twenty or fewer cards in it" is ANY library, the
// controller's included (the Oracle's indefinite article) — expressed as the
// SMALLEST library size across all players compared against 20, which is
// exactly "some library has 20 or fewer cards in it".
// ─────────────────────────────────────────────────────────────────────────────
export const shelldockIsle: CardDefinition = {
    id: "4216656e-90e8-45fc-a0f6-0d0d79d0a021",
    rarity: "rare",
    name: "Shelldock Isle",
    oracleText:
        "Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {U}.\n{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.",
    manaCost: {},
    types: ["Land"],
    // CR 702.75 — the keyword string is the WHOLE declaration; the seam injects
    // the enforcing ETB trigger.
    staticAbilities: ["hideaway 4"],
    // CR 702.75b — a separate ability, not part of hideaway.
    entersTapped: true,
    activatedAbilities: [
        {
            id: "shelldock-isle-mana",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false, // mana ability (CR 605.3a)
            effect: (ctx) => ctx.addMana({ U: 1 }),
        },
        {
            id: "shelldock-isle-play-hidden",
            oracleText:
                "{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.",
            cost: { mana: { U: 1 }, tap: true },
            useStack: true, // not a mana ability — uses the stack (CR 602.2)
            effects: [
                {
                    op: "if",
                    // CR 122 — the minimum library size across all players; the
                    // Oracle's "a library" is ANY library, this player's own
                    // included.
                    predicate: {
                        left: {
                            count: {
                                zone: "library",
                                smallestAcrossPlayers: true,
                            },
                        },
                        op: "le",
                        right: 20,
                    },
                    then: [
                        {
                            // CR 607 / 702.75a — the LINKED half: reaches only
                            // the card this land's own hideaway ability exiled,
                            // named by the CR 607 link (a `bind` cannot span the
                            // two abilities' separate resolutions).
                            //
                            // CR 608.2g — "you may play the exiled card" states
                            // NO duration, so the permission exists only during
                            // THIS ability's resolution: the card is offered
                            // right here, once, and the window closes when the
                            // resolution ends. Card-type timing restrictions do
                            // not apply (CR 117.1a / 302.1 / 307.1 grant their
                            // permissions to a player WHO HAS PRIORITY, and this
                            // happens outside priority) — which is the card's
                            // whole point: flashing in a Wrath of God or a
                            // Cryptic Command on the OPPONENT's turn.
                            //
                            // `includesLand` — the Oracle says "play", not
                            // "cast" (CR 116.2a / 305.9), so a hidden LAND is
                            // offered too. Its branch is narrower by CR 305: it
                            // consumes the land drop (305.2a), and it is not
                            // offered on the opponent's turn (305.3) or with the
                            // drop spent (305.2b) — in which case the resolution
                            // just completes.
                            op: "castDuringResolution",
                            card: { exiledWithSource: true },
                            player: "controller",
                            source: "exile",
                            free: true,
                            includesLand: true,
                        },
                    ],
                },
            ],
        },
    ],
};
