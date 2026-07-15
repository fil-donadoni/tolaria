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

// Brain Freeze — {1}{U} Instant. "Target player mills three cards. Storm
// (When you cast this spell, copy it for each spell cast before it this
// turn. You may choose new targets for the copies.)" (CR 702.40 Storm, ADR
// 0052 + PRD #1041 — the storm TRACER card, the target-player retarget
// path.) `staticAbilities: ["storm"]` drives the whole copy mechanism —
// `collectCastTriggers` / `resolveStormTrigger` (convex/gre/state.ts), an
// engine-synthesized cast trigger, not a per-card `resolve()`. The card's OWN
// effect is a plain DSL `mill` Op (CR 701.17) on the announced target
// player — the exact shape Thought Scour already exercises (dka/blue.ts),
// reused verbatim (per-Op test regime: no new Op, no hand-written per-card
// test required).
export const brainFreeze: CardDefinition = {
    id: "59a43ef5-08f0-44fc-802d-b6cfd56b7d1f",
    name: "Brain Freeze",
    rarity: "uncommon",
    oracleText:
        "Target player mills three cards.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    staticAbilities: ["storm"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "mill", player: { target: 0 }, count: 3 }],
};
