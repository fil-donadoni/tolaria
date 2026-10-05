import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { BasicLandPrintRow } from "~/components/deckbuilder/basicLands";

/**
 * The `cardPrints` rows of the basic-land art a user has stored (issue #5106,
 * `applyBasicLandArtPreference`'s legality check): at most five point reads,
 * one per subtype. Keeps the last loaded rows while a changed preference
 * re-queries and reports `loading` meanwhile, so a stored choice does not
 * flash back to the default on a fresh pick or on first render.
 */
export function useBasicLandPreferenceRows(
    preference: Partial<Record<string, string>>
): { rows: readonly BasicLandPrintRow[]; loading: boolean } {
    const printIds = useMemo(
        () => [...new Set(Object.values(preference).flatMap((id) => id ?? []))],
        [preference]
    );
    const rows = useQuery(
        api.cardPrints.getByPrintIds,
        printIds.length > 0 ? { printIds } : "skip"
    );
    const [lastRows, setLastRows] = useState(rows);
    if (rows !== undefined && rows !== lastRows) setLastRows(rows);
    return {
        rows: rows ?? lastRows ?? [],
        // The rows of the CURRENT ids are in flight: a caller keeps a stored
        // id it has no row for yet rather than judge it illegal.
        loading: printIds.length > 0 && rows === undefined,
    };
}
