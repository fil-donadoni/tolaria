// `evokeTrigger` — declarative template for the SECOND half of Evoke (CR
// 702.74a): "When this permanent enters, if its evoke cost was paid, its
// controller sacrifices it."
//
// 702.74a: "Evoke [cost]" represents two abilities: a static ability that
//          functions in any zone from which the card can be cast ("you may
//          cast this card by paying [cost] rather than paying its mana
//          cost") and a triggered ability that functions on the battlefield
//          ("when this permanent enters, if its evoke cost was paid, its
//          controller sacrifices it"). Casting a spell for its evoke cost
//          follows the rules for paying alternative costs (601.2b,
//          601.2f-h).
//
// The FIRST half (the alternative cast permission) is cost-system infra,
// NOT this file: `CardDefinition.evoke` (reuses the `AlternativeCost` shape,
// CR 118.9 already governs paying it) is resolved by
// `convex/gre/alternativeCost.ts`'s `getAlternativeCost` /
// `affordableAlternativeCosts` alongside the generic `alternativeCosts[]`
// array; the cast-commit sites in `convex/game.ts` tag the resulting stack
// item `evoked: true` whenever the chosen alt cost === `CardDefinition.evoke`
// (compared by reference). That flag rides onto the entering permanent for
// free — a stack item IS its `CardInstanceState`, the same object — mirroring
// how CR 702.138b's `escaped` marker already survives the stack→battlefield
// transition.
//
// This file is only the SECOND half: a `TriggeredAbility` a card adds to its
// own `triggeredAbilities[]` ALONGSIDE its real ETB effect(s) — CR 702.74a is
// explicitly TWO abilities, modeled here as two independent entries that both
// fire off the same `PERMANENT_ENTERED` event. The "if its evoke cost was
// paid" clause is a CR 603.4 CHECK-TIME predicate (`condition`, evaluated
// once when the trigger would go on the stack) rather than an
// intervening-if — `evoked` cannot change between the ETB event firing and
// this trigger resolving (nothing un-evokes a permanent), so no CR 603.4
// resolve-time re-check plumbing is needed.
import type { TriggeredAbility } from "../types";
import { enteredTrigger } from "./triggers/enteredTrigger";

/** Builds the Evoke sacrifice trigger (CR 702.74a). Add alongside the card's
 *  own ETB triggered ability/abilities. `cardName` feeds the oracle-text
 *  reminder shown on the stack. */
export function evokeTrigger(cardName: string): TriggeredAbility {
    return enteredTrigger({
        id: "evoke-sacrifice",
        oracleText: `When ${cardName} enters, if its evoke cost was paid, sacrifice it.`,
        scope: "self",
        // Declared as `conditionOnSelf` (issue #1936), not `condition`: the
        // predicate reads only the source permanent, so the built ability
        // retains it as a DECIDABLE `{ onSelf }` `TriggerGate`. That is what
        // lets the bot's value model charge the self-sacrifice to an EVOKED
        // Incarnation only — a hard-cast one used to eat the same −40 for a
        // trigger that can never fire on it.
        conditionOnSelf: (self) => self.evoked === true,
        resolve: (ctx) => {
            ctx.sacrifice(ctx.sourceInstanceId);
        },
        // AI-only SHADOW script (PRD #1423, issue #1519) — never executed, only
        // walked by `OP_VALUERS` so the value model can see that this trigger
        // costs its controller the permanent. Without it every Evoke card is an
        // ability-level `resolve()` site the bot values as a no-op, which is
        // exactly backwards for the one trigger whose whole job is to give the
        // creature back. `{ op: "sacrifice", target: { ref: "$source" } }` is a
        // faithful transcription of the `resolve` body above (the same shape
        // the shared self-sacrifice factories in `arn/blue.ts` execute for
        // real); the closure is retained as the executed path so no shipped
        // Evoke card's runtime behaviour changes.
        aiEffects: [{ op: "sacrifice", target: { ref: "$source" } }],
    });
}
