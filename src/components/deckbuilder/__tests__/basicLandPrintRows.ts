// `cardPrints` rows of Mountain (issue #5106) and the two hooks that read them
// (`useCardPrintings`, `useBasicLandPreferenceRows`), stubbed for the dom
// tests that mount a builder: those tests mock the hooks, not `convex/react`,
// so the printing picker grid and the stored-preference check run the REAL pure core
// (`legalBasicLandPrintings`, `applyBasicLandArtPreference`) over table rows.
// The table never holds a definition's own printing, so the 14 rows below plus
// the canonical LEA Mountain are the 15 the art grid shows:
// `lea×2, leb×3, ice×1, 2ed×3, 3ed×3, 4ed×3`.
import { type BasicLandPrintRow } from "~/components/deckbuilder/basicLands";
import { resolveCardViaDefinitionIds } from "@convex/formats";

export const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56";
export const LEB_MOUNTAIN_PRINT = "7af9c715-8d72-4eae-b412-fc89138ff588";
export const ICE_MOUNTAIN_PRINT = "4ecf39c3-3b5f-4263-a7b5-9881bded3494";

const SETS = [
    "lea",
    "leb",
    "leb",
    "leb",
    "ice",
    "2ed",
    "2ed",
    "2ed",
    "3ed",
    "3ed",
    "3ed",
    "4ed",
    "4ed",
    "4ed",
];

let lebSeen = 0;
export const MOUNTAIN_PRINT_ROWS: BasicLandPrintRow[] = SETS.map((set, i) => ({
    printId:
        set === "ice"
            ? ICE_MOUNTAIN_PRINT
            : set === "leb" && lebSeen++ === 0
              ? LEB_MOUNTAIN_PRINT
              : `mountain-print-${i}-${set}`,
    cardId: MOUNTAIN_ID,
    set,
}));

/** Stands in for `useCardPrintings` (the printing picker's query, issue
 *  #4122/#5398): the Mountain rows, only while the picker is open, narrowed
 *  by the Sets the picker passes like the query does. */
export function useCardPrintingsStub(
    cardId: string | null,
    sets: string[] | null,
    open: boolean
) {
    const rows = cardId === MOUNTAIN_ID ? MOUNTAIN_PRINT_ROWS : [];
    return {
        printings: open
            ? rows
                  .filter((row) => sets === null || sets.includes(row.set))
                  .map((row) => ({ printId: row.printId, setCode: row.set }))
            : [],
        loading: false,
        canLoadMore: false,
        loadMore: () => undefined,
    };
}

/** Stands in for `useScryfallSetNames`: no network, the picker falls back to
 *  upper-cased Set codes. */
export function useScryfallSetNamesStub(): ReadonlyMap<string, string> {
    return new Map();
}

/** Stands in for `useBasicLandPreferenceRows`: the rows of the stored ids,
 *  already loaded. */
export function useBasicLandPreferenceRowsStub(
    preference: Partial<Record<string, string>>
): { rows: readonly BasicLandPrintRow[]; loading: boolean } {
    const stored = new Set(Object.values(preference));
    return {
        rows: MOUNTAIN_PRINT_ROWS.filter((row) => stored.has(row.printId)),
        loading: false,
    };
}

const printRowsByQuery = new Map<string, unknown[]>();

/** Stands in for `useQuery(api.cardPrints.getByPrintIds, …)` — the deck
 *  builders' print resolver (`useDeckPrintResolver`, issue #5550): the
 *  Mountain rows the asked-for Print IDs name, as full `cardPrints` rows;
 *  `undefined` (loading / skipped) for any other query. One array per id set,
 *  like Convex's stable query results — a fresh one per render would re-arm
 *  the hook's `lastRows` state on every render. */
export function getByPrintIdsStub(_query: unknown, args: unknown) {
    if (typeof args !== "object" || args === null || !("printIds" in args)) {
        return undefined;
    }
    const printIds = (args as { printIds: string[] }).printIds;
    const key = [...printIds].sort().join(",");
    let rows = printRowsByQuery.get(key);
    if (rows === undefined) {
        const wanted = new Set(printIds);
        rows = MOUNTAIN_PRINT_ROWS.filter((row) => wanted.has(row.printId)).map(
            (row) => ({ ...row, rarity: "common" as const })
        );
        printRowsByQuery.set(key, rows);
    }
    return rows;
}

/** Stands in for `useDeckPrintResolver` in a test that mocks hooks, not
 *  `convex/react`: the rows query still loading, so the resolver is the
 *  hook's own fallback over the entries' `definitionId`s. */
export function useDeckPrintResolverStub(
    entries: readonly { cardId: string; definitionId?: string }[]
) {
    return resolveCardViaDefinitionIds(entries);
}
