/**
 * Shared sub-grammar: CONDITION — the intervening-if clause on a trigger
 * (CR 603.4), "…, if you control a Goblin, …".
 *
 * "Dropped intervening-if" is a named competitor misparse: the ability still
 * triggers, so nothing looks broken until the game state quietly diverges. The
 * fail-closed half of that rule is what this file is — a condition phrase the
 * grammar cannot read fails the LINE, so the trigger is never emitted without
 * its gate.
 *
 * ── Why v1 knows exactly one condition ─────────────────────────────────────
 *
 * The corpus measurement behind #2698 is the whole argument: of the trigger
 * lines carrying an intervening-if, 1,113 cards sit behind 1,086 DISTINCT
 * condition fragments — an almost perfectly flat tail, where "if this land is
 * tapped" (5 cards) is near the TOP. There is no head to this distribution, so
 * a vocabulary sized to it would be a hundred one-card rules, each a fresh
 * chance to misread a clause. `controls` is the one shape that repeats across
 * unrelated cards, and the next member is earned by a fragment count rather
 * than by anticipation — the same rule an Effect Op earns its registry row by
 * (ADR 0045).
 */

import { fail, ok, rule, type Rule } from "../../rule";
import { descriptorRule, permanentFilterFromDescriptor } from "./targetFilter";
import type { PermanentFilter } from "../../../cards/filters";

export const CONDITION = "condition";

/**
 * A condition, in the sentence's own vocabulary.
 *
 * `atLeast` rather than a bare boolean because CR 603.4 conditions count
 * ("if you control two or more Goblins"); v1 only READS the singular article,
 * but the field means the comparison rather than the phrasing, so the plural
 * rule that arrives later changes the grammar and not the IR.
 */
export type ConditionIR = {
    readonly kind: "controls";
    readonly filter: PermanentFilter;
    readonly atLeast: number;
};

const ARTICLES: readonly string[] = ["a ", "an "];

/**
 * `"if you control a Goblin"` (CR 603.4 / 109.5 — "you" is the ability's
 * controller).
 *
 * The controller relation lives in the CONDITION, not in the descriptor: the
 * clause already says "you control", so a descriptor that ALSO carried a
 * controller clause ("if you control a creature you control") would be a
 * phrase we have misread. `permanentFilterFromDescriptor` refuses a
 * `controller` field outright, which is exactly that check and is not repeated
 * here.
 */
export const conditionRule: Rule<ConditionIR> = rule(CONDITION, (span, ctx) => {
    const opener = "if you control ";
    if (!span.startsWith(opener))
        return fail("not a condition this grammar knows", span);
    const rest = span.slice(opener.length);
    const article = ARTICLES.find((a) => rest.startsWith(a));
    if (article === undefined)
        return fail(
            'a "you control" condition counts a singular descriptor',
            span
        );
    const descriptor = descriptorRule.run(rest.slice(article.length), ctx);
    if (!descriptor.ok) return descriptor;
    if (descriptor.value.plural === true)
        return fail('"a" introduces a singular descriptor', span);
    const filter = permanentFilterFromDescriptor(descriptor.value);
    if (!filter.ok) return filter;
    return ok({ kind: "controls" as const, filter: filter.value, atLeast: 1 });
});
