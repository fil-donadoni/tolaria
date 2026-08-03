#!/usr/bin/env node
/**
 * Downloads the Scryfall `oracle_cards` bulk → columnar reduction →
 * `data/full-catalogue.json.gz`.
 *
 * Usage:
 *   node scripts/fetch-full-catalogue.mjs
 *
 * Output:
 *   data/full-catalogue.json.gz — columnar, one array per field, gzipped.
 *
 * Reduction (per ADR 0080):
 *   - columnar (arrays per field, not an array of objects)
 *   - no `oracleId` — printings are fetched by exact name later
 *   - UUIDs without dashes
 *   - no `oracle_text`
 *   - exclude layouts: art_series, vanguard, scheme, planar, emblem
 *   - exclude non-paper cards
 *   - include tokens
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = resolve(repoRoot, "data/full-catalogue.json.gz");

const SCRYFALL_BULK = "https://api.scryfall.com/bulk-data/oracle-cards";

async function main() {
    // 1. Fetch the bulk data definition to get the download URL.
    console.log("Fetching bulk data index...");
    const bulkDef = await fetch(SCRYFALL_BULK).then((r) => r.json());
    const downloadUri = bulkDef.download_uri;
    if (!downloadUri) {
        throw new Error("No download_uri in bulk data definition");
    }
    console.log(`Download URL: ${downloadUri}`);

    // 2. Download the full oracle-cards JSON (one JSON array).
    console.log("Downloading oracle_cards bulk...");
    const bulkRes = await fetch(downloadUri);
    if (!bulkRes.ok) {
        throw new Error(`Bulk download failed: ${bulkRes.status}`);
    }
    // Scryfall bulk is ~35 MB raw; stream it through JSON.parse.
    const bulkText = await bulkRes.text();
    const allCards = JSON.parse(bulkText);
    console.log(`Downloaded ${allCards.length} oracle rows.`);

    // 3. Filter and reduce.
    //   - Exclude non-paper (game "paper" only)
    //   - Exclude certain layouts
    //   - Include tokens
    const EXCLUDED_LAYOUTS = new Set([
        "art_series",
        "vanguard",
        "scheme",
        "planar",
        "emblem",
    ]);

    const paper = [];
    let excluded = 0;
    for (const card of allCards) {
        // All cards in oracle_cards are oracle rows (game=paper mostly,
        // but some like arena/mtgo sneak in).
        if (card.games && !card.games.includes("paper")) {
            continue;
        }
        // Exclude these layouts, but NOT tokens (token layout stays).
        if (!card.layout) card.layout = "";
        const layout = card.layout.toLowerCase();
        if (layout !== "token" && EXCLUDED_LAYOUTS.has(layout)) {
            excluded++;
            continue;
        }
        paper.push(card);
    }

    console.log(
        `${paper.length} paper-legal oracle rows (${excluded} excluded by layout).`
    );

    // 4. Build columnar arrays.
    const uuidNoDash = (id) => (id ?? "").replace(/-/g, "");

    const names = [];
    const printIds = [];
    const typeLines = [];
    const manaCosts = [];
    const cmcs = [];
    const colourIdentities = [];
    const sets = [];
    const rarities = [];

    for (const card of paper) {
        // Colour identity is an array of single letters; store as joined string.
        const ci = card.color_identity ?? [];
        const ciStr = Array.isArray(ci) ? ci.join("") : "";

        // CMC: prefer cmc over convertedManaCost for newer data.
        const cmc = typeof card.cmc === "number" ? card.cmc : 0;

        // Rarity: Scryfall uses lowercase; store as-is.
        const rarity = card.rarity ?? "";

        // Set: use the set code.
        const setCode = card.set ?? "";

        // Type line: use type_line.
        const typeLine = card.type_line ?? "";

        // Mana cost: use mana_cost.
        const manaCost = card.mana_cost ?? "";

        names.push(card.name ?? "");
        printIds.push(uuidNoDash(card.id));
        typeLines.push(typeLine);
        manaCosts.push(manaCost);
        cmcs.push(cmc);
        colourIdentities.push(ciStr);
        sets.push(setCode);
        rarities.push(rarity);
    }

    const result = {
        names,
        printIds,
        typeLines,
        manaCosts,
        cmcs,
        colourIdentities,
        sets,
        rarities,
    };

    // 5. Write as gzipped JSON.
    const json = JSON.stringify(result);

    // Measure raw and compressed sizes.
    await mkdir(dirname(outPath), { recursive: true });

    // Write through gzip.
    await new Promise((resolvePromise, reject) => {
        const gzip = createGzip({ level: 9 });
        const out = createWriteStream(outPath);
        gzip.pipe(out);
        gzip.on("error", reject);
        out.on("finish", resolvePromise);
        out.on("error", reject);
        gzip.end(json);
    });

    const rawSize = Buffer.byteLength(json, "utf-8");
    const gzStats = await (await import("node:fs/promises")).stat(outPath);
    const gzSize = gzStats.size;

    console.log(
        `Wrote ${outPath} — ${paper.length} rows, ` +
            `${(rawSize / 1024).toFixed(1)} KB raw / ` +
            `${(gzSize / 1024).toFixed(1)} KB gz ` +
            `(${(gzSize / paper.length).toFixed(1)} B/card).`
    );

    if (gzSize > 1_500_000) {
        console.warn(
            `\nWARNING: ${(gzSize / 1024).toFixed(0)} KB exceeds the 1.5 MB budget.`
        );
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
