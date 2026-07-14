// Pure MTGJSON → Booster Config transform (ADR 0056). Takes an already
// `JSON.parse`d MTGJSON `data` object for one set and produces the checked-in
// `BoosterConfig` shape (`boosterTypes.ts`): MTGJSON UUIDs mapped to Scryfall
// ids, foil print sheets and any booster variant that references one dropped
// entirely, and ADR-excluded cards stripped with sheet weights renormalized.
//
// No I/O here — `scripts/import-booster-config.ts` is the thin CLI wrapper
// that reads `data/json/<SET>.json`, calls `buildBoosterConfig`, and writes
// the result to `data/boosters/<code>.json`. Being pure and I/O-free is what
// lets this module double as the fixture builder for the "partial set is not
// Draftable" test (`draftable.test.ts`) without checking in a second data
// file for a set that isn't actually shipping as a Draftable Set yet.
import { ADR_EXCLUDED_SCRYFALL_IDS } from "./adrExclusions";
import type {
    BoosterConfig,
    BoosterSheet,
    BoosterVariant,
} from "./boosterTypes";

export interface MtgjsonCardIdentifiers {
    scryfallId?: string;
}

export interface MtgjsonCard {
    uuid: string;
    identifiers?: MtgjsonCardIdentifiers;
}

export interface MtgjsonSheet {
    cards: Record<string, number>;
    totalWeight: number;
    foil?: boolean;
}

export interface MtgjsonBoosterVariant {
    contents: Record<string, number>;
    weight: number;
}

export interface MtgjsonBoosterSection {
    boosters: MtgjsonBoosterVariant[];
    boostersTotalWeight: number;
    sheets: Record<string, MtgjsonSheet>;
}

export interface MtgjsonSetData {
    code: string;
    cards: MtgjsonCard[];
    booster?: Record<string, MtgjsonBoosterSection>;
}

export interface BuildBoosterConfigOptions {
    /** Which `booster.<key>` section to import (e.g. "default", "draft").
     *  MTGJSON has no single canonical key across sets — old sets like LEA
     *  use "default", others use "draft" — so this is required rather than
     *  guessed, keeping the transform explicit and re-runnable. */
    boosterType: string;
    /** Scryfall ids to strip from every sheet, weights renormalized.
     *  Defaults to the ADR 0010 exclusion list; overridable for tests. */
    excludedScryfallIds?: ReadonlySet<string>;
}

/** Builds a `BoosterConfig` from a parsed MTGJSON set `data` object. Pure and
 *  deterministic: the same `raw` + `options` always produce byte-identical
 *  output (object key order follows the source file's, since JS preserves
 *  string-key insertion order). */
export function buildBoosterConfig(
    raw: MtgjsonSetData,
    options: BuildBoosterConfigOptions
): BoosterConfig {
    const excluded = options.excludedScryfallIds ?? ADR_EXCLUDED_SCRYFALL_IDS;
    const section = raw.booster?.[options.boosterType];
    if (!section) {
        const available = Object.keys(raw.booster ?? {}).join(", ") || "(none)";
        throw new Error(
            `buildBoosterConfig: set "${raw.code}" has no booster."${options.boosterType}" section (available: ${available})`
        );
    }

    // MTGJSON UUID → Scryfall id, from the set's card list (CR-agnostic:
    // this is a print-identity mapping, not game rules).
    const scryfallByUuid = new Map<string, string>();
    for (const card of raw.cards) {
        const scryfallId = card.identifiers?.scryfallId;
        if (scryfallId) scryfallByUuid.set(card.uuid, scryfallId);
    }

    // Foil/variant slots are dropped (ADR 0056) — keep only non-foil sheets.
    const sheets: Record<string, BoosterSheet> = {};
    for (const [sheetName, sheet] of Object.entries(section.sheets)) {
        if (sheet.foil) continue;
        sheets[sheetName] = buildSheet(
            raw.code,
            sheetName,
            sheet,
            scryfallByUuid,
            excluded
        );
    }

    // Drop any booster variant that references a sheet we just dropped (a
    // foil-slot variant, e.g. INV's "foilCommonOrBasic" packs) — a variant
    // survives only if every slot it draws from is a surviving sheet.
    const boosters: BoosterVariant[] = section.boosters
        .filter((variant) =>
            Object.keys(variant.contents).every(
                (sheetName) => sheetName in sheets
            )
        )
        .map((variant) => ({
            contents: { ...variant.contents },
            weight: variant.weight,
        }));

    if (boosters.length === 0) {
        throw new Error(
            `buildBoosterConfig: set "${raw.code}" booster."${options.boosterType}" has no non-foil booster variant left after dropping foil/variant slots`
        );
    }

    const boostersTotalWeight = boosters.reduce((sum, v) => sum + v.weight, 0);

    return {
        setCode: raw.code.toLowerCase(),
        boostersTotalWeight,
        boosters,
        sheets,
    };
}

function buildSheet(
    setCode: string,
    sheetName: string,
    sheet: MtgjsonSheet,
    scryfallByUuid: Map<string, string>,
    excluded: ReadonlySet<string>
): BoosterSheet {
    const cards: Record<string, number> = {};
    let totalWeight = 0;
    for (const [uuid, weight] of Object.entries(sheet.cards)) {
        const scryfallId = scryfallByUuid.get(uuid);
        if (!scryfallId) {
            throw new Error(
                `buildBoosterConfig: set "${setCode}" sheet "${sheetName}" references MTGJSON uuid ${uuid} with no identifiers.scryfallId`
            );
        }
        if (excluded.has(scryfallId)) continue;
        cards[scryfallId] = (cards[scryfallId] ?? 0) + weight;
        totalWeight += weight;
    }
    if (Object.keys(cards).length === 0) {
        throw new Error(
            `buildBoosterConfig: set "${setCode}" sheet "${sheetName}" is empty after stripping excluded cards`
        );
    }
    return { cards, totalWeight };
}
