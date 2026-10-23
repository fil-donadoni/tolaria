// The seam between the effect clauses and the slots that read a quoted ability.
//
// "… becomes a 1/1 black Skeleton creature with \"{B}: Regenerate this
// creature\" until end of turn" (CR 113.1a, CR 613.1f) grants an ability
// printed in quotation marks, which only the activated / mana / triggered
// slots can read. Those slots read their effects through `effectClause`, so
// `effectClause` cannot import them (import cycle at module evaluation).
// `staticClause` — which already imports the slots to read the same quote on an
// Aura's host — registers its reader here once, and the effect clause calls it
// at parse time. An unregistered reader refuses the quote (fail-closed, ADR
// 0105 § 2) rather than guessing.

import { fail, type RuleResult } from "../../rule";
import type { ParseContext } from "../../types";
import type { QuotedAbilityIR } from "./staticClause";

export type QuotedAbilityReader = (
    text: string,
    ctx: ParseContext
) => RuleResult<QuotedAbilityIR>;

let reader: QuotedAbilityReader | null = null;

export function registerQuotedAbilityReader(read: QuotedAbilityReader): void {
    reader = read;
}

/** Reads `text` as an ability the permanent being described will carry. */
export function readQuotedAbilityOf(
    text: string,
    ctx: ParseContext
): RuleResult<QuotedAbilityIR> {
    if (reader === null)
        return fail("no quoted-ability reader registered", text);
    return reader(text, ctx);
}
