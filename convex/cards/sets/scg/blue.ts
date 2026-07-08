// SCG (Scourge) — blue cards, split by colour per ADR 0043. The registry's
// `import * as scg from "./sets/scg"` resolves here via scg/index.ts.
import type { CardDefinition } from "../../types";

// Stifle — "Counter target activated or triggered ability. (Mana abilities
// can't be targeted.)" (CR 701.5a — countering an ability removes it from the
// stack; it does not resolve. CR 605.3a — mana abilities never use the stack,
// so they are never legal targets.) Reuses the shipped `counter` Op —
// `ctx.counter` vanishes any ability on the stack (CR 113.7a: an ability is not
// a card, so it goes nowhere). The oracle "activated OR triggered" is expressed
// by the stack-object restriction `spellStackKind: "ability"`, which keeps any
// ability (activated or triggered) on the stack and drops spells.
export const stifle: CardDefinition = {
    id: "2d7643c0-b2db-478f-944e-b27b77bad3eb",
    name: "Stifle",
    rarity: "rare",
    oracleText:
        "Counter target activated or triggered ability. (Mana abilities can't be targeted.)",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellStackKind: "ability",
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};
