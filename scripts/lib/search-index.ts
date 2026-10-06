/**
 * The deck-builder SEARCH INDEX as a generated asset (issue #4861, ADR 0113
 * Amendment IV) — the rows the browser used to derive by walking the whole
 * hydrated catalogue, derived here instead, by `bun run catalogue:pack`.
 *
 * The derivation is `convex/cards/searchIndex.ts`'s own (`toSearchIndexRow`
 * over expanded definitions), run on the rows THIS generation writes — the
 * hand-written walk and `merge.serverRows` — never on the catalogue loaded in
 * the generator's process, which still holds the PREVIOUS generation's
 * compiled rows. The gate (`scripts/__tests__/catalogue-artifact.test.ts`)
 * proves the two agree on a current tree: the committed index equals
 * `buildSearchIndex()` over the live catalogue.
 */
import type { HandWrittenExport } from "../../convex/cards/definitionIndex";
import { expandDefinition } from "../../convex/cards/registry";
import {
    serializeSearchIndex,
    toSearchIndexRow,
    type SearchIndexRow,
} from "../../convex/cards/searchIndex";
import type { CardDefinition } from "../../convex/cards/types";

/** Beside the Definition Index, under a name the stale-artifact sweep
 *  (`catalogue-*.json`) does not match. */
export const SEARCH_INDEX_PATH = "data/catalogue/search-index.json";

/** The rows in catalogue order: hand-written (the walk's order, which is the
 *  Definition Index's), then every compiled row no hand-written card covers
 *  (ADR 0108), in the packed corpus's order. */
export function buildSearchIndexRows(
    handWritten: readonly HandWrittenExport[],
    compiled: readonly CardDefinition[]
): SearchIndexRow[] {
    const handWrittenIds = new Set(handWritten.map((e) => e.definition.id));
    return [
        ...handWritten.map((e) =>
            toSearchIndexRow(expandDefinition(e.definition), e.setCode)
        ),
        ...compiled
            .filter((row) => !handWrittenIds.has(row.id))
            .map((row) =>
                toSearchIndexRow(expandDefinition(row), row.setCode ?? "")
            ),
    ];
}

/** The committed bytes. */
export const buildSearchIndexBytes = (
    handWritten: readonly HandWrittenExport[],
    compiled: readonly CardDefinition[]
): string => serializeSearchIndex(buildSearchIndexRows(handWritten, compiled));
