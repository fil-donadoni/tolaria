#!/usr/bin/env node
/**
 * Fetches the printed token Scryfall ids associated with every card in a
 * set file, via Scryfall's `all_parts` reverse-link.
 *
 * Usage:
 *   # Regenerate the WHOLE lockfile across every set file (recommended):
 *   node scripts/fetch-token-prints.mjs --all
 *
 *   # Or refresh only specific set files (merged into the existing lockfile):
 *   node scripts/fetch-token-prints.mjs convex/cards/sets/lea/colorless.ts ...
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
 * NON-DESTRUCTIVE MERGE (issue #1305): the script loads the existing lockfile
 * and merges the freshly-fetched mappings over it. Entries for cards NOT in
 * the current input are preserved, never dropped — so refreshing a single set
 * file can never silently regress another card's token art. `--all` globs
 * every `.ts` file under `convex/cards/sets` and rebuilds full coverage in
 * one pass.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = resolve(
    repoRoot,
    "convex/cards/generated/token-prints.json"
);

/** Recursively collect every `.ts` file under a directory. */
function walkTs(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walkTs(full));
        else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
            out.push(full);
    }
    return out;
}

const args = process.argv.slice(2);
let inputs;
if (args.length === 0 || args.includes("--all")) {
    // Whole-catalogue regeneration: every set file (all colours, all sets).
    inputs = walkTs(resolve(repoRoot, "convex/cards/sets"));
    console.log(`--all: scanning ${inputs.length} set file(s).`);
} else {
    inputs = args.map((a) => resolve(repoRoot, a));
}

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

// Scryfall card/print ids are UUID v4 (version nibble = 4). Pinning the
// version to 4 excludes the deterministic v5 UUIDs used elsewhere as synthetic
// ids (scenario/designation keys), which Scryfall's /cards/collection rejects
// with a 400 that would otherwise kill the whole 75-id batch.
const UUID =
    "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID_FIELD_RE = new RegExp(`id:\\s*"(${UUID})"`, "g");
const ID_CONST_RE = new RegExp(`\\b[A-Z0-9_]+_ID\\s*=\\s*"(${UUID})"`, "g");

const uuids = new Set();
for (const input of inputs) {
    const src = readFileSync(input, "utf-8");
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

// State-designation marker names (lowercased) captured alongside tokens — see
// STATE_DESIGNATIONS in convex/cards/designations.ts. City's Blessing is listed
// ahead of its (unimplemented) Ascend mechanic so the pipeline is ready.
const DESIGNATION_MARKER_NAMES = new Set(["the monarch", "city's blessing"]);

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
        // A single malformed id 400s the whole batch. Warn and skip rather
        // than abort — the merge still lands every batch that succeeded.
        console.warn(
            `Scryfall batch ${i / BATCH} failed (${res.status}), skipping: ${(
                await res.text()
            ).slice(0, 200)}`
        );
        await sleep(120);
        continue;
    }
    const data = await res.json();
    for (const card of data.data ?? []) {
        const tokens = (card.all_parts ?? [])
            .filter(
                (p) =>
                    p.component === "token" ||
                    // State-designation markers (The Monarch, CR 725) are
                    // token-layout cards but Scryfall tags them `combo_piece`,
                    // not `token`. Capture them so a card that GRANTS the
                    // designation carries its set-themed marker art, keyed by
                    // the granting card exactly like its tokens (issue #1305).
                    // Names mirror the registry in
                    // `convex/cards/designations.ts` (STATE_DESIGNATIONS).
                    (p.component === "combo_piece" &&
                        DESIGNATION_MARKER_NAMES.has(
                            (p.name ?? "").toLowerCase()
                        ))
            )
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
// Merge over the existing lockfile (NON-destructive, issue #1305): freshly
// fetched cards overwrite their own entries; every other card's mapping is
// preserved. Then write sorted keys + 4-space indent for stable diffs.
// ---------------------------------------------------------------------------

let existing = {};
try {
    existing = JSON.parse(readFileSync(outPath, "utf-8"));
} catch {
    existing = {}; // first run / no lockfile yet
}
const merged = { ...existing, ...tokensByCard };

mkdirSync(dirname(outPath), { recursive: true });
const sorted = {};
for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
writeFileSync(outPath, JSON.stringify(sorted, null, 4) + "\n", "utf-8");
console.log(
    `Wrote ${outPath} — ${Object.keys(sorted).length} card(s) total ` +
        `(${withTokens} refreshed this run).`
);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
