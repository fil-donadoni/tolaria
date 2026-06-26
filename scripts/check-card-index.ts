#!/usr/bin/env bun
/**
 * Drift guard for the lockfile `data/card-index.json` (ADR 0041).
 *
 * The lockfile is the committed index of every IMPLEMENTED card, and the only
 * thing `list-to-cards.mjs` dedups a worklist against. It must stay in sync
 * with the registry (`convex/cards/sets/<code>/*.ts` via `getAllCards()`):
 *
 *   - a card in the registry but MISSING from the lockfile  → the importer
 *     would re-stage an already-implemented card (stale lockfile).
 *   - a lockfile entry whose scryfallId is NOT in the registry → EXTRA /
 *     pollution: a staged-but-not-implemented card leaked in (the old
 *     importer used to write these back), poisoning future dedup.
 *
 * This check is OFFLINE (registry ⇄ lockfile id set comparison) so it can live
 * in `check:all`. The FIX is online — regenerate from the registry:
 *
 *   printf '[]\n' > data/card-index.json && bun run scripts/backfill-card-index.ts
 *
 * (backfill is additive/idempotent, so it cannot REMOVE pollution on its own —
 * reset to `[]` first to clear extras, then re-seed.)
 *
 * Run: bun scripts/check-card-index.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllCards } from "../convex/cards/index";

type Entry = { name: string; scryfallId: string };

const lockPath = resolve("data/card-index.json");
if (!existsSync(lockPath)) {
    console.error(
        "✗ card-index: data/card-index.json is missing. Seed it with:\n" +
            "  printf '[]\\n' > data/card-index.json && bun run scripts/backfill-card-index.ts"
    );
    process.exit(1);
}

const lock: Entry[] = JSON.parse(readFileSync(lockPath, "utf-8"));
const cards = getAllCards();

const lockIds = new Set(lock.map((e) => e.scryfallId));
const registryIds = new Set(cards.map((c) => c.id));

// implemented but not indexed → stale lockfile
const missing = cards.filter((c) => !lockIds.has(c.id));
// indexed but not implemented → pollution
const extra = lock.filter((e) => !registryIds.has(e.scryfallId));

if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ card-index: in sync (${cards.length} cards)`);
    process.exit(0);
}

console.error(
    `✗ card-index: lockfile out of sync with the registry ` +
        `(${missing.length} missing, ${extra.length} extra)\n`
);
if (missing.length) {
    console.error(`MISSING from lockfile (implemented but not indexed):`);
    for (const c of missing.slice(0, 30))
        console.error(`  - ${c.name} (${c.id})`);
    if (missing.length > 30)
        console.error(`  … and ${missing.length - 30} more`);
    console.error("");
}
if (extra.length) {
    console.error(
        `EXTRA in lockfile (indexed but NOT implemented — pollution):`
    );
    for (const e of extra.slice(0, 30))
        console.error(`  - ${e.name} (${e.scryfallId})`);
    if (extra.length > 30) console.error(`  … and ${extra.length - 30} more`);
    console.error("");
}
console.error(
    "Regenerate the lockfile from the registry:\n" +
        "  printf '[]\\n' > data/card-index.json && bun run scripts/backfill-card-index.ts"
);
process.exit(1);
