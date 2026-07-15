// ECL — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #900 stub — the two gaps this stub originally listed both
// SHIPPED via #900: Evoke itself (`CardDefinition.evoke` + `evokeTrigger`,
// see Solitude/Grief in mh2/white.ts / mh2/black.ts) and spent-mana-color
// tracking (`CardInstanceState.notedManaSpentOnCast`, readable by a
// triggered ability's check-time `condition` — exactly the "if {G}{G} was
// spent" / "if {U}{U} was spent" shape this card needs). What remains
// blocking Wistfulness is a DIFFERENT, more basic gap #900 never covered: its
// printed cost {3}{G/U}{G/U} AND its evoke cost {G/U}{G/U} both need a HYBRID
// mana pip — `ManaCost` (cards/types.ts) has no hybrid-pip representation at
// all (single W/U/B/R/G/C numeric fields only), so the cost can't even be
// declared. Tracked separately at issue #782 ("[engine] Hybrid mana cost
// encoding"), same root gap as Deathrite Shaman (rtr/colorless.ts, #676) and
// Vibrance/Deceit (ecl/multicolor.ts). Home file is intentionally
// `colorless.ts` here ONLY because it predates the worklist misfile fix — once
// #782 ships, Wistfulness's hybrid {G/U}{G/U} cost makes it a genuine G/U
// card and it must move to `multicolor.ts` alongside Vibrance/Deceit (the
// same `parseManaCost`-drops-hybrid-symbols misfiling those two document).
// Stop-and-issue per gre-development.md; tracked stub.
// export const wistfulness: CardDefinition = {
//     id: "db9aa986-ac2a-44bb-a88b-04c5d0d502b2",
//     name: "Wistfulness",
//     rarity: "mythic",
//     manaCost: { X: 3 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 6,
//     toughness: 5,
// };

export {};
