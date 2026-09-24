/**
 * Shared sub-grammar: "Protection from [quality]" (CR 702.16a).
 *
 * Protection is a PARAMETERISED keyword: the registry names "Protection", the
 * printed line carries the quality. The engine's single authority on which
 * qualities it can honour is `parseProtectionQuality` (`gre/protection.ts`):
 * colours and colourless, card types and supertypes, "each of your opponents",
 * "everything", "spells that are one or more colors". This rule reads a quality
 * ONLY if that parser can name it, and emits the engine's own
 * `staticAbilities[]` string ("protection from green"), so the grammar and the
 * engine cannot disagree about what a quality is — a new family added to the
 * parser is accepted here with no edit.
 *
 * Fail-closed: a quality the parser returns `null` for (a creature subtype
 * such as "Goblins", "multicolored", "non-Spirit creatures", a counter
 * clause, …) is REFUSED, never compiled to a protection that would ship inert.
 *
 * CR 702.16g — "protection from [quality A] and from [quality B]" is
 * shorthand for two separate protection abilities, so it lowers to two
 * keywords; the printed three-way list ("from blue, from black, and from red")
 * is the same shorthand and reads the same way. The comma list is only whole
 * when it is the entire line — the keyword line splits a run at ", " first —
 * so {@link protectionListRule} is the line-level entry for it.
 */

import { parseProtectionQuality } from "../../../gre/protection";
import { fail, ok, rule, type Rule } from "../../rule";
import type { KeywordIR } from "../ir";
import { keywordVocabulary } from "./keywordVocabulary";

const PROTECTION_HEAD = "protection from ";
const AND_FROM = " and from ";
const COMMA_FROM = ", from ";
const COMMA_AND_FROM = ", and from ";

/**
 * The printed shapes only: one quality, "A and from B", or the list "A, from
 * B, and from C" (final separator ", and from"). Anything else — a bare
 * "A, from B", mixed separators, a third "and from" — is not printed and is
 * refused rather than read.
 */
function splitQualities(rest: string): readonly string[] | null {
    if (rest.includes(COMMA_FROM)) {
        const head = rest.lastIndexOf(COMMA_AND_FROM);
        if (head < 0) return null;
        const items = [
            ...rest.slice(0, head).split(COMMA_FROM),
            rest.slice(head + COMMA_AND_FROM.length),
        ];
        return items.length >= 3 &&
            items.every((q) => !q.includes(AND_FROM) && !q.includes(", "))
            ? items
            : null;
    }
    const items = rest.split(AND_FROM);
    return items.length <= 2 && items.every((q) => !q.includes(", "))
        ? items
        : null;
}

/** `"Protection from black and from red"` → `["protection from black", …]`. */
export const protectionKeywordsRule: Rule<readonly KeywordIR[]> = rule(
    "protection",
    (span) => {
        if (!span.toLowerCase().startsWith(PROTECTION_HEAD))
            return fail(
                `a protection line starts with "Protection from"`,
                span
            );
        const base = keywordVocabulary().get("protection");
        if (base === undefined)
            return fail("the registry carries no Protection keyword", span);
        const qualities = splitQualities(span.slice(PROTECTION_HEAD.length));
        if (qualities === null)
            return fail(
                'a protection list is "A", "A and from B" or "A, from B, and from C" (CR 702.16g)',
                span
            );
        const keywords: KeywordIR[] = [];
        for (const quality of qualities) {
            const ability = `${PROTECTION_HEAD}${quality}`.toLowerCase();
            if (
                quality.trim() === "" ||
                parseProtectionQuality(ability) === null
            )
                return fail(
                    `"${quality}" is not a protection quality the engine can name (CR 702.16a)`,
                    span
                );
            keywords.push({ ...base, ability });
        }
        return ok(keywords);
    }
);

/**
 * A whole line that is a comma-separated protection list. Disjoint from the
 * keyword run by construction: it refuses any span without ", from ", which is
 * exactly the span the run cannot read (its comma pieces are not keywords).
 */
export const protectionListRule: Rule<readonly KeywordIR[]> = rule(
    "protection list",
    (span, ctx) =>
        span.includes(COMMA_FROM)
            ? protectionKeywordsRule.run(span, ctx)
            : fail(`a protection list names "${COMMA_FROM}"`, span)
);
