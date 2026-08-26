#!/usr/bin/env bun
/**
 * Derives `data/oracle-compiled-pool.json` — the interim bundle-time
 * artifact `convex/cards/compiledCatalogue.ts` imports at module load
 * (issue #2702, PRD #2693).
 *
 * Pure JOIN of two already-committed, OFFLINE sources — no network:
 *   - `data/oracle-compiled.json` (the compiler's lockfile) for `state ===
 *     "ready"` rows: `{ oracleId, name, definition }`.
 *   - `data/card-index.json` (ADR 0041, extended by `oracle-index-backfill.ts`,
 *     issue #2702) for the `id`/`rarity` a `CardDefinition` needs but the
 *     compiler is forbidden from emitting (`convex/oracle/types.ts` —
 *     `CompiledDefinition` omits `id`/`rarity` by TYPE).
 *
 * A `ready` row is EXCLUDED from the pool, not included with a placeholder,
 * when:
 *   - its `oracleId` has no `data/card-index.json` entry yet (not backfilled
 *     — re-run `bun run oracle:index`, then this script);
 *   - its `oracleId` already has a HAND-WRITTEN entry (`source !== "compiled"`)
 *     — the hand-written `CardDefinition` stays sole authority for that card
 *     (PRD #2693 "gold as oracle"); registering a compiled duplicate under
 *     the SAME id (both resolve to the same first-print id, ADR 0041) would
 *     silently overwrite it depending on registration order, which is exactly
 *     the failure this exclusion prevents. Retiring a hand-written card in
 *     favour of its proven-equal compiled twin is its own future PR (PRD
 *     #2693 "Retirement of proven duplicates"), not a side effect of this join.
 *
 * Deterministic + idempotent: same two inputs -> byte-identical output,
 * sorted by `id`. Never hand-edited — regenerate with:
 *
 *   bun run oracle:pool
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Rarity = "common" | "uncommon" | "rare" | "mythic";

interface CardIndexEntry {
    name: string;
    scryfallId: string;
    oracleId: string;
    firstPrintId: string;
    rarity?: Rarity;
    source?: "compiled";
}

interface ReadyRow {
    oracleId: string;
    name: string;
    state: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque JSON passthrough, shaped like CompiledDefinition
    definition?: Record<string, any>;
}

const OUT_PATH = resolve("data/oracle-compiled-pool.json");

function main() {
    const lockfile = JSON.parse(
        readFileSync(resolve("data/oracle-compiled.json"), "utf-8")
    ) as { cards: ReadyRow[] };
    const cardIndex = JSON.parse(
        readFileSync(resolve("data/card-index.json"), "utf-8")
    ) as CardIndexEntry[];

    const byOracleId = new Map(cardIndex.map((e) => [e.oracleId, e]));
    const ready = lockfile.cards.filter((c) => c.state === "ready");

    const pool: Record<string, unknown>[] = [];
    let noIndexEntry = 0;
    let handWritten = 0;
    for (const row of ready) {
        const entry = byOracleId.get(row.oracleId);
        if (!entry) {
            noIndexEntry++;
            continue;
        }
        if (entry.source !== "compiled") {
            handWritten++;
            continue;
        }
        if (!entry.rarity) {
            noIndexEntry++;
            continue;
        }
        pool.push({
            ...row.definition,
            id: entry.firstPrintId,
            rarity: entry.rarity,
        });
    }

    pool.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    writeFileSync(OUT_PATH, JSON.stringify(pool, null, 4) + "\n", "utf-8");
    console.log(
        `oracle-pool: ${pool.length} ready row(s) joined -> ${OUT_PATH}\n` +
            `  ${noIndexEntry} skipped (no card-index entry yet — run \`bun run oracle:index\`)\n` +
            `  ${handWritten} skipped (already hand-written — gold stays authoritative)`
    );
}

main();
