// `cardPrints` rows of Mountain (issue #5106) and the two hooks that read them
// (`useBasicLandPrintings`, `useBasicLandPreferenceRows`), stubbed for the dom
// tests that mount a builder: those tests mock the hooks, not `convex/react`,
// so the picker grid and the stored-preference check run the REAL pure core
// (`legalBasicLandPrintings`, `applyBasicLandArtPreference`) over table rows.
// The table never holds a definition's own printing, so the 14 rows below plus
// the canonical LEA Mountain are the 15 the art grid shows:
// `lea×2, leb×3, ice×1, 2ed×3, 3ed×3, 4ed×3`.
import {
    legalBasicLandPrintings,
    type BasicLandPrintRow,
    type BasicLandSubtype,
} from "~/components/deckbuilder/basicLands";

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

/** Stands in for `useBasicLandPrintings`: the Mountain rows, only while the
 *  popover is open, narrowed by the Format's allowed Sets like the query. */
export function useBasicLandPrintingsStub(
    subtype: BasicLandSubtype,
    allowedSets: string[] | null,
    open: boolean
) {
    const rows = subtype === "Mountain" ? MOUNTAIN_PRINT_ROWS : [];
    return {
        printings: open
            ? legalBasicLandPrintings(subtype, rows, allowedSets)
            : [],
        canLoadMore: false,
        loadMore: () => undefined,
    };
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
