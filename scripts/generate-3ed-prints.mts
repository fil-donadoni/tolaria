#!/usr/bin/env npx tsx
/**
 * Generates `convex/cards/sets/3ed.ts` — the Revised Edition (3ED) print set.
 *
 * Revised is a 100% reprint set (no new cards), so the module is entirely
 * `CardPrint` rows: each declares the per-edition Scryfall UUID (`printId`) and
 * resolves printId -> definitionId -> a shared CardDefinition that already
 * lives in an implemented set (lea/leb/arn/atq/leg/drk). See ADR 0014.
 *
 * The script reads the MTGJSON `3ED.json` set file and matches each card by
 * oracle name to its existing CardDefinition via the live catalogue registry
 * (`tryGetCardByName`) — the same resolver the engine uses, so the match is
 * authoritative (it handles factory-defined cards, const-id references, and
 * Beta-original definitions that a regex scan would miss). It then emits one
 * `CardPrint` literal per match plus the basic-land art variants. Per-printing
 * rarity comes from the 3ED JSON entry.
 *
 * Excluded: the 3 ante cards (Contract from Below, Darkpact, Demonic Attorney)
 * are permanently out of scope per ADR 0010 — they have no print row and are
 * documented in the generated file header. Any other 3ED card whose
 * CardDefinition is not yet implemented is skipped with a warning (a 3ED print
 * lands automatically once its definition exists).
 *
 * Usage: npx tsx scripts/generate-3ed-prints.mts
 * Output: convex/cards/sets/3ed.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tryGetCardByName } from "../convex/cards/index.ts";

const SET_CODE = "3ed";
const JSON_PATH = "data/json/3ED.json";
const OUT_PATH = "convex/cards/sets/3ed.ts";

// Ante cards — permanently out of scope (ADR 0010). Documented, never printed.
const ANTE_EXCLUSIONS = ["Contract from Below", "Darkpact", "Demonic Attorney"];

const BASIC_LANDS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

interface MtgJsonCard {
    name: string;
    number: string;
    rarity?: string;
    supertypes?: string[];
    identifiers: { scryfallId: string };
}

/** camelCase export identifier from a card name, suffixed with the set code.
 *  Mirrors 2ed.ts: "Air Elemental" -> airElemental3ed,
 *  "Circle of Protection: Black" -> circleOfProtectionBlack3ed. */
function exportName(name: string, suffixIndex: number): string {
    const cleaned = name
        .replace(/[':,.()/]/g, " ")
        .replace(/-/g, " ")
        .replace(/&/g, " and ");
    const parts = cleaned.split(/\s+/).filter(Boolean);
    let ident = parts
        .map((p, i) =>
            i === 0
                ? p.charAt(0).toLowerCase() + p.slice(1)
                : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        )
        .join("");
    if (/^[0-9]/.test(ident)) ident = "_" + ident;
    return `${ident}${suffixIndex > 1 ? suffixIndex : ""}${SET_CODE}`;
}

interface Row {
    ident: string;
    printId: string;
    definitionId: string;
    name: string;
    rarity: string;
}

function main(): void {
    const raw = JSON.parse(readFileSync(resolve(JSON_PATH), "utf-8"));
    const cards: MtgJsonCard[] = raw.data.cards;

    const nonBasic = cards.filter((c) => !c.supertypes?.includes("Basic"));
    const basics = cards.filter((c) => c.supertypes?.includes("Basic"));

    const ante = new Set(ANTE_EXCLUSIONS);
    const skipped: string[] = [];
    const numOf = (c: MtgJsonCard) => parseInt(c.number, 10) || 0;

    const makeRow = (
        c: MtgJsonCard,
        count: number,
        fallbackRarity = "common"
    ): Row => ({
        ident: exportName(c.name, count),
        printId: c.identifiers.scryfallId,
        definitionId: tryGetCardByName(c.name)!.id,
        name: c.name,
        rarity: c.rarity ?? fallbackRarity,
    });

    // Non-basic prints, ordered by collector number.
    nonBasic.sort((a, b) => numOf(a) - numOf(b));
    const rows: Row[] = [];
    const seen = new Map<string, number>();
    for (const c of nonBasic) {
        if (ante.has(c.name)) continue; // ADR 0010 — documented exclusion
        if (!tryGetCardByName(c.name)) {
            skipped.push(c.name);
            continue;
        }
        const count = (seen.get(c.name) ?? 0) + 1;
        seen.set(c.name, count);
        rows.push(makeRow(c, count));
    }

    // Basic lands: one print per art variant (collector number).
    basics.sort((a, b) => numOf(a) - numOf(b));
    const basicRows: Row[] = [];
    const basicSeen = new Map<string, number>();
    for (const c of basics) {
        if (!BASIC_LANDS.includes(c.name)) continue;
        if (!tryGetCardByName(c.name)) {
            skipped.push(c.name);
            continue;
        }
        const count = (basicSeen.get(c.name) ?? 0) + 1;
        basicSeen.set(c.name, count);
        basicRows.push(makeRow(c, count));
    }

    const header = `import type { CardPrint } from "../types";

// 3ED (Revised Edition). Revised is a 100% reprint set — it introduces no new
// cards — so this module is entirely CardPrint entries: each declares the
// per-edition Scryfall UUID (printId) and resolves printId -> definitionId ->
// a shared CardDefinition already implemented in lea/leb/arn/atq/leg/drk.
// See ADR 0014. Revised's English (3ed) art is hosted on Scryfall, so the
// printId renders correctly with no foreign-set image problem.
//
// Generated by scripts/generate-3ed-prints.mts from data/json/3ED.json
// (name -> definitionId match via the live registry, printId + rarity from the
// 3ED Scryfall entry). Re-run that script to regenerate.
//
// Excluded: the 3 ante cards — Contract from Below, Darkpact, Demonic Attorney
// — are permanently out of scope (ADR 0010) and carry no print row. Every other
// non-basic Revised card resolves to an existing CardDefinition.
`;

    const emit = (r: Row) =>
        `export const ${r.ident}: CardPrint = {
    printId: "${r.printId}",
    definitionId: "${r.definitionId}", // ${r.name}
    setCode: "${SET_CODE}",
    rarity: "${r.rarity}",
};
`;

    const body = rows.map(emit).join("\n");
    const basicsSection =
        "\n// Basic lands (art variants — one print per collector number).\n\n" +
        basicRows.map(emit).join("\n");

    writeFileSync(
        resolve(OUT_PATH),
        header + "\n" + body + "\n" + basicsSection
    );

    console.log(
        `✓ wrote ${OUT_PATH}: ${rows.length} non-basic + ${basicRows.length} basic-land prints`
    );
    console.log(`  ante exclusions (ADR 0010): ${ANTE_EXCLUSIONS.join(", ")}`);
    if (skipped.length) {
        console.warn(
            `  ⚠ ${skipped.length} card(s) skipped (no CardDefinition yet):\n    ` +
                skipped.join("\n    ")
        );
    }
}

main();
