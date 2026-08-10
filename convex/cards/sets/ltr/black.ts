// LTR — black cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { typecyclingAbility } from "../../abilities/cycling";

// TODO(issue #676 stub — Amass, CR 701.47, is `planned` in
// mechanicsRegistry.ts: no Army-token-creation-or-counter primitive exists.
// Orcish Bowmasters' ETB/draw-punisher damage trigger would be DSL-clean on
// its own, but "amass Orcs 1" is the second half of the same trigger and
// can't be dropped without misrepresenting the card. Stop-and-issue per
// gre-development.md; tracked stub.
// export const orcishBowmasters: CardDefinition = {
//     id: "7c024bae-5631-4e20-ac69-df392ac9e109",
//     name: "Orcish Bowmasters",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc", "Archer"],
//     power: 1,
//     toughness: 1,
// };

// Troll of Khazad-dûm — "This creature can't be blocked except by three or
// more creatures. Swampcycling {1}." (Issue #1839.)
//
// The block restriction is CR 509.1b's minimum-blocker requirement with N = 3
// — the same rule shape as menace (CR 702.111a, N = 2) but with no keyword
// name of its own, so it is declared as the parametrized engine-internal
// marker `minimum-blockers:3` (censused in `ENGINE_INTERNAL_MARKERS`,
// mechanicsRegistry.ts). `MINIMUM_BLOCKER_RULES` (gre/combatRegistry.ts) reads
// it, `describeMinimumBlockers` takes the MAX over every matching rule, and
// the one threshold feeds both enforcement sites: `validateMinimumBlockers`
// at blocker-confirm (convex/game.ts) and the bot's legal-block enumerator
// (convex/gre/moves.ts).
//
// Swampcycling {1}: CR 702.29e typecycling — `typecyclingAbility`, which
// shares plain Cycling's activation shell (CR 702.29f).
export const trollOfKhazadDum: CardDefinition = {
    id: "a6539e26-b63b-4725-9407-caaf451de084",
    name: "Troll of Khazad-dûm",
    rarity: "common",
    manaCost: { X: 5, B: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 6,
    toughness: 5,
    oracleText:
        "This creature can't be blocked except by three or more creatures.\nSwampcycling {1} ({1}, Discard this card: Search your library for a Swamp card, reveal it, put it into your hand, then shuffle.)",
    // CR 509.1b — "can't be blocked except by three or more creatures".
    staticAbilities: ["minimum-blockers:3"],
    // CR 702.29e/f — Swampcycling {1}.
    activatedAbilities: [typecyclingAbility({ generic: 1 }, "Swamp")],
};
