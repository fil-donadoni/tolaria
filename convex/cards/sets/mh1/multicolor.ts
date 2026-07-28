// mh1 — multicolor cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Hogaak, Arisen Necropolis — {5}{B/G}{B/G} Legendary Creature — Avatar, 8/8
// (issue #1338, PRD #702, ADR 0063). "You can't spend mana to cast this spell.
// Convoke, delve. You may cast this card from your graveyard. Trample."
//
// Exercises the whole payWith cluster this issue ships:
//   - `cantSpendManaToCast` (CR 601.2f) forces EVERY pip — the 5 generic AND
//     the two guild-hybrid {B/G} pips — through the non-mana payWith path; no
//     mana may be spent. `coloredCostLeftover` (gre/rules.ts) drops all real
//     mana sources for the castability probe, leaving only convoke creatures +
//     delve exiles. Since delve pays only generic (CR 702.66a), the two {B/G}
//     pips MUST be paid by convoke creatures that are black or green.
//   - `convoke` (CR 702.51) — the coloured payWith: each tapped creature pays a
//     generic OR one mana of its colour (so a B/G creature covers a {B/G} pip).
//   - `delve` (CR 702.66) — the generic payWith it shares the picker chain with.
//   - `castableFromOwnGraveyard` (CR 601.3e) — "You may cast this card from your
//     graveyard" (resolves normally, lands in the graveyard — no exile).
//   - `trample` (CR 702.19).
// The two {B/G} pips are declared via `manaCost.hybrid` (issue #1338); the flat
// `X: 5` is the generic. Mana value 7, colours {B, G} — both derived from the
// hybrid pips (`manaValue` / `getColorsFromCost`). No `effects`/`resolve`: a
// vanilla-bodied creature whose entire rules text is keyword abilities + cost
// modifiers, so the DSL smoke sweep needs nothing from it.
export const hogaakArisenNecropolis: CardDefinition = {
    id: "0049e68d-0caf-474f-9523-dad343f1250a",
    rarity: "rare",
    name: "Hogaak, Arisen Necropolis",
    oracleText:
        "You can't spend mana to cast this spell.\nConvoke, delve (Each creature you tap while casting this spell pays for {1} or one mana of that creature's color. Each card you exile from your graveyard pays for {1}.)\nYou may cast this card from your graveyard.\nTrample",
    manaCost: {
        X: 5,
        hybrid: [
            ["B", "G"],
            ["B", "G"],
        ],
    },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Avatar"],
    power: 8,
    toughness: 8,
    staticAbilities: ["convoke", "delve", "trample"],
    cantSpendManaToCast: true,
    castableFromOwnGraveyard: true,
};

// TODO(issue #679 stub — Fallen Shinobi needs Ninjutsu (CR 702.49):
// mechanicsRegistry.ts lists it `status: "planned"` — no keyword name and no
// "return an unblocked attacker to hand, put this onto the battlefield
// tapped and attacking" alternate-cast primitive exist yet. Ninjutsu is the
// card's entire reason to exist in a Cube context, so — matching the
// Evoke-gated stub precedent (Solitude/Subtlety/Fury/Endurance) — the whole
// card stays a stub. Stop-and-issue per gre-development.md; tracked stub.
// export const fallenShinobi: CardDefinition = {
//     id: "900c9dfd-ece1-4b09-a801-0fa05e1994b9",
//     name: "Fallen Shinobi",
//     rarity: "rare",
//     manaCost: { X: 3, U: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Zombie", "Ninja"],
//     power: 5,
//     toughness: 4,
// };

export {};
