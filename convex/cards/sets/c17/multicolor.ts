// C17 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as c17 from "./sets/c17"` resolves through c17/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Fractured Identity — {3}{W}{U} Sorcery. "Exile target nonland permanent.
// Each player other than its controller creates a token that's a copy of
// it." Re-audited for Cube FREE wave 3 (issue #1531/#1525): the ORIGINAL
// blocker (`createTokenCopy`, a token that copies a permanent) has since
// SHIPPED (issue #1459) — the stale note below is superseded. A deeper gap
// surfaces once that Op is available: "each player other than its
// controller" has no `EffectPlayerRef` expression. `"opponent"` resolves
// relative to the RESOLVING CONTROLLER only (hardcoded in
// `resolvePlayerRef`, `convex/gre/effects/interpreter.ts`); `{ controllerOf
// }` gives the target's controller itself, not its complement — and
// `forEach { set: "players" }` has no per-player exclusion filter to skip
// that controller during iteration. Even in a 2-player game (so "each
// player other than its controller" is always exactly one well-defined
// player) there is no grammar member that computes it — distinct from the
// `createTokenCopy`-missing reason the original stub cited. (The copy-vs-
// exile ORDERING is already solved: create each copy BEFORE exiling the
// original, matching the ruling that the token looks "as it looked
// immediately before the permanent was exiled" — CR 608.2h-adjacent, not a
// gap.) Stop-and-issue per gre-development.md; tracked stub.
// tracked-by: #1568
// export const fracturedIdentity: CardDefinition = {
//     id: "b2f73f5d-1aad-48c2-9e74-5f7bdd87900f",
//     name: "Fractured Identity",
//     rarity: "rare",
//     manaCost: { X: 3, W: 1, U: 1 },
//     types: ["Sorcery"],
// };

export {};
