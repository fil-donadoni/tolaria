// Draftable-Set gate (ADR 0059, supersedes ADR 0056): a set is Draftable iff
// EVERY Booster Sheet retains ≥80% implemented `CardDefinition`s after
// ADR-0010 exclusions — checked mechanically against the single registry seam
// (`tryGetDefinition`), never a hand-maintained whitelist. A single sheet
// under the 80% floor fails the WHOLE set; the threshold is deliberately
// per-sheet, never a per-set average (a healthy common sheet must never
// paper over a broken rare sheet). ADR-excluded cards (Chaos Orb, the ante
// trio) never reach this check: the importer already stripped them from the
// sheets (`mtgjsonImport.ts` + `adrExclusions.ts`), so they read as "absent
// from the print run", not "missing implementation".
import { tryGetDefinition } from "../cards";
import { dropFromSheet } from "./sheetFiltering";
import type { BoosterConfig, BoosterSheet } from "./boosterTypes";

/** Per-sheet Draftability floor (ADR 0059). Deliberately NOT a per-set
 *  average — see module doc comment. */
const MIN_SHEET_COVERAGE = 0.8;

export interface SheetDraftability {
    sheetName: string;
    /** Total distinct Scryfall ids on this sheet (after ADR-0010 exclusions,
     *  which never reach this — they're stripped at import time). */
    totalCards: number;
    /** Scryfall ids on this sheet with no implemented `CardDefinition`,
     *  sorted for a stable/diffable result. */
    missingCardIds: string[];
    /** Fraction of `totalCards` that IS implemented, in [0, 1]. An empty
     *  sheet (no cards at all — never happens for a real Booster Config, but
     *  keeps the function total) trivially reports full coverage. */
    coverage: number;
    /** Whether this sheet alone clears `MIN_SHEET_COVERAGE`. */
    passes: boolean;
}

export interface DraftabilityResult {
    /** True iff every sheet's `passes` is true. */
    draftable: boolean;
    /** Every Scryfall id across every sheet with no implemented
     *  `CardDefinition` — the reason a non-Draftable set isn't one, surfaced
     *  for the admin UI (PRD #1107 story 4). Sorted, deduplicated across
     *  sheets. Empty when `draftable` is true. Also the exact id set
     *  `dropUnimplementedCards` below removes from a live config. */
    missingCardIds: string[];
    /** Per-sheet breakdown — the per-sheet verdict `listDraftableSets` /
     *  `isDraftableSet` surface (PRD #1242 AC5): which sheet(s), if any,
     *  are why a set isn't Draftable. */
    sheets: SheetDraftability[];
}

/** Computes Draftability for `config` by checking every sheet's cards
 *  against the card registry independently. Pure — no I/O, no game state —
 *  so it can run over an in-memory config built straight from
 *  `buildBoosterConfig` (as the "partial set" test does) as well as over a
 *  checked-in `data/boosters/*.json` config. */
export function computeDraftability(config: BoosterConfig): DraftabilityResult {
    const sheets: SheetDraftability[] = [];
    const allMissing = new Set<string>();

    for (const [sheetName, sheet] of Object.entries(config.sheets)) {
        const ids = Object.keys(sheet.cards);
        const missingCardIds = ids.filter((id) => !tryGetDefinition(id)).sort();
        for (const id of missingCardIds) allMissing.add(id);

        const totalCards = ids.length;
        const coverage =
            totalCards === 0
                ? 1
                : (totalCards - missingCardIds.length) / totalCards;

        sheets.push({
            sheetName,
            totalCards,
            missingCardIds,
            coverage,
            passes: coverage >= MIN_SHEET_COVERAGE,
        });
    }

    return {
        draftable: sheets.every((s) => s.passes),
        missingCardIds: [...allMissing].sort(),
        sheets,
    };
}

/** Drops every sheet card with no implemented `CardDefinition`, read against
 *  the LIVE card registry AT CALL TIME — never baked into the checked-in
 *  `data/boosters/*.json` (ADR 0059) — and renormalizes each sheet's weight
 *  via the SAME `dropFromSheet` mechanism the MTGJSON importer already uses
 *  for ADR-0010 exclusions (`mtgjsonImport.ts`'s `buildSheet`). A missing
 *  card is treated as absent from the print run, never rendered as a
 *  placeholder or phantom bomb — exactly the ADR 0056 no-skew principle ADR
 *  0059 keeps, just against a lower completeness bar. Callers that generate
 *  actual packs (`boosterGenerator.generateBooster` via the draft/sealed
 *  engines) MUST run the config through this before sampling; `registry.ts`'s
 *  `getRuntimeBoosterConfig` is the sanctioned seam for that. */
export function dropUnimplementedCards(config: BoosterConfig): {
    config: BoosterConfig;
    missingCardIds: string[];
} {
    const sheets: Record<string, BoosterSheet> = {};
    const allMissing = new Set<string>();

    for (const [sheetName, sheet] of Object.entries(config.sheets)) {
        const { sheet: filtered, droppedIds } = dropFromSheet(
            sheet,
            (scryfallId) => !tryGetDefinition(scryfallId)
        );
        sheets[sheetName] = filtered;
        for (const id of droppedIds) allMissing.add(id);
    }

    return {
        config: { ...config, sheets },
        missingCardIds: [...allMissing].sort(),
    };
}
