// MKM — blue cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm"` resolves through mkm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Forensic Gadgeteer — {2}{U} Creature — Vedalken Artificer Detective, 2/3.
// "Whenever you cast an artifact spell, investigate. Activated abilities of
// artifacts you control cost {1} less to activate. This effect can't reduce
// the mana in that cost to less than one mana."
//
// TRIAGED 2026-08-25 (#1841 audit) — the marker used to read "needs a new
// engine capability" with no gap named. Half of it is already free: the
// `investigate` keyword action is `status: "implemented"` in the Mechanics
// Registry (the Clue token's activated ability rides
// EffectTokenSpec.activatedAbilities, issue #1191). The one real blocker is
// the second clause: activated-ability cost reduction, with a floor of one
// mana — which #1339 owns for Zirda, the Dawnwaker.
// tracked-by: #1339
// export const forensicGadgeteer: CardDefinition = {
//     id: "97d08a15-e61c-4421-a541-c68a4f87cb74",
//     name: "Forensic Gadgeteer",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Vedalken", "Artificer", "Detective"],
//     power: 2,
//     toughness: 3,
// };

// Proft's Eidetic Memory — {1}{U} Legendary Enchantment. "When Proft's
// Eidetic Memory enters, draw a card.\nYou have no maximum hand size.\nAt the
// beginning of combat on your turn, if you've drawn more than one card this
// turn, put X +1/+1 counters on target creature you control, where X is the
// number of cards you've drawn this turn minus one."
//
// Three clauses, three shipped mechanisms and no new one:
//  1. the ETB draw is a plain `enteredTrigger({ scope: "self" })` + `draw`;
//  2. "no maximum hand size" is the CR 402.2 / 514.1 `hand-size-override`
//     static effect Library of Leng established (`lea/colorless.ts`) — read
//     inline off the battlefield by `effectiveMaxHandSize` at CLEANUP, so no
//     PlayerState bookkeeping and no enter/leave churn;
//  3. the combat trigger is a CR 603.4 intervening-if ("if you've drawn more
//     than one card this turn") over an amount that reads the SAME per-turn
//     tally. The gate is a closure over `TriggerStateView` — an intervening-if
//     is not an effect and never reaches the interpreter — while the amount is
//     the DSL `{ cardsDrawnThisTurn: { of } }` value member (issue #3240)
//     composed with `difference` for the "minus one". CR 603.4 makes the gate
//     re-check at resolution, and both halves read one field, so a draw
//     between trigger and resolution moves them together.
//
// The counters go on ONE target creature you control, announced when the
// trigger goes on the stack (CR 603.3d) and re-checked at resolution
// (CR 608.2b); X is bound at resolution, not announcement (CR 608.2h).
//
// Known skew, issue #1714 (NOT a divergence this card introduces): the opening
// hand and every scenario-loaded hand are dealt through the draw path, so
// `drawnThisTurn` over-reports on turn 1 and in loaded scenarios. Every reader
// of the tally has always inherited it (Sylvan Library, Jandor's Ring); the
// fix belongs to the DEALING path and does not gate this card.
//
// compiler-gap: "At the beginning of combat on your turn, if you've drawn more than one card this turn, put X +1/+1 counters on target creature you control, where X is the number of cards you've drawn this turn minus one." (#2693)
export const proftsEideticMemory: CardDefinition = {
    id: "af5b29b3-974c-4200-8df8-b072c11e1600",
    name: "Proft's Eidetic Memory",
    rarity: "rare",
    oracleText:
        "When Proft's Eidetic Memory enters, draw a card.\nYou have no maximum hand size.\nAt the beginning of combat on your turn, if you've drawn more than one card this turn, put X +1/+1 counters on target creature you control, where X is the number of cards you've drawn this turn minus one.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    supertypes: ["Legendary"],
    staticEffects: [
        {
            // CR 402.2 — "You have no maximum hand size." Library of Leng's
            // shape; `effectiveMaxHandSize` (`gre/phases.ts`) reads it at
            // CLEANUP so the controller is never asked to discard down.
            kind: "hand-size-override",
            value: "unlimited",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "profts-eidetic-memory-etb-draw",
            oracleText: "When Proft's Eidetic Memory enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
        phaseTrigger({
            id: "profts-eidetic-memory-combat",
            oracleText:
                "At the beginning of combat on your turn, if you've drawn more than one card this turn, put X +1/+1 counters on target creature you control, where X is the number of cards you've drawn this turn minus one.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            // CR 603.4 intervening-if — checked when the trigger would fire AND
            // again as it resolves. "More than one card", so exactly one drawn
            // card does nothing (X would be 0 anyway; the rule removes the
            // ability from the stack rather than resolving a no-op).
            interveningIf: (_event, self, state) =>
                (state?.players.find((p) => p.id === self.controllerId)
                    ?.drawnThisTurn?.length ?? 0) > 1,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    // CR 121.1 — X is the per-turn draw tally MINUS ONE, read
                    // at resolution (CR 608.2h). The intervening-if above has
                    // already established the tally is at least 2, so X >= 1.
                    count: {
                        difference: {
                            from: { cardsDrawnThisTurn: { of: "controller" } },
                            minus: 1,
                        },
                    },
                },
            ],
        }),
    ],
};

export {};
