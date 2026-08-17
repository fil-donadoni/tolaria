// `upkeepDiscardOrElseTrigger` — shared factory for the "at the beginning of
// your upkeep, sacrifice this unless you discard a card" maintenance-cost
// family (CR 603.6a beginning-of-upkeep trigger + CR 117.3a "unless you pay
// [cost]" intervening/alternative cost, where the cost is CR 701.9 discarding
// a card rather than mana). Solitary Confinement / Nettletooth-Djinn-style
// upkeep discards (issue #1129, parent PRD #1058).
//
// The existing "upkeep pay-or-else" family — `payOrSacrificeUpkeepTrigger`
// (leg/multicolor.ts), `makeUpkeepPayOrElse` (lea/white.ts, ice/*.ts), and
// drk/blue.ts's own local `upkeepPayOrElse` — all thread a
// `SpellContext.requestMayPay` call with a `ManaCost` / `MayPayCost` `cost`,
// the mana-pool (+ life / typed-sacrifice) payment path. A discard
// alternative cost is NOT a `MayPayCost` leg — nothing in that union names
// "give up a card from hand", and widening it would ripple through
// affordability (`canPayMayPayCost`), the submit boundary
// (`applyMayPaySubmit`), and every existing may-pay caller for a single new
// use. Instead this factory composes the ALREADY-SHIPPED primitives that
// solve exactly this shape — Oath of Lim-Dûl's "sacrifice ... unless you
// discard a card" punisher clause (ice/black.ts, issue #668): a cost-less
// `requestMayPay` (CR 117.3a yes/no, no `cost` field) offers the discard,
// `requestChoice({ kind: "choose-hand-card" })` (CR 701.8) picks the card,
// and `discardCard` performs it — the SAME `SpellContext.discardCard` choke
// point every other discard effect uses, which routes through
// `discardToGraveyard` so the CR 614 Library of Leng replacement applies AND
// `CARD_DISCARDED` fires (so "whenever you discard" triggers, e.g.
// Necropotence, still see it). No new primitive, no new PendingChoice kind,
// no new SpellContext method — pure composition of the choice/discard
// machinery Oath already proved out (mandatory reuse, `.claude/rules/
// gre-development.md` § Primitive reuse).
//
// `resolve()` here is shared ability-FACTORY infrastructure — the same
// footing as `payOrSacrificeUpkeepTrigger` / `cumulativeUpkeepTrigger` /
// `echoTrigger`, all of which are also `resolve`-based despite the DSL-first
// mandate: the body composes THREE suspend/resume primitives across a
// decline branch that itself conditionally re-suspends on a second primitive
// (may-pay → choose-hand-card → discardCard), a control-flow shape the DSL's
// `if`/`bind`/`ref`/`forEach` set doesn't model. The reusable unit is the
// factory itself (every future "sacrifice/destroy unless you discard"
// card calls this one function), not a per-card Effect Script — matching the
// established multi-primitive trigger-factory precedent, not the per-card
// DSL-first case (`.claude/rules/gre-development.md` § DSL-first authoring).
//
// CR 117.3a — the controller MAY discard a card instead of the default
// consequence (`onDecline`, typically sacrifice, CR 701.21). Auto-resolves
// straight to `onDecline` with an empty hand — Arena UX (`.claude/rules/
// gre-development.md`-adjacent convention): there is no real choice to
// present when the alternative is unavailable, so no prompt is shown at all.
// Mirrors Oath of Lim-Dûl's own `handIds.length > 0` gate.

import type { SpellContext, TriggeredAbility } from "../types";
import { phaseTrigger } from "./triggers/phaseTrigger";

export interface UpkeepDiscardOrElseArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle reminder text shown on the stack (CR 603.3a). */
    oracleText: string;
    /** Prompt shown for the "may discard a card" yes/no (CR 117.3a). */
    prompt: string;
    /** Runs when the controller declines the discard, OR has no card to
     *  discard (auto-resolved, no prompt). Typically
     *  `ctx.sacrifice(ctx.sourceInstanceId)` (CR 701.21); a `destroy` variant
     *  is legal too (mirrors `payOrSacrificeUpkeepTrigger`'s `consequence`). */
    onDecline: (ctx: SpellContext) => void;
}

/** Builds the "sacrifice this unless you discard a card" upkeep triggered
 *  ability (CR 603.6a + CR 117.3a + CR 701.8). Add it to a card's
 *  `triggeredAbilities`. */
export function upkeepDiscardOrElseTrigger(
    args: UpkeepDiscardOrElseArgs
): TriggeredAbility {
    return phaseTrigger({
        id: args.id,
        oracleText: args.oracleText,
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx, _event, scopedPlayerId) => {
            // CR 117.3a — only offer the discard alternative when a card
            // exists to discard; an empty hand has no real choice, so
            // auto-resolve straight to `onDecline` without suspending for a
            // prompt (Arena UX auto-resolve — no real option to present).
            const handIds = ctx.getHandIds(scopedPlayerId);
            if (handIds.length > 0) {
                const accept = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `${args.id}-${ctx.sourceInstanceId}-may`,
                    prompt: args.prompt,
                });
                if (accept === undefined) return; // suspended for the choice
                if (accept) {
                    // CR 701.9 — pick and discard exactly one card. Routes
                    // through `discardCard` (→ `discardToGraveyard`) so the
                    // Library of Leng replacement and CARD_DISCARDED
                    // triggers apply exactly like every other discard.
                    const picked = ctx.requestChoice({
                        playerId: scopedPlayerId,
                        choiceId: `${args.id}-${ctx.sourceInstanceId}-pick`,
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                    });
                    if (picked === undefined) return; // suspended
                    if (picked.length > 0) {
                        ctx.discardCard(scopedPlayerId, picked[0]);
                    }
                    return;
                }
            }
            args.onDecline(ctx);
        },
    });
}
