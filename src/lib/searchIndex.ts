// The client's handle on the deck-builder search index (issue #3054), loaded
// as a generated asset since issue #4861.
//
// The rows are derived ahead of time by `bun run catalogue:pack` with
// `convex/cards/searchIndex.ts`'s own derivation (types and derivations live
// in `convex/`, the source of truth) and committed as
// `data/catalogue/search-index.json`. The client no longer holds the whole
// catalogue (ADR 0113 Amendment IV): deriving the rows here would decode every
// packed block to search it, so the deck builder reads this index instead and
// decodes only the cards it shows.
//
// WHY A MODULE-LEVEL MEMO AND NOT PER-COMPONENT STATE. Two surfaces read the
// index — the search hook and the type filter — and both key their filter
// memos on the rows' identity. One module-level value gives both the same
// rows and the same reference for the life of the document, and fetches the
// asset once.
//
// WHY A FETCH. Vite emits the file as an asset whose name carries its content
// hash, so the browser caches it as immutable, and only a surface that
// searches ever downloads it — a game never does.
import { useEffect, useState } from "react";
import searchIndexUrl from "../../data/catalogue/search-index.json?url";
import {
    fromSearchIndexWire,
    type SearchIndexRow,
    type SearchIndexWireRow,
} from "@convex/cards/searchIndex";
import { fetchJsonAsset } from "./fetchJsonAsset";

let cached: readonly SearchIndexRow[] | null = null;
let loading: Promise<readonly SearchIndexRow[]> | null = null;

/** The search index, fetched on first call and shared from then on. A
 *  rejection is not memoised: the next caller re-fetches. */
export function loadSearchIndex(): Promise<readonly SearchIndexRow[]> {
    if (cached !== null) return Promise.resolve(cached);
    loading ??= fetchSearchIndex().then(
        (rows) => {
            cached = rows;
            return rows;
        },
        (error: unknown) => {
            loading = null;
            throw error;
        }
    );
    return loading;
}

async function fetchSearchIndex(): Promise<readonly SearchIndexRow[]> {
    const wire = await fetchJsonAsset(searchIndexUrl, "search index");
    if (!Array.isArray(wire) || wire.length === 0) {
        throw new Error(
            `search index ${searchIndexUrl} is not a non-empty array of rows`
        );
    }
    return fromSearchIndexWire(wire as SearchIndexWireRow[]);
}

export interface SearchIndexResult {
    /** `undefined` while the asset loads, or after it failed. */
    rows: readonly SearchIndexRow[] | undefined;
    /** Non-null when the load failed; the builder shows it in place of the
     *  results. */
    error: string | null;
}

/** The search index for a component: `rows` once loaded — synchronously on
 *  every mount after the first load. */
export function useSearchIndex(): SearchIndexResult {
    const [rows, setRows] = useState<readonly SearchIndexRow[] | undefined>(
        () => cached ?? undefined
    );
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (rows !== undefined) return;
        let cancelled = false;
        loadSearchIndex().then(
            (loaded) => {
                if (!cancelled) setRows(loaded);
            },
            (cause: unknown) => {
                if (cancelled) return;
                const message =
                    cause instanceof Error ? cause.message : String(cause);
                console.warn("Search index load failed:", message);
                setError(message);
            }
        );
        return () => {
            cancelled = true;
        };
    }, [rows]);
    return { rows, error };
}

/** TEST-ONLY. Drops the memo so a test can drive the fetch again. */
export function resetSearchIndexForTests(): void {
    cached = null;
    loading = null;
}
