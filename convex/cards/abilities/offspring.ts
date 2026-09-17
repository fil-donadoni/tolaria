// Offspring (CR 702.175) — the keyword that means TWO abilities, of which this
// file is the second.
//
// CR 702.175a: "Offspring represents two abilities. 'Offspring [cost]' means
//              'You may pay an additional [cost] as you cast this spell' and
//              'When this permanent enters, if its offspring cost was paid,
//              create a token that's a copy of it, except it's 1/1.'"
// CR 702.175b: "If a spell has multiple instances of offspring, each is paid
//              separately and triggers based on the payments made for it, not
//              any other instances of offspring."
//
// ── Which half lives where ──────────────────────────────────────────────────
//
// COST HALF — NOT this file. It is a `kickers[]` entry (ADR 0079) carrying the
// ADR 0085 discriminator `keyword: "offspring"`, because CR 702.175a's cost
// clause is Kicker's cost clause word for word (CR 702.33a) and the shared
// announcement/payment path already expresses it. What the discriminator buys
// is CR 702.33d: "kicked" is defined over KICKER costs alone, so the
// ADDITIONAL_COST_KEYWORDS row (`gre/kicker.ts`) says `countsAsKicked: false`
// and the payment lands in `StackItem.unkickedCostPayments`, invisible to
// `wasKicked`, the `count: "kicker"` ETB tally, `{ kickerCount: true }`, the
// kicked target-requirement swap and the client's `spellWasKicked` filter —
// while `{ additionalCostPaid: "<id>" }` still reads it. An offspring-paid
// spell is NOT a kicked spell.
//
// Offspring is an ADDITIONAL cost, not an alternative one (CR 601.2f): the
// printed mana cost is still paid in full, plus the offspring cost.
//
// TRIGGER HALF — {@link offspringTrigger}, a reusable template rather than a
// per-card literal, following the shape `dashTrigger` established for the
// other keyword that means two abilities (CR 702.109a). The two halves are
// declared SEPARATELY on the card and are never fused into one object: they
// ride different engine seams, and CR 702.175b needs them separable — a card
// with two instances of offspring declares two cost entries with distinct ids
// and two triggers, one per id.
//
// ── Why the factory takes the cost entry's id ───────────────────────────────
//
// CR 702.175b. The payment record is keyed by `KickerCost.id`, never by
// keyword, so "triggers based on the payments made for IT, not any other
// instances" is exactly "each trigger reads its own id". A factory that
// hardcoded the string "offspring" would silently fuse two instances into one.
//
// ── Why the gate is shaped the way it is ────────────────────────────────────
//
// CR 702.175a's "if its offspring cost was paid" is an intervening if
// (CR 603.4), which is TWO checks, and this template ships both — but neither
// of them is a declared `interveningIf`:
//
//   1. CHECK-TIME (`conditionOnSelf`, the shared `additionalCostPaidCondition`
//      predicate over the permanent's own snapshotted record): with the cost
//      unpaid the ability never goes on the stack at all, which is what
//      CR 603.4 asks for and what a resolution-time branch alone could not
//      give — the trigger would still have been announced.
//   2. RESOLUTION-TIME (the `if { additionalCostPaid }` branch inside
//      `effects[]`): this reads the RESOLVING STACK ITEM's own payment record
//      (`buildTriggerItem`'s `...self` spread, `gre/triggers.ts`), a snapshot
//      taken when the trigger was built.
//
// Step 2 is deliberately NOT a declared `interveningIf`, and the difference is
// load-bearing here in a way it is not for squad. `resolveTopOfStackInner`
// evaluates a declared `interveningIf` against the LIVE permanent, and
// CR 400.7 makes a blink that reuses the instance id read a
// `resetBattlefieldTransientState`-cleared payment record — the divergence
// issue #2042 found. The stack item's own copy is unaffected by anything that
// happens to the permanent after the trigger was built, which is also why
// killing the creature in response still produces the token. It also covers
// strictly more: an ability COPY put on the stack never re-runs `matches`
// (CR 707.10), so without the branch a copied offspring trigger would make a
// token off a cost nobody paid.
//
// Squad (CR 702.157a) needs no such branch only because its token COUNT is the
// payment tally itself and the Op skips a non-positive count. Offspring makes
// exactly one token whatever the tally, so the branch is the gate.
//
// ── The body ────────────────────────────────────────────────────────────────
//
// One already-exercised Op. `createTokenCopy` with `source: { ref: "$source" }`
// plus CR 707.2's "except" clause as `except: { basePower: 1, baseToughness: 1 }`
// (issue #2076) — "a copy of it, except it's 1/1" is the same `CopyEffectOptions`
// path Eternalize's "except it's a 4/4 black Zombie" already rides, so no new
// execution path.
//
// CR 608.2h / 111.12: the source is read through the LKI store (ADR 0086,
// issue #2075) when the permanent is no longer on the battlefield, so a
// creature killed in RESPONSE to the trigger still produces the token, built
// from the copiable values it last had there. CR 111.12's "no token is created"
// applies to a nonexistent object, explicitly NOT to one the effect uses last
// known information for.
//
// The token carries no offspring payment record of its own: CR 707.2 copies
// COPIABLE values and a payment record is not one, so the token's own copy of
// this trigger is check-time-gated to silence and no token makes further
// tokens — with no suppression code anywhere.
import type { AdditionalCostTwin, TriggeredAbility } from "../types";
import { enteredTrigger } from "./triggers/enteredTrigger";
import {
    additionalCostPaidCondition,
    withAdditionalCostTwin,
} from "./triggers/shared";

