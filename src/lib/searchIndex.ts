// The client's handle on the deck-builder search index (issue #3054).
//
// The index itself is derived in `convex/cards/searchIndex.ts` — types and
// derivations live in `convex/` (source of truth). What this module adds is
// the ONE memo: building the index walks ~4,300 definitions and aggregates
// their oracle text (measured 57 ms), which is cheap once and wasteful per
// render, per surface, or per keystroke.
//
// WHY A MODULE-LEVEL MEMO AND NOT `useMemo`. Three surfaces read the index —
// the search hook, the type filter and the Full Catalogue availability patch —
// and a `useMemo` per component would build it once per surface AND hand each
// one a different array identity, which is the input every downstream filter
// memo keys on. One module-level value gives all three the same rows and the
// same reference for the life of the document.
//
// The memo is safe to take eagerly because hydration is STRUCTURAL, not a
// race: `CatalogueGate` (`src/components/ui/catalogue-gate.tsx`) sits above
// the whole route tree and its children do not exist as elements until
// `hydrateCatalogue()` has resolved, so no consumer of this module can run
// before the compiled rows are in the registry. See `searchIndex.ts`'s header
// for why the index is derived at all.
import {
    buildSearchIndex,
    type SearchIndexRow,
} from "@convex/cards/searchIndex";

let cached: SearchIndexRow[] | null = null;

/** The search index, built on first read and shared from then on. */
export function searchIndex(): readonly SearchIndexRow[] {
    if (cached === null) cached = buildSearchIndex();
    return cached;
}

/** React-facing alias. Not a hook in the stateful sense — the index is
 *  synchronous — but named as one so call sites read like the `useQuery` they
 *  replaced and stay honest about where they may be called. */
export function useSearchIndex(): readonly SearchIndexRow[] {
    return searchIndex();
}
