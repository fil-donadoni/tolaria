// ONC — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as onc from "./sets/onc"` resolves through onc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Otharri, Suns' Glory — {3}{R}{W} Legendary Creature. "Flying, lifelink,
// haste. Whenever Otharri attacks, you get an experience counter. Then create
// a 2/2 red Rebel creature token that's tapped and attacking for each
// experience counter you have. {2}{R}{W}, Tap an untapped Rebel you control:
// Return this card from your graveyard to the battlefield tapped." Blocked:
// the graveyard-reanimation ability itself IS expressible today
// (`ActivatedAbility.cost.activateFromGraveyard` — used by Ashen Ghoul).
// Sub-gap (b) — tokens entering the battlefield already tapped AND
// attacking (CR 508.4) — is GONE: `TokenSpec.entersTapped`/`entersAttacking`
// shipped (`convex/cards/types.ts`, issue #1195), proven live by Satya,
// Aetherflux Genius (`m3c/multicolor.ts`). What remains is only sub-gap
// (a): a player-scoped experience counter (CR 121.6 — counters live on the
// PLAYER, not a permanent) readable as a dynamic `EffectValue` for
// `createToken`'s `count` — `PlayerState` has only the dedicated
// `poisonCounters` (`convex/gre/state.ts`) / `energyCounters` (`state.ts`)
// scalars, no generic player-counter map and no interpreter read for one.
// tracked-by: #1969
// export const otharriSunsGlory: CardDefinition = {
//     id: "80c72839-0fa6-4b5f-83b7-6553ebf09bef",
//     name: "Otharri, Suns' Glory",
//     rarity: "mythic",
//     manaCost: { X: 3, W: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Phoenix"],
//     power: 3,
//     toughness: 3,
// };

export {};
