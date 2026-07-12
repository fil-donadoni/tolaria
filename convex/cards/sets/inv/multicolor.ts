// Invasion (INV) — multicolour (gold) cards, split by colour per ADR 0043.
// The registry's `import * as inv from "./sets/inv"` resolves through
// inv/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004).
//
// Invasion is the set that introduced the heavy multicolour theme (Domain,
// gold-card cycles); the walking-skeleton slice (parent PRD #1063) left this
// module empty ("sparse modules are accepted", ADR 0043). The Domain
// capability cluster (#1066) ships its two gold cards here.

import type { CardDefinition } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Ordered Migration — {3}{W}{U} Sorcery. "Domain — Create a 1/1 blue Bird
// creature token with flying for each basic land type among lands you
// control." (CR 111 / 701.7 token creation, CR 702 preamble Domain ability
// word, issue #1066.) `createToken`'s `count` is the ninth EffectValue
// grammar member `{ domain: { of } }` — no arithmetic, a straight reuse of
// the same value member Tribal Flames uses for `dealDamage`.
export const orderedMigration: CardDefinition = {
    id: "04d83a07-6054-45f1-bdf9-07f2006238d2",
    name: "Ordered Migration",
    rarity: "uncommon",
    oracleText:
        "Domain — Create a 1/1 blue Bird creature token with flying for each basic land type among lands you control.",
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "createToken",
            token: {
                name: "Bird",
                types: ["Creature"],
                subtypes: ["Bird"],
                power: 1,
                toughness: 1,
                colors: ["U"],
                staticAbilities: ["flying"],
            },
            controller: "controller",
            count: { domain: { of: "controller" } },
        },
    ],
};

// Coalition Victory — {3}{W}{U}{B}{R}{G} Sorcery. "You win the game if you
// control a land of each basic land type and a creature of each color."
// (CR 104.2a alternate win, CR 702 preamble Domain ability word (the land
// clause), issue #1066.) The marquee win condition, 100% DSL:
//
//   - the LAND clause is exactly "Domain == 5" (all five basic types
//     present) — a single `{ domain: { of: "controller" } } >= 5` check,
//     reusing the ninth EffectValue grammar member rather than five separate
//     land-subtype `count`s;
//   - the COLOR clause has no equivalent single scalar (no "Domain for
//     colors" ability word exists), so it is five NESTED `if`s, each a
//     `count` over `{ zone: "battlefield", filter: { type: "Creature", color:
//     X } }` — the EXISTING count/filter construct (no new value member). A
//     multicolour creature satisfies every color clause it matches
//     (`ctx.getColors` — layer-5-aware, `gre/state.ts` `getBattlefieldIds`);
//     colourless creatures satisfy none.
//
// The `winGame` Op itself carries no predicate (CR 104.2a: "a player CAN win
// as a result of a spell or ability" — the calling card's `if` chain is the
// gate, not the Op). Checked ONCE at resolution (CR 608.2c — the spell's
// instructions run top to bottom exactly once; a board state that stops
// satisfying the predicate a moment later doesn't retroactively un-resolve
// the win).
export const coalitionVictory: CardDefinition = {
    id: "dd8ad3aa-3225-45ae-8343-5991f5b52269",
    name: "Coalition Victory",
    rarity: "rare",
    oracleText:
        "You win the game if you control a land of each basic land type and a creature of each color.",
    manaCost: { X: 3, W: 1, U: 1, B: 1, R: 1, G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "if",
            predicate: {
                left: { domain: { of: "controller" } },
                op: "ge",
                right: 5,
            },
            then: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Creature", color: "W" },
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            type: "Creature",
                                            color: "U",
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            count: {
                                                zone: "battlefield",
                                                controller: "controller",
                                                filter: {
                                                    type: "Creature",
                                                    color: "B",
                                                },
                                            },
                                        },
                                        op: "ge",
                                        right: 1,
                                    },
                                    then: [
                                        {
                                            op: "if",
                                            predicate: {
                                                left: {
                                                    count: {
                                                        zone: "battlefield",
                                                        controller:
                                                            "controller",
                                                        filter: {
                                                            type: "Creature",
                                                            color: "R",
                                                        },
                                                    },
                                                },
                                                op: "ge",
                                                right: 1,
                                            },
                                            then: [
                                                {
                                                    op: "if",
                                                    predicate: {
                                                        left: {
                                                            count: {
                                                                zone: "battlefield",
                                                                controller:
                                                                    "controller",
                                                                filter: {
                                                                    type: "Creature",
                                                                    color: "G",
                                                                },
                                                            },
                                                        },
                                                        op: "ge",
                                                        right: 1,
                                                    },
                                                    then: [
                                                        {
                                                            op: "winGame",
                                                            player: "controller",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
