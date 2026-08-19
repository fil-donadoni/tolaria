// war — black cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Bolas's Citadel — {3}{B}{B}{B} Legendary Artifact (Vintage Cube, issue
// #2398). Three orthogonal engine primitives, each shipped GENERAL rather than
// card-shaped (primitive-reuse mandate):
//
//   1. `looksAtLibraryTop: "controller"` (CR 401.5) — the PRIVATE half of the
//      same rule `revealsLibraryTop` models: continuous, position-attached,
//      derived live off the battlefield (`gre/libraryReveal.ts`), and visible
//      to the controller ALONE. `projectPublicState` ORs it into the top-card
//      knowledge channel only for the library's own viewer.
//   2. `playsLandsFromTopOfLibrary` (already shipped for Courser of Kruphix) +
//      `castsSpellsFromTopOfLibrary` (new, CR 601.3e-analog) — the land and
//      spell halves of "You may play lands and cast spells from the top of
//      your library". Both are player-wide, battlefield-derived and
//      position-strict at index 0 (the rest of the library stays hidden,
//      CR 400.2). Kept as two fields because CR ties neither to the other and
//      cards print them separately (Courser plays lands only; Vizier of the
//      Menagerie casts creatures only).
//   3. `manaCostReplacement: "life-equal-to-mana-value"` (CR 118.9-analog /
//      119.4 / 107.3b) — a WHOLESALE mana-cost substitution, not an
//      `AlternativeCost`: the caster never announces it, it is applied by the
//      permission that supplied the cast, and the amount is DERIVED from the
//      card (its mana value, with {X} counting 0 off the stack per CR 107.3b)
//      where every `CostLegs.life` in the engine is a fixed number.
//      `castRawManaCost` zeroes the mana; the three cast-commit life
//      accumulators (`convex/game.ts`) charge the life.
//
// The drain clause is the already-solved shape: {T} + a filtered sacrifice
// cost + `loseLife`. The only widening it needed is `sacrificeFilterCount`,
// generalizing the single-permanent `sacrificeFilter` to N (CR 602.1 / 118.5).
// Citadel itself is a legal victim — it is a nonland permanent, and CR 701.21
// puts no restriction on sacrificing the source of the ability being paid for.
export const bolassCitadel: CardDefinition = {
    id: "d2124603-d20e-40eb-97f0-a66323397ac2",
    name: "Bolas's Citadel",
    rarity: "rare",
    oracleText:
        "You may look at the top card of your library any time.\nYou may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.\n{T}, Sacrifice ten nonland permanents: Each opponent loses 10 life.",
    manaCost: { generic: 3, B: 3 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    // CR 401.5 — "You may look at the top card of your library any time."
    looksAtLibraryTop: "controller",
    // CR 305.1-analog / 601.3e-analog — "You may play lands and cast spells
    // from the top of your library."
    playsLandsFromTopOfLibrary: true,
    castsSpellsFromTopOfLibrary: {
        // CR 118.9-analog / 119.4 — "If you cast a spell this way, pay life
        // equal to its mana value rather than pay its mana cost."
        manaCostReplacement: "life-equal-to-mana-value",
    },
    activatedAbilities: [
        {
            id: "bolass-citadel-drain",
            oracleText:
                "{T}, Sacrifice ten nonland permanents: Each opponent loses 10 life.",
            cost: {
                tap: true,
                // CR 602.1 / 118.5 / 701.21 — ten NONLAND permanents the
                // activator controls; which ten is the activator's own choice,
                // routed through the unified sacrificeChoice layer.
                sacrificeFilter: { excludeTypes: "Land" },
                sacrificeFilterCount: 10,
            },
            useStack: true,
            effects: [{ op: "loseLife", player: "opponent", amount: 10 }],
        },
    ],
};
