#!/usr/bin/env node
/**
 * Fetches the printed token Scryfall ids associated with every card in a
 * set file, via Scryfall's `all_parts` reverse-link.
 *
 * Usage:
 *   node scripts/fetch-token-prints.mjs convex/cards/sets/lea.ts \
 *                                       convex/cards/sets/leb.ts ...
 *
 * Output:
 *   convex/cards/generated/token-prints.json — a mapping
 *     {
 *       "<cardScryfallId>": [
 *         { "scryfallId": "<tokenScryfallId>", "name": "Wasp" },
 *         ...
 *       ],
 *       ...
 *     }
 *
 * Why Scryfall and not MTGJSON: MTGJSON's `relatedCards.tokens[]` uses its
 * own UUID system that does NOT match Scryfall ids. Using MTGJSON requires
 * an extra translation step. Scryfall's `all_parts` returns the actual
 * Scryfall id of the token print directly — which is what `getImageUrl`
 * needs.
 *
 * The script is idempotent: re-running overwrites the JSON with the latest
 * fetch. Existing mappings for cards that no longer match any of the input
 * files are dropped.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
    console.error(
        "Usage: node scripts/fetch-token-prints.mjs <set.ts> [<set.ts> ...]"
    );
    process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = resolve(
    repoRoot,
    "convex/cards/generated/token-prints.json"
);

// ---------------------------------------------------------------------------
// Collect every Scryfall UUID referenced by the input files (active defs and
// commented-out stubs alike). Cards reference their own id two ways: inline
// as `id: "<uuid>"`, or via a hoisted `const FOO_ID = "<uuid>"` that's reused
// both by the `id:` field and by `tokenPrintIdFor(FOO_ID, ...)` calls
// (Retrofitter Foundry, Third Path Iconoclast, The Hive). Match both forms —
// only matching the inline field drops the const form's id from the
// mapping, silently regressing an already-working token's art on the next
// regeneration (issue #941).
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID_FIELD_RE = new RegExp(`id:\\s*"(${UUID})"`, "g");
const ID_CONST_RE = new RegExp(`\\b[A-Z0-9_]+_ID\\s*=\\s*"(${UUID})"`, "g");

const uuids = new Set();
for (const input of inputs) {
    const src = readFileSync(resolve(repoRoot, input), "utf-8");
    for (const m of src.matchAll(ID_FIELD_RE)) {
        uuids.add(m[1]);
    }
    for (const m of src.matchAll(ID_CONST_RE)) {
        uuids.add(m[1]);
    }
}

console.log(
    `Found ${uuids.size} card ids across ${inputs.length} input file(s).`
);

// ---------------------------------------------------------------------------
// Batch /cards/collection (max 75 ids per request, ~120ms throttle).
// ---------------------------------------------------------------------------

const BATCH = 75;
const ids = [...uuids];
const tokensByCard = {};
let withTokens = 0;

for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const identifiers = slice.map((id) => ({ id }));
    const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "tolaria-fetch-token-prints/1.0",
        },
        body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) {
        console.error(
            `Scryfall request failed (${res.status}): ${await res.text()}`
        );
        process.exit(1);
    }
    const data = await res.json();
    for (const card of data.data ?? []) {
        const tokens = (card.all_parts ?? [])
            .filter((p) => p.component === "token")
            .map((p) => ({ scryfallId: p.id, name: p.name }));
        if (tokens.length > 0) {
            tokensByCard[card.id] = tokens;
            withTokens++;
        }
    }
    for (const missing of data.not_found ?? []) {
        console.warn(`Scryfall not_found: ${JSON.stringify(missing)}`);
    }
    await sleep(120);
}

console.log(
    `Token prints found for ${withTokens}/${uuids.size} cards.`
);

// ---------------------------------------------------------------------------
// Write the mapping. Sorted keys + 4-space indent for stable diffs.
// ---------------------------------------------------------------------------

mkdirSync(dirname(outPath), { recursive: true });
const sorted = {};
for (const k of Object.keys(tokensByCard).sort()) sorted[k] = tokensByCard[k];
writeFileSync(outPath, JSON.stringify(sorted, null, 4) + "\n", "utf-8");
console.log(`Wrote ${outPath}`);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
