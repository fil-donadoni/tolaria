/**
 * Shared sub-grammar: "Hexproof from [quality]" (CR 702.11d).
 *
 * Hexproof-from is a PARAMETERISED keyword, read the way "Protection from
 * [quality]" is (`protectionKeyword.ts`): the registry names "Hexproof from",
 * the printed line carries the quality, and the engine's single authority on
 * which qualities it can honour is `parseHexproofQuality`
 * (`gre/hexproofQuality.ts`). This rule reads a quality ONLY if that parser
 * can name it and emits the engine's own `staticAbilities[]` string
 * ("hexproof from monocolored"), so the grammar and the engine cannot disagree
 * about what a quality is.
 *
 * Fail-closed: a quality the parser returns `null` for ("artifacts and
 * enchantments", "each color", "planeswalkers", "activated and triggered
 * abilities", …) is REFUSED, never compiled to a hexproof that would ship
 * inert or over-broad.
 *
 * CR 702.11f — "hexproof from [quality A] and from [quality B]" is shorthand
 * for two separate hexproof abilities, so it lowers to two keywords.
 */

import { parseHexproofQuality } from "../../../gre/hexproofQuality";
import { fail, ok, rule, type Rule } from "../../rule";
import type { KeywordIR } from "../ir";
import { keywordVocabulary } from "./keywordVocabulary";

const HEXPROOF_FROM_HEAD = "hexproof from ";
const AND_FROM = " and from ";

/** `"Hexproof from white and from black"` → `["hexproof from white", …]`. */
export const hexproofFromKeywordsRule: Rule<readonly KeywordIR[]> = rule(
    "hexproof from",
    (span) => {
        if (!span.toLowerCase().startsWith(HEXPROOF_FROM_HEAD))
            return fail(
                `a hexproof-from line starts with "Hexproof from"`,
                span
            );
        const base = keywordVocabulary().get("hexproof from");
        if (base === undefined)
            return fail("the registry carries no Hexproof from keyword", span);
        const qualities = span.slice(HEXPROOF_FROM_HEAD.length).split(AND_FROM);
        if (qualities.length > 2)
            return fail(
                'a hexproof-from list is "A" or "A and from B" (CR 702.11f)',
                span
            );
        const keywords: KeywordIR[] = [];
        for (const quality of qualities) {
            const ability = `${HEXPROOF_FROM_HEAD}${quality}`.toLowerCase();
            if (parseHexproofQuality(ability) === null)
                return fail(
                    `"${quality}" is not a hexproof quality the engine can name (CR 702.11d)`,
                    span
                );
            keywords.push({ ...base, ability });
        }
        return ok(keywords);
    }
);
