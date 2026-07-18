// ema (Eternal Masters) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

// import type { CardDefinition } from "../../types";

// Mana Crypt — "At the beginning of your upkeep, flip a coin. If you lose the
// flip, this artifact deals 3 damage to you.\n{T}: Add {C}{C}." The {C}{C}
// mana ability is trivial, but the upkeep coin flip is STOP-AND-ISSUE
// (re-audited under the #1306 residue tranche, parent PRD #620): the shipped
// `coinFlip` Op (#851) requires BOTH its `win` and `loss` branches to carry a
// NON-EMPTY effects list (enforced by `isCoinFlipBranch` in
// `convex/gre/effects/validate.ts`). Mana Crypt's WIN branch does nothing at
// all — "if you LOSE, deal 3 damage" — so it can only be modelled once
// `coinFlip` accepts a no-op / do-nothing branch. Relaxing the Op's frozen
// branch contract is a deliberate Op-spec change that belongs in its own
// tracked issue, not smuggled into a card tranche (the DSL-first
// "stop-and-issue, never invent" rule). Left as a tracked stub pending that
// coinFlip enhancement. tracked-by: #1367
// export const manaCrypt: CardDefinition = {
//     id: "0cb33b46-4d1b-4f97-bfdc-d815aee111da",
//     name: "Mana Crypt",
//     rarity: "rare",
//     types: ["Artifact"],
// };
export {};
