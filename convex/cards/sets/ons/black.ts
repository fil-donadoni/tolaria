// ONS — black cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons"` resolves through ons/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Chain of Smog — {1}{B} Sorcery (Vintage Cube edict/discard/hand disruption,
// issue #682). "Target player discards two cards. That player may copy this
// spell and may choose a new target for that copy." Blocked: the "may copy
// this spell" clause needs a spell self-copy Op. `SpellContext.
// copyResolvingSpell` exists as an imperative primitive (Chain Lightning-
// class "copy this spell", `convex/gre/state.ts`), but (a) no Effect Script
// Op wraps it — "copySpell"/"copySelf" is absent from `EFFECT_OP_REGISTRY`,
// not even `planned`, and inventing the name or reaching for `resolve()` to
// paper over an unregistered Op is explicitly forbidden
// (`.claude/rules/gre-development.md`); (b) the decision-maker here is the
// DISCARDING (target) player, not the caster — no existing card composes a
// non-caster-driven self-copy decision. #931 (the card-list residue this
// was split from) is CLOSED and decomposed; the capability lives at #2087
// (`copySpell` Op + non-caster chooser + `SPELL_COPIED` event).
// tracked-by: #2087
// export const chainOfSmog: CardDefinition = {
//     id: "6bfe64f9-8b03-41f6-a47b-fade397ad9d1",
//     name: "Chain of Smog",
//     rarity: "uncommon",
//     manaCost: { X: 1, B: 1 },
//     types: ["Sorcery"],
// };

export {};
