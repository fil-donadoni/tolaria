/**
 * Shared sub-grammar: THE PAYMENT OF A "SACRIFICE IT UNLESS YOU …" RIDER
 * (CR 118.12a, issue #4548).
 *
 * The tail of "sacrifice it unless you <payment>": the one decision the
 * controller makes on resolution, paying to keep the permanent or losing it.
 * The lowering is the `mayPay` + `if not` pair every hand-written punisher
 * already writes (Phyrexian Dreadnought, Treva's Ruins), so each payment here
 * maps onto ONE leg of the shared `CostLegs` vocabulary (ADR 0079) and nothing
 * else — a payment with no leg is refused, never approximated:
 *
 *   - "pay {U}"                        → `mana`
 *   - "discard a card"                 → `hand` (discard)
 *   - "sacrifice a Forest"             → `permanent` (sacrifice, one)
 *   - "sacrifice any number of creatures with total power 12 or greater"
 *                                      → `permanent` (sacrifice, threshold)
 *   - "return a non-Lair land you control to its owner's hand"
 *                                      → `permanent` (return)
 *
 * Fail-closed: "pay N life" and "return a basic land card from your graveyard
 * to your hand" are real printed payments with no fixture and no cost leg
 * (the engine's `permanent` leg returns BATTLEFIELD permanents only), so they
 * stay refused under their own gap keys.
 */

import type {
    ManaCost,
    MayPayCost,
    PermanentFilter,
} from "../../../cards/types";
import { readManaCost } from "../../manaCost";
import { fail, ok, type RuleContext, type RuleResult } from "../../rule";
import { descriptorRule, permanentFilterFromDescriptor } from "./targetFilter";

export type UnlessPaymentIR =
    /** CR 118.1 — "pay {U}": mana. */
    | { readonly kind: "mana"; readonly mana: ManaCost }
    /** CR 701.9a — "discard a card": a card of the payer's choice. */
    | { readonly kind: "discard-card" }
    /** CR 701.21a — "sacrifice a Forest": one permanent of the payer's choice. */
    | { readonly kind: "sacrifice"; readonly filter: PermanentFilter }
    /** CR 701.21a — "sacrifice any number of creatures with total power N or
     *  greater": a variable-size set whose summed power meets the threshold. */
    | {
          readonly kind: "sacrifice-total-power";
          readonly filter: PermanentFilter;
          readonly minTotalPower: number;
      }
    /** CR 400.7 — "return a land you control to its owner's hand". */
    | { readonly kind: "return"; readonly filter: PermanentFilter };

const PAY = /^pay (\{.+\})$/;
const SACRIFICE_TOTAL_POWER =
    /^sacrifice any number of (.+) with total power (\d+) or greater$/;
const SACRIFICE_ONE = /^sacrifice an? (.+)$/;
const RETURN_ONE = /^return an? (.+) to its owner's hand$/;

/** Descriptor text → the cost filter, refusing a plural/singular mismatch. */
function filterOf(
    text: string,
    plural: boolean,
    ctx: RuleContext
): RuleResult<PermanentFilter> {
    const descriptor = descriptorRule.run(text, ctx);
    if (!descriptor.ok) return descriptor;
    if ((descriptor.value.plural === true) !== plural)
        return fail(`"${text}" disagrees in number`, text);
    return permanentFilterFromDescriptor(descriptor.value);
}

/**
 * The words after "unless you ", read whole. The span is lowercase-initial, as
 * it sits mid-sentence.
 */
export function readUnlessPayment(
    span: string,
    ctx: RuleContext
): RuleResult<UnlessPaymentIR> {
    const pay = span.match(PAY);
    if (pay !== null) {
        const mana = readManaCost(pay[1]!);
        return mana.ok
            ? ok({ kind: "mana" as const, mana: mana.cost })
            : fail(mana.reason, mana.fragment);
    }
    if (span === "discard a card") return ok({ kind: "discard-card" as const });

    const threshold = span.match(SACRIFICE_TOTAL_POWER);
    if (threshold !== null) {
        const filter = filterOf(threshold[1]!, true, ctx);
        if (!filter.ok) return filter;
        return ok({
            kind: "sacrifice-total-power" as const,
            filter: filter.value,
            minTotalPower: Number(threshold[2]),
        });
    }

    const sacrifice = span.match(SACRIFICE_ONE);
    if (sacrifice !== null) {
        const filter = filterOf(sacrifice[1]!, false, ctx);
        if (!filter.ok) return filter;
        return ok({ kind: "sacrifice" as const, filter: filter.value });
    }

    const back = span.match(RETURN_ONE);
    if (back !== null) {
        // The payer returns a permanent THEY control; the cost leg's pool is
        // the payer's own battlefield, so "you control" is the leg itself and
        // is checked, then dropped from the filter.
        const descriptor = descriptorRule.run(back[1]!, ctx);
        if (!descriptor.ok) return descriptor;
        const { controller, ...rest } = descriptor.value;
        if (controller !== "you")
            return fail("a return cost returns permanents you control", span);
        if (rest.plural === true)
            return fail(`"${back[1]}" disagrees in number`, span);
        const filter = permanentFilterFromDescriptor(rest);
        if (!filter.ok) return filter;
        return ok({ kind: "return" as const, filter: filter.value });
    }

    return fail(`"${span}" is not an unless-payment this grammar reads`, span);
}

/** Payment IR → the `mayPay` Op's cost (ADR 0079). */
export function lowerUnlessPayment(payment: UnlessPaymentIR): MayPayCost {
    switch (payment.kind) {
        case "mana":
            return payment.mana;
        case "discard-card":
            return {
                hand: {
                    action: "discard",
                    requirements: [{ filter: {}, count: 1 }],
                },
            };
        case "sacrifice":
            return {
                permanent: {
                    action: "sacrifice",
                    filter: payment.filter,
                    count: 1,
                },
            };
        case "sacrifice-total-power":
            return {
                permanent: {
                    action: "sacrifice",
                    filter: payment.filter,
                    count: { minTotalPower: payment.minTotalPower },
                },
            };
        case "return":
            return {
                permanent: {
                    action: "return",
                    filter: payment.filter,
                    count: 1,
                },
            };
    }
}

/** The prompt the payer reads: the payment, then the loss it avoids. */
export function unlessPaymentPrompt(
    payment: UnlessPaymentIR,
    selfName: string
): string {
    const ask = ((): string => {
        switch (payment.kind) {
            case "mana":
                return "Pay the cost";
            case "discard-card":
                return "Discard a card";
            case "sacrifice":
                return "Sacrifice a permanent";
            case "sacrifice-total-power":
                return `Sacrifice creatures with total power ${payment.minTotalPower} or greater`;
            case "return":
                return "Return a permanent you control to its owner's hand";
        }
    })();
    return `${ask}, or sacrifice ${selfName}?`;
}
