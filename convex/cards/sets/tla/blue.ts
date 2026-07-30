// TLA — blue cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, TargetSelection } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { librarySearchedTrigger } from "../../abilities/triggers/librarySearchedTrigger";

// Wan Shi Tong, Librarian (issue #788, cube slice #674) — {X}{U}{U}
// Legendary Creature — Bird Spirit, 1/1, TLA #78.
//
// Oracle (Scryfall): "Flash\nFlying, vigilance\nWhen Wan Shi Tong enters, put
// X +1/+1 counters on him. Then draw half X cards, rounded down.\nWhenever
// an opponent searches their library, put a +1/+1 counter on Wan Shi Tong
// and draw a card."
//
// TWO triggered abilities, two different authoring paths:
//
//   1. The ETB clause is a genuine CR 603.6b TRIGGERED ability — NOT
//      `entersWith` (the CR 614.1c "~ enters with N counters" replacement
//      templating Walking Ballista/Jacked Rabbit use): the Oracle line is
//      explicitly "When ~ enters, put X counters...". Its second sentence,
//      "draw half X cards, rounded down", needs integer division the Effect
//      Script `EffectValue` grammar structurally cannot express (ADR 0045 —
//      "no arithmetic, no expressions", see the grammar's own doc comment,
//      `cards/types.ts`). `resolve()` is the documented escape hatch for
//      exactly this shape — precedent: Banshee's activated ability
//      (`sets/drk/black.ts`) and the X-divided spell in `sets/fem/red.ts`,
//      both `Math.floor(ctx.getX() / n)`. Not `ctx.getX()` itself, though —
//      that reads the CURRENTLY resolving stack item's `chosenX`, and this
//      trigger resolves AFTER the creature spell's own stack item is gone
//      (the Jacked Rabbit precedent, `sets/blc/white.ts`, documents the same
//      staleness for its own X-gated intervening-if). The resolve body reads
//      the new `ctx.getChosenXOnCast(target)` accessor instead (issue #788)
//      — the resolve()-body sibling of `PermanentView.chosenXOnCast`.
//   2. "Whenever an opponent searches their library..." is the actual
//      residual trigger-condition capability #788 ships (the sibling
//      "targeted by an opponent" / BECAME_TARGET, issue #1265, Leovold, and
//      "you create tokens" / TOKENS_CREATED, issue #1345, Staff of the
//      Storyteller variants already shipped). `librarySearchedTrigger`
//      (new factory, `abilities/triggers/librarySearchedTrigger.ts`) listens
//      for the new `LIBRARY_SEARCHED` event, scope "opponents". Pure DSL —
//      `counters` and `draw` are both already interpreter-suite-exercised
//      Ops with no arithmetic needed, so this half is a plain
//      `effects: EffectOp[]` script (ADR 0045), no `resolve()` at all.
export const wanShiTongLibrarian: CardDefinition = {
    id: "e20da6b5-1057-4a28-9e85-07de714e262f",
    name: "Wan Shi Tong, Librarian",
    rarity: "mythic",
    manaCost: { X: "X", U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Bird", "Spirit"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flash", "flying", "vigilance"],
    oracleText:
        "Flash\nFlying, vigilance\nWhen Wan Shi Tong enters, put X +1/+1 counters on him. Then draw half X cards, rounded down.\nWhenever an opponent searches their library, put a +1/+1 counter on Wan Shi Tong and draw a card.",
    triggeredAbilities: [
        enteredTrigger({
            id: "wan-shi-tong-librarian-etb",
            oracleText:
                "When Wan Shi Tong enters, put X +1/+1 counters on him. Then draw half X cards, rounded down.",
            scope: "self",
            // protocol card (this ability only): `resolve()` justified by the
            // integer-division clause — see the card-level comment above.
            resolve: (ctx, _event, entered) => {
                const target: TargetSelection = {
                    type: "permanent",
                    id: entered.id,
                };
                const x = ctx.getChosenXOnCast(target);
                if (x > 0) ctx.addCounter(target, "+1/+1", x);
                const toDraw = Math.floor(x / 2);
                if (toDraw > 0) ctx.drawCards(entered.controllerId, toDraw);
            },
            // AI-only shadow script (PRD #1423, issue #1519 ability-level
            // guard) — never executed, walked by `OP_VALUERS` so the bot's
            // valuation isn't blind to this `resolve()` ability. Approximates
            // the real body: X counters (exact) and a rough 1-card draw
            // (the shadow-script grammar can't express "half X" any more
            // than the real Effect Script grammar can, ADR 0045 — 1 is a
            // representative floor for X >= 2, the common case).
            aiEffects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: { X: true },
                    target: { ref: "$source" },
                },
                { op: "draw", player: "controller", count: 1 },
            ],
        }),
        librarySearchedTrigger({
            id: "wan-shi-tong-librarian-search",
            oracleText:
                "Whenever an opponent searches their library, put a +1/+1 counter on Wan Shi Tong and draw a card.",
            scope: "opponents",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: 1,
                    target: { ref: "$source" },
                },
                { op: "draw", player: "controller", count: 1 },
            ],
        }),
    ],
};
