// TLA — blue cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Wan Shi Tong, Librarian (issue #788, cube slice #674) — {X}{U}{U}
// Legendary Creature — Bird Spirit, 1/1, TLA #78. STOP-AND-ISSUE
// (ADR 0061, tracked-by: #1993): the ETB is "put X +1/+1 counters on him.
// Then draw half X cards, rounded down." — a genuine CR 603.6b TRIGGERED
// ability (not `entersWith`, since the Oracle line is "When ~ enters, put X
// counters..."), and "half X, rounded down" needs `Math.floor(x / 2)`
// integer division the Effect Script `EffectValue` grammar structurally
// cannot express (ADR 0045 — "no arithmetic, no expressions"). That forces
// this ability onto `resolve()` — but ADR 0061 forbids a `resolve()` /
// `resolveSteps` closure from calling the raw draw primitive
// (`SpellContext.drawCards` silently skips interactive replacements; only
// the DSL `draw` Op suspends/resumes) and calls exactly this shape — a
// protocol-like card needing both a draw and inexpressible logic — a
// stop-and-issue tracked stub, never shipped silently broken. There is no
// replacement-aware draw callable from a closure today, so the card cannot
// ship until one exists. The card's OTHER half — "whenever an opponent
// searches their library, put a +1/+1 counter on Wan Shi Tong and draw a
// card" — is pure DSL with no arithmetic and was the actual capability
// issue #788 was chartered to ship (`LIBRARY_SEARCHED` event +
// `librarySearchedTrigger` factory, `abilities/triggers/librarySearchedTrigger.ts`);
// that capability ships fully tested with no catalogue card consuming it
// yet, pending this card's draw-primitive gap closing.
// export const wanShiTongLibrarian: CardDefinition = {
//     id: "e20da6b5-1057-4a28-9e85-07de714e262f",
//     name: "Wan Shi Tong, Librarian",
//     rarity: "mythic",
//     manaCost: { X: "X", U: 2 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Bird", "Spirit"],
//     power: 1,
//     toughness: 1,
// };
export {};
