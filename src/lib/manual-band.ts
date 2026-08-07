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

import type { FullCatalogueRow } from "./fullCatalogue";
import { parseTypeLine } from "./typeLine";

export type ManualBand = "creatures" | "back";

/** The fields the classifier reads off a manual card — a structural subset of
 *  `ManualCardInstance` / `ProjectedManualCard` (`convex/manual.ts`), so
 *  either flows in without adaptation. */
export interface ManualBandCard {
    card: { id: string };
    lane?: "main" | "combat";
}

/** Resolves a Full Catalogue print id to its row, or `undefined` when the
 *  catalogue doesn't carry it (not loaded, or a genuinely unknown id). */
export type CatalogueRowLookup = (
    printId: string
) => FullCatalogueRow | undefined;

/** Builds a `CatalogueRowLookup` from Full Catalogue rows, mirroring the
 *  `Map<printId, row>` pattern `makeDeckCardShapeResolver` uses
 *  (`src/lib/deckCardShape.ts:70`). Rows are an INPUT, never fetched here —
 *  the caller owns the `useFullCatalogue` hook. */
export function makeCatalogueRowLookup(
    rows: readonly FullCatalogueRow[] | undefined
): CatalogueRowLookup {
    if (!rows || rows.length === 0) return () => undefined;
    const byPrintId = new Map<string, FullCatalogueRow>();
    for (const row of rows) byPrintId.set(row.printId, row);
    return (printId) => byPrintId.get(printId);
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

    const row = lookupRow(card.card.id);
    if (!row) return "back";

    const { types } = parseTypeLine(row.typeLine);
    return types.includes("Creature") ? "creatures" : "back";
}
