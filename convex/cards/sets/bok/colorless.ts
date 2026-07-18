// BOK — colorless cards, split by colour per ADR 0043. The registry's
// `import * as bok from "./sets/bok"` resolves through bok/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(re-audited under the #1306 residue tranche, parent PRD #620 —
// Equipment attach machinery shipped since #676/ADR 0065, but Jitte itself
// stays blocked): Jitte's first counter-removal mode pumps the EQUIPPED
// creature (not an announced target) — the `pump` Op's `EffectObjectSelector`
// still has no "the permanent this Equipment is attached to" ($host)
// selector, and the third mode's "Target creature gets -1/-1" needs
// PER-MODE modal targeting (`EffectMode.targetRequirement`) so only that one
// mode of the "choose one" declares a target. Both gaps are tracked together
// by #1341 ([engine] Umezawa's Jitte: host-ref ($host) + per-mode modal
// targeting), which depends on the Equipment spine (#776/#1349/#1350). The
// other two modes (equipped-creature +2/+2, gain 2 life) are DSL-clean on
// their own, but shipping only 1 of 3 modes would misrepresent the card.
// Stop-and-issue per gre-development.md; tracked stub. tracked-by: #1341
// export const umezawasJitte: CardDefinition = {
//     id: "3b6e5956-f795-451b-bb24-56462d1ced27",
//     name: "Umezawa's Jitte",
//     rarity: "rare",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
//     subtypes: ["Equipment"],
// };

export {};
