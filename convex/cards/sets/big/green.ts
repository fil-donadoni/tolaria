// BIG — green cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Ancient Cornucopia — "Whenever you cast a spell that's one or more colors,
// you may gain 1 life for each of that spell's colors. Do this only once
// each turn.\n{T}: Add one mana of any color." STOP-AND-ISSUE
// (tracked-by: #675): the mana ability alone is trivial (the established
// any-colour `manaChoices` shape), but the triggered life-gain needs the
// firing SPELL_CAST event's `colors.length` (an Effect Script trigger site
// does NOT thread the firing event in — only `resolve()` reads it — so this
// would need `resolve()`, which is fine) PLUS a "once each turn" limiter.
// `ActivatedAbility.oncePerTurn` exists (`CardInstanceState.activationsThis-
// Turn`), but it is scoped to ACTIVATED abilities only — `TriggeredAbility`
// has no equivalent per-turn-use cap to reuse, and inventing a one-off
// counter for this card alone would be the card-shaped primitive
// `.claude/rules/gre-development.md` § Primitive reuse asks to avoid. Left
// as a tracked stub pending a triggered-ability per-turn-cap primitive.
// export const ancientCornucopia: CardDefinition = {
//     id: "f977975d-0439-4731-b129-270cc4cdbb23",
//     name: "Ancient Cornucopia",
//     rarity: "mythic",
//     manaCost: { X: 2, G: 1 },
//     types: ["Artifact"],
// };

export {};
