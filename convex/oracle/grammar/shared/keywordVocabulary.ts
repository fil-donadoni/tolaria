/**
 * Shared vocabulary: the keyword abilities the grammar recognises by NAME
 * (CR 702.1).
 *
 * DERIVED from the Mechanics Registry, never hand-listed: the registry is this
 * repo's single authority on mechanic names (CLAUDE.md § Card Definition
 * System), and a hand-copied list would be a second authority that drifts.
 *
 * Its own module rather than a member of the keyword-line slot because four
 * grammars read it — the keyword line, the object descriptor's "with flying"
 * qualifier, the effect clause's "gains flying" and the static clause's keyword
 * grant — and the keyword line in turn reads the object descriptor for its
 * `Enchant <descriptor>` form (CR 702.5a). Leaving the table in the slot made
 * that a module cycle in which `targetFilter.ts` reads the table at load time,
 * before the slot module has defined it.
 */

import { MECHANICS_REGISTRY } from "../../../cards/mechanicsRegistry";
import type { KeywordIR } from "../ir";

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

/** The grammar's accepted keyword spellings. */
export function keywordVocabulary(): ReadonlyMap<string, KeywordIR> {
    return KEYWORD_VOCABULARY;
}