/** The `KickerCost.id` a single-instance offspring card's cost entry should
 *  use. Offered so the card and its trigger cannot disagree by a typo in the
 *  common case; CR 702.175b's multi-instance card names its own two ids and
 *  passes each to its own {@link offspringTrigger}. */
export const OFFSPRING_COST_ID = "offspring";

export interface OffspringTriggerArgs {
    /** The card's name, for the oracle line shown on the stack. */
    cardName: string;
    /** The `KickerCost.id` of the offspring cost entry this trigger is the twin
     *  of (CR 702.175b — per INSTANCE, never per keyword). Defaults to
     *  {@link OFFSPRING_COST_ID} for the single-instance card. */
    costId?: string;
    /** Overrides the generated ability id. A card with two instances of
     *  offspring needs two distinct ids; the default derives one from `costId`,
     *  which is already distinct per instance, so this is rarely needed. */
    id?: string;
}

/** Builds the Offspring token-copy trigger (CR 702.175a's second ability). Add
 *  it to the card's `triggeredAbilities[]` ALONGSIDE the card's own ETB
 *  abilities (if any) and alongside the `kickers[]` cost entry named by
 *  `costId` — the catalogue guard
 *  (`cards/__tests__/additionalCostKeywords.test.ts`) fails on either half
 *  without the other, in both directions. */
export function offspringTrigger(args: OffspringTriggerArgs): TriggeredAbility {
    const costId = args.costId ?? OFFSPRING_COST_ID;
    const twin: AdditionalCostTwin = { keyword: "offspring", costId };
    return withAdditionalCostTwin(
        enteredTrigger({
            id: args.id ?? `offspring-token-copy-${costId}`,
            // CR 702.175a verbatim, with the card's name substituted for "this
            // permanent" the way an Oracle line reads on the stack.
            oracleText: `When ${args.cardName} enters, if its offspring cost was paid, create a token that's a copy of it, except it's 1/1.`,
            // CR 702.175a says "this PERMANENT", not "this creature" — every
            // printed offspring card is a creature, but the scope is the
            // source itself either way.
            scope: "self",
            // CR 603.4, check 1 — an unpaid offspring cost announces nothing.
            conditionOnSelf: additionalCostPaidCondition(costId),
            effects: [
                {
                    // CR 603.4, check 2 — read off the resolving stack item's
                    // own snapshot, never the live permanent.
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: costId },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "createTokenCopy",
                            source: { ref: "$source" },
                            controller: "controller",
                            // CR 707.2's "except" clause — "except it's 1/1".
                            except: { basePower: 1, baseToughness: 1 },
                        },
                    ],
                },
            ],
        }),
        twin
    );
}
