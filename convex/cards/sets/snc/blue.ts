// SNC — blue cards, split by colour per ADR 0043. The registry's
// `import * as snc from "./sets/snc"` resolves through snc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import {
    nthSpellThisTurn,
    spellCastTrigger,
} from "../../abilities/triggers/spellCastTrigger";

// Ledger Shredder — "Flying. Whenever a player casts their second spell each
// turn, this creature connives." (CR 701.50 connive: "draw a card, then
// discard a card; if a nonland card was discarded this way, put a +1/+1
// counter on that creature" — performed by THIS CREATURE'S CONTROLLER,
// regardless of who cast the triggering spell.) Shipped by issue #1343,
// closing the residue #1302 gap: the trigger condition needed a PER-PLAYER
// spell-cast-this-turn tally the engine didn't have (the pre-existing
// GLOBAL `GameState.spellsCastThisTurn` Storm counter, ADR 0052, can't
// distinguish "P1's 1st + P2's 1st spell" from "P1's 2nd spell").
// `PlayerState.spellsCastThisTurn` + `SpellCastEvent.casterSpellCountThisTurn`
// (gre/state.ts) now carry that per-caster tally, and `nthSpellThisTurn`
// (cards/abilities/triggers/spellCastTrigger.ts) is the reusable
// `spellCastTrigger.condition` reading it — `scope: "any"` + `nthSpellThisTurn(2)`
// is exactly "a player casts their second spell each turn".
//
// Connive is decomposed DSL-first (ADR 0045) rather than declared as a
// `staticAbilities` keyword — CR 701.50 is a keyword ACTION (a reusable
// effect template), not a static/triggered ability keyword, so it never
// appears in `staticAbilities[]`; the Effect Script below expresses its
// EFFECT directly with already-implemented Ops (`draw` / `choice` /
// `discard` / `counters`). The Mechanics Registry rows connive
// `status: "implemented"` with that composition as its binding (issue #780,
// the Investigate/Clue precedent: a keyword action shipped by primitive
// reuse is implemented, not planned). The "if you discarded a nonland card"
// gate is the new
// `picksMatchFilter` `if` predicate (issue #1343): true iff at least one
// picked card, resolved via the discarding player's graveyard (CR 701.9 —
// every discard lands there), matches `{ excludeType: "Land" }`.
export const ledgerShredder: CardDefinition = {
    id: "7ea4b5bc-18a4-45db-a56a-ab3f8bd2fb0d",
    name: "Ledger Shredder",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever a player casts their second spell each turn, this creature connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird", "Advisor"],
    power: 1,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "ledger-shredder-connive",
            oracleText:
                "Whenever a player casts their second spell each turn, this creature connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)",
            // CR 701.50a — "a player" is ANY caster, not just this
            // permanent's controller; the connive EFFECT still runs for
            // this creature's controller (the `player`/`target` refs below
            // resolve against `ctx.controller`, the source's controller —
            // never the triggering caster).
            scope: "any",
            condition: nthSpellThisTurn(2),
            effects: [
                // CR 701.50a step 1 — draw a card.
                { op: "draw", player: "controller", count: 1 },
                // CR 701.50a step 2 — discard a card (CR 601.2h convention:
                // the chosen-discard is paid in-effect, Mesmeric Trance /
                // Krovikan Sorcerer pattern).
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Connive: discard a card (Ledger Shredder).",
                    bind: "$connived",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$connived" },
                },
                // CR 701.50a step 3 — if a NONLAND card was discarded this
                // way, put a +1/+1 counter on this creature.
                {
                    op: "if",
                    predicate: {
                        picksMatchFilter: { ref: "$connived" },
                        player: "controller",
                        filter: { excludeType: "Land" },
                    },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        }),
    ],
};
