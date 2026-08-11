// `echoTrigger` — declarative template for Echo (CR 702.30), the Urza-block
// keyword that demands a repeat payment the turn after a permanent comes under
// your control.
//
// CR 702.30a: Echo is a triggered ability. "Echo [cost]" means "At the
// beginning of your upkeep, if this permanent came under your control since the
// beginning of your last upkeep, sacrifice it unless you pay [cost]." The cost
// is usually the permanent's mana cost (the modern errata prints the explicit
// cost — e.g. Goblin Patrol reads "Echo {R}").
//
// "Came under your control since your last upkeep" is tracked by the
// `echoPending` instance flag (state.ts): set true when a permanent whose
// definition declares the `echo` keyword enters the battlefield, and cleared by
// `ctx.markEchoPaid()` when this trigger resolves on the PAY branch. The
// trigger's CR 603.4 intervening-if gates on the flag so it fires EXACTLY ONCE
// — on the controller's first upkeep after the permanent came under control —
// and never again (the engine re-checks the intervening-if at resolution, and
// the flag deliberately stays set through any may-pay suspension, only clearing
// after the payment resolves).
//
// Structurally simpler than cumulative upkeep (no age counter, no cost scaling):
// a single may-pay-or-sacrifice at the controller's upkeep, so a plain
// `resolve` suffices — there is no irreversible pre-choice state change to
// isolate in its own step.

import type { MayPayCost, PermanentView, TriggeredAbility } from "../types";
import { phaseTrigger } from "./triggers/phaseTrigger";

export interface EchoArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id?: string;
    /** Oracle reminder text shown on the stack (CR 603.3a). Defaults to the
     *  standard echo reminder for the given cost. */
    oracleText?: string;
    /** The echo cost (CR 702.30a). A bare `ManaCost` (the common case) or the
     *  `{ mana?, life?, sacrifice? }` union for non-mana costs. */
    cost: MayPayCost;
    /** Label for the cost shown in the may-pay prompt (e.g. "{R}", "{1}{U}"). */
    costLabel: string;
}

/** Builds the Echo triggered ability (CR 702.30). Add it to a card's
 *  `triggeredAbilities`, and declare `"echo"` in the card's `staticAbilities`
 *  so the engine sets the `echoPending` flag when the permanent enters. */
export function echoTrigger(args: EchoArgs): TriggeredAbility {
    const oracle =
        args.oracleText ??
        `Echo ${args.costLabel} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)`;
    return phaseTrigger({
        id: args.id ?? "echo",
        oracleText: oracle,
        phase: "UPKEEP",
        scope: "your",
        // CR 702.30a — fire only while the echo cost is still owed. Checked at
        // trigger time AND re-checked at resolution (CR 603.4): the flag stays
        // set through any may-pay suspension and clears only after the pay
        // resolves, so the trigger neither fizzles mid-resolution nor re-fires.
        interveningIf: (_event, self: PermanentView) =>
            self.echoPending === true,
        resolve: (ctx, _event, scopedPlayerId) => {
            const accept = ctx.requestMayPay({
                playerId: scopedPlayerId,
                choiceId: `echo-${ctx.sourceInstanceId}`,
                cost: args.cost,
                prompt: `Pay echo (${args.costLabel}) to keep this permanent?`,
            });
            if (accept === undefined) return; // suspended for the choice
            // CR 702.30a — declined or unable to pay: sacrifice it. The engine
            // collapses "can't pay" into the decline branch (the affordability
            // gate prevents accepting a cost the pool can't cover), so a single
            // `false` covers both. On payment, clear the flag so echo never
            // re-triggers on a later upkeep.
            if (!accept) {
                ctx.sacrifice(ctx.sourceInstanceId);
            } else {
                ctx.markEchoPaid();
            }
        },
    });
}
