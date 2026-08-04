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
import { mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = resolve(repoRoot, "data/full-catalogue.json.gz");
const publicOutPath = resolve(repoRoot, "public/data/full-catalogue.json.gz");

const SCRYFALL_BULK = "https://api.scryfall.com/bulk-data/oracle-cards";

// Scryfall rejects requests carrying an HTTP library's default User-Agent
// (`400 bad_request / generic_user_agent`), which surfaced here as the
// misleading "No download URI in bulk data definition". Every other Scryfall
// script in scripts/ already identifies itself; this one did not.
const SCRYFALL_HEADERS = {
    "User-Agent": "tolaria-fetch-full-catalogue/1.0",
    Accept: "*/*",
};

async function main() {
    // 1. Fetch the bulk data definition to get the download URL.
    console.log("Fetching bulk data index...");
    const bulkDefRes = await fetch(SCRYFALL_BULK, {
        headers: SCRYFALL_HEADERS,
    });
    if (!bulkDefRes.ok) {
        throw new Error(
            `Bulk data index failed: ${bulkDefRes.status} ${bulkDefRes.statusText}`
        );
    }
    const bulkDef = await bulkDefRes.json();
    // Scryfall now serves JSONL (jsonl_download_uri). Prefer that; fall back
    // to the old JSON-array download_uri.
    const downloadUri = bulkDef.jsonl_download_uri ?? bulkDef.download_uri;
    if (!downloadUri) {
        throw new Error("No download URI in bulk data definition");
    }
    const isJsonl = Boolean(bulkDef.jsonl_download_uri);
    console.log(
        `Download URL: ${downloadUri} (${isJsonl ? "jsonl.gz" : "json"})`
    );

    // 2. Download the full oracle-cards.
    console.log("Downloading oracle_cards bulk...");
    const bulkRes = await fetch(downloadUri, { headers: SCRYFALL_HEADERS });
    if (!bulkRes.ok) {
        throw new Error(`Bulk download failed: ${bulkRes.status}`);
    }

    // 3. Filter and reduce.
    const EXCLUDED_LAYOUTS = new Set([
        "art_series",
        "vanguard",
        "scheme",
        "planar",
        "emblem",
    ]);

    const paper = [];
    let excluded = 0;

    if (isJsonl) {
        // JSONL .gz — decompress stream + readline.
        console.log("Decompressing + parsing JSONL...");
        const gunzip = createGunzip();
        const source = Readable.fromWeb(bulkRes.body);
        source.pipe(gunzip);
        const rl = createInterface({ input: gunzip });
        for await (const line of rl) {
            if (!line.trim()) continue;
            const card = JSON.parse(line);
            if (card.games && !card.games.includes("paper")) continue;
            if (!card.layout) card.layout = "";
            const layout = card.layout.toLowerCase();
            if (layout !== "token" && EXCLUDED_LAYOUTS.has(layout)) {
                excluded++;
                continue;
            }
            paper.push(card);
        }
        await finished(gunzip);
    } else {
        // Legacy JSON array.
        const bulkText = await bulkRes.text();
        const allCards = JSON.parse(bulkText);
        console.log(`Downloaded ${allCards.length} oracle rows.`);
        for (const card of allCards) {
            if (card.games && !card.games.includes("paper")) continue;
            if (!card.layout) card.layout = "";
            const layout = card.layout.toLowerCase();
            if (layout !== "token" && EXCLUDED_LAYOUTS.has(layout)) {
                excluded++;
                continue;
            }
            paper.push(card);
        }
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

    // Copy to public/ so Vite serves it (both dev and production).
    await mkdir(dirname(publicOutPath), { recursive: true });
    await copyFile(outPath, publicOutPath);
    console.log(`Copied to ${publicOutPath}`);

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
