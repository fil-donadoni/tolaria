// Manual battlefield row classifier (PRD #2162, ADR 0080 § Battlefield row
// classification).
//
// The real board's battlefield splits into two rows via `bandOf`
// (`src/components/board/board-battlefield.tsx`), which reads a hydrated
// `CardInstance.types` off the GRE registry. A Manual Game has no
// `CardDefinition` to hydrate — ADR 0080's fourth invariant ("no inferred
// game state", "no CardDefinition is hydrated") rules that out — so this
// classifier reads the type line off the Full Catalogue row instead
// (`src/lib/fullCatalogue.ts`), composing `parseTypeLine`
// (`src/lib/typeLine.ts`) exactly as `catalogueRowShape` does
// (`src/lib/deckCardShape.ts`).
//
// Precedence: an explicit `lane` always wins over the inferred type — a
// player who dragged a card to the combat row (or back to main) said
// something the catalogue can't override. Only an UNSET lane falls through to
// type-line inference, and a print id the catalogue cannot resolve degrades
// to the back row (fail-safe: never a crash, never forward by default).
//
// Pure: no Convex, no React, no DOM.

import { foldAccents } from "@convex/cards/textNormalize";
import type { FullCatalogueRow } from "./fullCatalogue";
import { parseTypeLine } from "./typeLine";

export type ManualBand = "creatures" | "back";

/** The fields the classifier reads off a manual card — a structural subset of
 *  `ManualCardInstance` / `ProjectedManualCard` (`convex/manual.ts`), so
 *  either flows in without adaptation. */
export interface ManualBandCard {
    card: { id: string };
    /** The card's printed name, carried on every manual card dealt from a
     *  decklist (`ManualCardInstance.name`). The print-id lookup alone is not
     *  enough — see {@link makeCatalogueRowLookup}. */
    name?: string;
    lane?: "main" | "combat";
}

/** Resolves a Full Catalogue print id — or, failing that, a card NAME — to its
 *  row. `undefined` when the catalogue doesn't carry it (not loaded, or a
 *  genuinely unknown card). */
export type CatalogueRowLookup = (
    printId: string,
    name?: string
) => FullCatalogueRow | undefined;

/**
 * Builds a `CatalogueRowLookup` from Full Catalogue rows, mirroring the
 * `Map<printId, row>` pattern `makeDeckCardShapeResolver` uses
 * (`src/lib/deckCardShape.ts:70`). Rows are an INPUT, never fetched here —
 * the caller owns the `useFullCatalogue` hook.
 *
 * Indexed by NAME as well as by print id, because a print id is a lossy key
 * here: the catalogue asset keeps ONE representative printing per card
 * (`scripts/fetch-full-catalogue.mjs` — it groups by `oracle_id` and emits the
 * best print), while a Tabletop deck may hold ANY Scryfall printing (the
 * builder's edition dropdown lists them all, fetched live —
 * `result-card.tsx`). A card built from a non-representative printing
 * therefore missed the lookup entirely and fell to the back row of the
 * battlefield no matter its type. The name resolves it, and the name is
 * already on the card.
 *
 * The name index is accent-folded and case-insensitive (`nameFold`), the same
 * matching `makeCatalogueNameResolver` uses, and first row wins per name —
 * printings of one card share the characteristics this lookup is consulted
 * for.
 */
export function makeCatalogueRowLookup(
    rows: readonly FullCatalogueRow[] | undefined
): CatalogueRowLookup {
    if (!rows || rows.length === 0) return () => undefined;
    const byPrintId = new Map<string, FullCatalogueRow>();
    const byNameFold = new Map<string, FullCatalogueRow>();
    for (const row of rows) {
        byPrintId.set(row.printId, row);
        if (!byNameFold.has(row.nameFold)) byNameFold.set(row.nameFold, row);
    }
    return (printId, name) => {
        const byId = byPrintId.get(printId);
        if (byId) return byId;
        if (name === undefined) return undefined;
        return byNameFold.get(foldAccents(name.trim().toLowerCase()));
    };
}

/** Classifies one manual card into its battlefield row.
 *
 *  - An explicit `lane` (`"combat"` or `"main"`) always wins: `"combat"` →
 *    the creatures row, `"main"` → the back row.
 *  - With no explicit `lane`, a resolvable catalogue row decides by type
 *    line: `Creature` → the creatures row, anything else (including `Land`)
 *    → the back row.
 *  - An unresolvable print id → the back row. */
export function manualBandOf(
    card: ManualBandCard,
    lookupRow: CatalogueRowLookup
): ManualBand {
    if (card.lane === "combat") return "creatures";
    if (card.lane === "main") return "back";

    const row = lookupRow(card.card.id, card.name);
    if (!row) return "back";

    const { types } = parseTypeLine(row.typeLine);
    return types.includes("Creature") ? "creatures" : "back";
}
