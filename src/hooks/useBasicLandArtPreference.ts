import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards/catalogue";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "~/lib/basicLands";
import {
    clearLegacyBasicLandArt,
    legacyBasicLandArt,
    planBasicLandArtMigration,
} from "~/components/deckbuilder/basicLands";
import { usePreferredPrints } from "./usePreferredPrints";

/**
 * The user's basic-land art preference (issue #1629, ADR 0075 § "Basic-land
 * art"), read from and written to the per-user `userCardPrints` table through
 * `usePreferredPrints` (issue #10462) — so it follows the user across devices.
 * A basic land's name IS its subtype (CR 305.6), so the subtype is the card
 * name the table keys on.
 *
 * The old per-device `localStorage` keys are read once on mount and migrated:
 * once the table's rows have loaded, a legacy choice is written for a subtype
 * the table has no row for (`planBasicLandArtMigration`), and every legacy key
 * is cleared — never read again. The legacy choice read on mount is shown
 * under any table row (a row always wins), so a first load does not flash to
 * the default art; a stale legacy id falls to the caller's legality check
 * (`applyBasicLandArtPreference`), like any stale or illegal printing.
 */
export function useBasicLandArtPreference(
    storage: Storage = window.localStorage
): {
    basicLandArt: Partial<Record<BasicLandSubtype, string>>;
    recordBasicLandArt: (
        subtype: BasicLandSubtype,
        printing: CardPrinting
    ) => void;
} {
    const { preferredFor, prefer, loaded } = usePreferredPrints();
    // Read once, on mount; the keys themselves are cleared by the migration.
    const [legacy] = useState(() => legacyBasicLandArt(storage));
    const migrated = useRef(false);
    const legacyIds = useMemo(
        () => [...new Set(Object.values(legacy))],
        [legacy]
    );
    const legacyRows = useQuery(
        api.cardPrints.getByPrintIds,
        legacyIds.length > 0 ? { printIds: legacyIds } : "skip"
    );

    useEffect(() => {
        if (
            migrated.current ||
            legacyIds.length === 0 ||
            !loaded ||
            legacyRows === undefined
        )
            return;
        migrated.current = true;
        const writes = planBasicLandArtMigration(
            legacy,
            (subtype) => preferredFor(subtype) !== undefined,
            legacyRows
        );
        for (const { subtype, printing } of writes) prefer(subtype, printing);
        clearLegacyBasicLandArt(storage);
    }, [legacy, legacyIds, legacyRows, loaded, preferredFor, prefer, storage]);

    const basicLandArt = useMemo(() => {
        const art: Partial<Record<BasicLandSubtype, string>> = {};
        for (const subtype of BASIC_LAND_SUBTYPES) {
            const printId = preferredFor(subtype)?.printId ?? legacy[subtype];
            if (printId !== undefined) art[subtype] = printId;
        }
        return art;
    }, [preferredFor, legacy]);

    const recordBasicLandArt = useCallback(
        (subtype: BasicLandSubtype, printing: CardPrinting) =>
            prefer(subtype, printing),
        [prefer]
    );

    return { basicLandArt, recordBasicLandArt };
}
