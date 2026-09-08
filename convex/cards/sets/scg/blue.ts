// SCG (Scourge) — blue cards, split by colour per ADR 0043. The registry's
// `import * as scg from "./sets/scg"` resolves here via scg/index.ts.
import type { CardDefinition } from "../../types";
import { cyclingAbility, cycledTrigger } from "../../abilities/cycling";

// Stifle — "Counter target activated or triggered ability. (Mana abilities
// can't be targeted.)" (CR 701.6a — countering an ability removes it from the
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

// Decree of Silence — {6}{U}{U} Enchantment. Three lines, and the pool's FIRST
// shipped consumer of `cycledTrigger` (CR 702.29c).
//
//  1. "Whenever an opponent casts a spell, counter that spell and put a
//     depletion counter on this enchantment. If there are three or more
//     depletion counters on this enchantment, sacrifice it."
//  2. "Cycling {4}{U}{U}"
//  3. "When you cycle this card, you may counter target spell."
//
// LINE 1 is what issue #3206 built the engine for. A triggered ability that
// counters the spell that triggered it announces NO target (CR 603.2 — a
// trigger's targets are chosen as it goes on the stack, and this one names
// none), so `counter`'s `EffectTargetRef` had nothing to point at: the spell
// exists only as a field of the firing event. `SPELL_CAST` now carries its
// `EVENT_FIELD_REGISTRY` rows (ADR 0049), and `$event.spell` is the first
// member of the new `"stack-object"` family — neither a permanent (a battlefield
// recheck would reject every spell on the stack) nor a player. CR 608.2b's
// "already left the stack" skip is `SpellContext.counter`'s, the single
// authority, which fizzles silently on a spell that is gone.
//
// The self-sacrifice is the ordinary `counters` + `if` + `sacrifice` shape
// (CR 122.1 / 701.21a), reading the counter tally back through the
// `{ counters: { of, type } }` EffectValue. The comparison is `ge 3` on the
// tally AFTER this trigger's own counter is added, which is what "if there are
// three or more" asks at resolution.
//
// LINE 3's "you may" is a RESOLUTION-time decision (CR 603.4-adjacent: the
// target is chosen at announcement, the choice to counter is made on
// resolution), so it is the costless `mayPay` prompt + `if` shape (Generous
// Plunderer, `sets/big/red.ts`) over a MANDATORY `count: 1` target — NOT an
// "up to one" target, which would move the decision to announcement and let the
// controller decline before the opponent ever sees the ability targeted.
//
// Bot: this card being `cycledTrigger`'s first consumer is what made the
// declared hole #3118 (`gre/costLegClaims.ts`) live — the SEARCH-side discard
// omitted `cause: "cycling"`, so the trigger fired on the real board and not
// inside the Bot's tree. Closed in this same PR, in `applyMove.ts`.
//
// compiler-gap: "Whenever an opponent casts a spell, counter that spell and put a depletion counter on this enchantment. If there are three or more depletion counters on this enchantment, sacrifice it." (#2693)
// compiler-gap: "When you cycle this card, you may counter target spell." (#2693)
export const decreeOfSilence: CardDefinition = {
    id: "f2fc46e2-5e19-4999-a4cd-1e84697066c1",
    rarity: "rare",
    name: "Decree of Silence",
    oracleText:
        "Whenever an opponent casts a spell, counter that spell and put a depletion counter on this enchantment. If there are three or more depletion counters on this enchantment, sacrifice it.\nCycling {4}{U}{U} ({4}{U}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, you may counter target spell.",
    manaCost: { U: 2, generic: 6 },
    types: ["Enchantment"],
    activatedAbilities: [cyclingAbility({ U: 2, generic: 4 })],
    triggeredAbilities: [
        {
            id: "decree-of-silence-counter-opponent-spell",
            oracleText:
                "Whenever an opponent casts a spell, counter that spell and put a depletion counter on this enchantment. If there are three or more depletion counters on this enchantment, sacrifice it.",
            event: "SPELL_CAST",
            // CR 603.2 / 601.2i — an OPPONENT of this permanent's controller
            // cast it. The caster comparison is the whole condition: the card
            // says "a spell", with no type or colour restriction.
            matches: (event, self) =>
                event.type === "SPELL_CAST" &&
                event.casterId !== self.controllerId,
            effects: [
                // CR 701.6a — counter the spell that triggered this ability,
                // named through the event rather than an announced slot.
                { op: "counter", target: { ref: "$event.spell" } },
                {
                    op: "counters",
                    action: "add",
                    counter: "depletion",
                    target: { ref: "$source" },
                    count: 1,
                },
                {
                    // CR 122.1 — read the tally back AFTER the add above, so
                    // the third counter sacrifices the enchantment in the same
                    // resolution that placed it.
                    op: "if",
                    predicate: {
                        left: {
                            counters: {
                                of: { ref: "$source" },
                                type: "depletion",
                            },
                        },
                        op: "ge",
                        right: 3,
                    },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ],
        },
        cycledTrigger({
            id: "decree-of-silence-cycled-counter",
            oracleText:
                "When you cycle this card, you may counter target spell.",
            targetRequirement: { type: "spell", count: 1 },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Counter target spell?",
                    bind: "$counterIt",
                },
                {
                    op: "if",
                    predicate: { binding: "$counterIt" },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
        }),
    ],
};
