/**
 * Slot: keyword line (CR 113.3d static abilities named as keywords, CR 702.1).
 *
 * A keyword line is a line whose entire content is keyword ability names,
 * separated by `"; "` or `", "` — "Flying", "Flying, vigilance",
 * "Flying; banding".
 *
 * The vocabulary is DERIVED from the Mechanics Registry, never hand-listed
 * here: the registry is this repo's single authority on mechanic names
 * (CLAUDE.md § Card Definition System), and a hand-copied list would be a
 * second authority that drifts. A name the registry does not carry is not a
 * keyword as far as this compiler is concerned, and the card fails — which is
 * also, for free, how PARAMETERISED keywords stay out of grammar v0: "Rampage
 * 1", "Protection from white" and "Ward {4}" are not registry names, so they do
 * not match, so the card is `unparsed` rather than compiled with the parameter
 * dropped. Dropping a parameter is precisely the misparse class this compiler
 * exists to refuse.
 */

import { MECHANICS_REGISTRY } from "../../../cards/mechanicsRegistry";
import {
    atom,
    fail,
    listOf,
    map,
    ok,
    rule,
    type Rule,
    type RuleResult,
} from "../../rule";
import type { KeywordIR, SlotIR } from "../ir";

/** name (lowercased) → the keyword it denotes. Built once, from the registry. */
const KEYWORD_VOCABULARY: ReadonlyMap<string, KeywordIR> = (() => {
    const table = new Map<string, KeywordIR>();
    for (const row of MECHANICS_REGISTRY) {
        if (row.kind !== "keyword-ability") continue;
        const spelling = row.name.toLowerCase();
        // A duplicate spelling would make the vocabulary ambiguous; the registry
        // guard already forbids duplicate names, so this is a tripwire.
        if (table.has(spelling)) continue;
        table.set(spelling, {
            registryId: row.id,
            ability: spelling,
            status: row.status,
        });
    }
    return table;
})();

/** Exposed for the vocabulary test — the grammar's accepted keyword spellings. */
export function keywordVocabulary(): ReadonlyMap<string, KeywordIR> {
    return KEYWORD_VOCABULARY;
}

const keyword: Rule<KeywordIR> = atom("keyword ability", KEYWORD_VOCABULARY);

/** `"Flying, vigilance"` — a comma-separated run of keywords. */
const commaRun: Rule<KeywordIR[]> = listOf("keyword run", ", ", keyword);

/** `"Flying; banding"` — semicolon groups, each a comma run (CR 702.1). */
const semicolonGroups: Rule<KeywordIR[][]> = listOf(
    "keyword groups",
    "; ",
    commaRun
);

export const KEYWORD_LINE_SLOT = "keyword-line";

export const keywordLineRule: Rule<SlotIR> = map(
    semicolonGroups,
    (groups): RuleResult<SlotIR> => {
        const keywords = groups.flat();
        const seen = new Set<string>();
        for (const k of keywords) {
            // The same keyword twice on one line is not a shape Magic prints;
            // it is a sign the line was misread, so it fails rather than being
            // silently deduped.
            if (seen.has(k.registryId)) {
                return fail(
                    `keyword "${k.ability}" named twice on one line`,
                    k.ability
                );
            }
            seen.add(k.registryId);
        }
        return ok({ kind: "keywords", keywords });
    }
);

/** Guard: keyword lines are only meaningful on an object with a text box. */
export const keywordLineSlot: Rule<SlotIR> = rule(
    KEYWORD_LINE_SLOT,
    (span, ctx) => keywordLineRule.run(span, ctx)
);
