// sth (Stronghold) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { ActivatedAbilityContext, CardDefinition } from "../../types";

// Mox Diamond — {0} Artifact. "If this artifact would enter, you may discard
// a land card instead. If you do, put this artifact onto the battlefield. If
// you don't, put it into its owner's graveyard.\n{T}: Add one mana of any
// color."
//
// Clause 1-3 are ONE CR 614.1c self-replacement, declared as data on
// `entersWith.asEnters` (ADR 0100): the permanent is parked off every zone
// while the optional discard is offered (CR 614.12a — the choice is made
// BEFORE it enters), the discard is paid through the shared CR 701.9 discard
// chokepoint, and a DECLINE aborts the staged entry to `ifDeclined`. Mox
// Diamond therefore never touches the battlefield on the decline branch — no
// enters-the-battlefield trigger sees it, and a cast copy goes stack →
// graveyard as a card (CR 608.3), which is not a "dies" event (CR 700.4).
// With no land in hand the choice has no legal payment, so it auto-resolves to
// the decline rather than parking behind an unanswerable prompt.
//
// The declaration rides the SAME chokepoint for every entry route
// (`enterBattlefieldDestinationFor`, ADR 0100 D1's three callers), so an effect
// that puts Mox Diamond onto the battlefield from a graveyard/hand/library
// offers the identical choice — the cast path is not special-cased.
//
// Clause 4 is a plain CR 605.1a mana ability (`useStack: false`, CR 605.3a),
// the City of Brass / Celestial Prism / Lotus Guardian `manaChoices` shape.
export const moxDiamond: CardDefinition = {
    id: "28028830-83ed-45e2-b495-3b9ad9d3e988",
    rarity: "rare",
    name: "Mox Diamond",
    oracleText:
        "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    entersWith: {
        asEnters: [
            {
                kind: "discard",
                filter: { type: "Land" },
                ifDeclined: "graveyard",
            },
        ],
    },
    activatedAbilities: [
        {
            id: "mox-diamond-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
