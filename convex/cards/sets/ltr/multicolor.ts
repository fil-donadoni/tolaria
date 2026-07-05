// LTR — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — the "choose one. If you control a Wizard, choose
// two instead" clause is a conditional modal count: neither the `optionChoice`
// Op (a fixed single pick) nor the legacy `modes: SpellMode[]` mechanism
// supports a caster-controlled-permanent-conditional mode COUNT. This is a
// bespoke structural gap, not a named keyword/Op — stop-and-issue per
// gre-development.md rather than an invented mechanism. Tracked stub.
// export const flameOfAnor: CardDefinition = {
//     id: "04779a7e-b453-48b9-b392-6d6fd0b8d283",
//     name: "Flame of Anor",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1, R: 1 },
//     types: ["Instant"],
// };

// TODO(tracked-by: tolaria#917) — Arwen, Mortal Queen: "lifelink counter" as
// a generalized counter-driven ability grant. `StaticEffectContext`/
// `PermanentView` static-effect predicates have no counter-count access
// (only the DSL/SpellContext side does via `getCounterCount`), so a
// keyword-grant-by-counter-presence mechanism (beyond the already-supported
// +1/+1 P/T layer-7d case) doesn't exist. Also blocked: the activated
// ability's "remove an indestructible counter" cost + temporary
// indestructible grant + dual counter placement chain compounds on the same
// gap. Stop-and-issue per gre-development.md rather than a `resolve()`
// workaround.
// export const arwenMortalQueen: CardDefinition = {
//     id: "547f92d4-cd1d-4ca7-a6e2-6473b4d3c832",
//     name: "Arwen, Mortal Queen",
//     rarity: "mythic",
//     manaCost: { X: 1, W: 1, G: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Elf", "Noble"],
//     power: 2,
//     toughness: 2,
// };

export {};
