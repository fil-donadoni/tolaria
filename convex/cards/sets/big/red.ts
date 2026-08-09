// BIG — red cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Legion Extruder — {1}{R} Artifact (Cube FREE residue token-maker, issue
// #1304). "When this artifact enters, it deals 2 damage to any target. {2},
// {T}, Sacrifice another artifact: Create a 3/3 colorless Golem artifact
// creature token." The ETB damage half would be DSL-clean on its own
// (`dealDamage`), but the activated ability's cost is "Sacrifice ANOTHER
// artifact" (excluding this permanent itself) — `ActivatedAbility.cost.
// sacrificeFilter` is a static `PermanentFilter` shared by every instance of
// the card, with no per-source dynamic hook (unlike `TargetRequirement.
// excludeInstanceIds`, which a `getTargetRequirement(source)` closure can
// populate per-instance — the Sorceress Queen precedent, arn/black.ts); the
// sacrifice-candidate scan (`convex/gre/moves.ts`) matches the WHOLE
// battlefield including the activating permanent. Shipping the filter as-is
// would illegally let the source pay its own cost by sacrificing itself.
// Stop-and-issue per gre-development.md; shipping only the ETB half would
// misrepresent the card. tracked-by: #1357
// export const legionExtruder: CardDefinition = {
//     id: "5a077de0-1893-40d0-a499-ee2e6e2258f1",
//     name: "Legion Extruder",
//     rarity: "mythic",
//     manaCost: { generic: 1, R: 1 },
//     types: ["Artifact"],
// };

// Generous Plunderer — {1}{R} Creature — Human Rogue, 2/2 (Cube FREE residue
// token-maker, issue #1304). "Menace. At the beginning of your upkeep, you
// may create a Treasure token. When you do, target opponent creates a
// TAPPED Treasure token. Whenever this creature attacks, it deals damage to
// defending player equal to the number of artifacts they control." Menace
// (data), `reflexiveTrigger` for "When you do…", `EffectPlayerRef`'s
// `{ target: N }` for "target opponent", `EffectTokenSpec.entersTapped`
// (#1195 — the PRIOR blocker here, now shipped) and the attack trigger
// (`dealDamage` sized off an `EffectCount` of the defending player's
// artifacts) are all DSL-clean. STILL BLOCKED on a DIFFERENT, narrower gap:
// the DSL `createToken` Op's `token: EffectTokenSpec` cannot carry a
// Treasure's real "{T}, Sacrifice this artifact: Add one mana of any color"
// ability — `isTokenActivatedAbility` (`convex/gre/effects/validate.ts`)
// accepts no `manaChoices` field on a token-carried activated ability, only
// a single fixed `addMana` amount, so the created Treasures would be inert
// (no usable ability) or wrong (a fixed single color) if shipped today.
// `sharedTokens.ts`'s `TREASURE_TOKEN` has the real ability but is reachable
// only via `resolve()` + `ctx.createToken`, not this DSL Op. Stop-and-issue
// per gre-development.md; shipping a Treasure with no/wrong ability would
// misrepresent the card. tracked-by: #2423
// export const generousPlunderer: CardDefinition = {
//     id: "4c6cf93a-d073-48ac-88db-c46bf3e10beb",
//     name: "Generous Plunderer",
//     rarity: "mythic",
//     manaCost: { generic: 1, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Rogue"],
//     power: 2,
//     toughness: 2,
// };

export {};
