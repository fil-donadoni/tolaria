import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { BasicLandPrintRow } from "~/components/deckbuilder/basicLands";

/**
 * The `cardPrints` rows of the basic-land art a user has stored (issue #5106,
 * `applyBasicLandArtPreference`'s legality check): at most five point reads,
 * one per subtype. Keeps the last loaded rows while a changed preference
 * re-queries, so a stored choice does not flash back to the default on every
 * pick.
 */
export function useBasicLandPreferenceRows(
    preference: Partial<Record<string, string>>
): readonly BasicLandPrintRow[] {
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
    return rows ?? lastRows ?? [];
}
