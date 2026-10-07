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
import { LANDWALK_KEYWORD_BY_BASIC_TYPE } from "../../../cards/types";
import type { KeywordIR } from "../ir";

/**
 * CR 702.14 — landwalk is ONE registry row ("Landwalk") whose printed
 * spellings are one keyword per basic land type ("islandwalk", "forestwalk",
 * …): the row's `bindingPattern` is what the engine accepts. The spellings are
 * read from `LANDWALK_KEYWORD_BY_BASIC_TYPE`, the table the engine's landwalk
 * evasion is already derived from, so the grammar and the engine cannot drift.
 * Snow, legendary and desert landwalk are not here: no fixture prints them.
 */
const LANDWALK_SPELLINGS: readonly string[] = Object.values(
    LANDWALK_KEYWORD_BY_BASIC_TYPE
);

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
        if (row.id !== "landwalk") continue;
        for (const variant of LANDWALK_SPELLINGS) {
            table.set(variant, {
                registryId: row.id,
                ability: variant,
                status: row.status,
            });
        }
    }
    return table;
})();

/** The grammar's accepted keyword spellings. */
export function keywordVocabulary(): ReadonlyMap<string, KeywordIR> {
    return KEYWORD_VOCABULARY;
}
