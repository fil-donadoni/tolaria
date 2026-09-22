#!/usr/bin/env bun
/**
 * `bun run prints:sync [--dry-run|--equivalence]` — ADR 0140, issue #4116.
 *
 * Reads Scryfall's `default_cards` bulk and keeps every printing of every
 * oracle id with a Card Definition (`data/card-index.json`), except oversized
 * cards, then upserts the result into the `cardPrints` table
 * (`convex/cardPrints.ts:upsertBatch`) — idempotent, never deletes a row.
 *
 * Three modes:
 *
 *   bun run prints:sync             — the real sync: writes to the LOCAL
 *                                      deployment (the primary checkout's
 *                                      `.env.local`, mirroring
 *                                      `scripts/seed-preset-deck.ts`).
 *   bun run prints:sync --dry-run   — builds every row, prints the row
 *                                      count, token-link count and total
 *                                      bytes, WRITES NOTHING (no Convex call
 *                                      at all).
 *   bun run prints:sync --equivalence — compares the generated rows against
 *                                      the 1,409 hand-written `CardPrint`
 *                                      literals under `convex/cards/sets/**`
 *                                      and exits non-zero on any difference
 *                                      NOT covered by
 *                                      `data/prints-rarity-overrides.json`'s
 *                                      `printOverrides`. Also writes nothing.
 *
 * Rollout order (PRD #4115): this file lands with the hand-written records
 * still in place. They are deleted only once `--equivalence` is clean.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { primaryCheckout } from "./lib/primary-checkout";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { streamDefaultCards } from "./lib/prints-bulk";
import {
    buildCardPrintRow,
    buildDefinitionIndex,
    summarizePrintRows,
    type CardIndexRow,
    type CardPrintRow,
} from "./lib/prints-transform";
import { loadRarityOverrides } from "./lib/prints-rarity";
import {
    collectHandwrittenPrints,
    diffAgainstHandwritten,
} from "./lib/prints-handwritten";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Convex mutation args carry at most 8 MB; batching also keeps one failed
// batch from losing every row already accepted.
const BATCH_SIZE = 500;

function readCardIndex(): CardIndexRow[] {
    const raw = JSON.parse(
        readFileSync(join(ROOT, "data/card-index.json"), "utf8")
    ) as { oracleId: string; scryfallId: string }[];
    return raw.map((r) => ({
        oracleId: r.oracleId,
        scryfallId: r.scryfallId,
    }));
}

async function buildRows(): Promise<{ rows: CardPrintRow[]; scanned: number }> {
    const definitionByOracleId = buildDefinitionIndex(readCardIndex());
    const overrides = loadRarityOverrides();
    const rows: CardPrintRow[] = [];
    let scanned = 0;
    await streamDefaultCards((row) => {
        scanned++;
        const built = buildCardPrintRow(row, definitionByOracleId, overrides);
        if (built) rows.push(built);
    });
    return { rows, scanned };
}

function runDryRun(rows: readonly CardPrintRow[]): void {
    const summary = summarizePrintRows(rows);
    console.log(
        `DRY RUN — rows: ${summary.rowCount}, token links: ${summary.tokenLinkCount}, ` +
            `total bytes: ${summary.totalBytes} (${(
                summary.totalBytes / 1_000_000
            ).toFixed(2)} MB). Nothing written.`
    );
}

function runEquivalence(rows: readonly CardPrintRow[]): void {
    const overrides = loadRarityOverrides();
    const handwritten = collectHandwrittenPrints(
        join(ROOT, "convex/cards/sets")
    );
    const generatedByPrintId = new Map(
        rows.map((r) => [
            r.printId,
            { cardId: r.cardId, set: r.set, rarity: r.rarity },
        ])
    );
    const coveredRarityOverridePrintIds = new Set(
        Object.keys(overrides.printOverrides)
    );
    const diffs = diffAgainstHandwritten(
        handwritten,
        generatedByPrintId,
        coveredRarityOverridePrintIds
    );

    console.log(
        `EQUIVALENCE — ${handwritten.length} hand-written record(s) checked, ` +
            `${diffs.length} uncovered difference(s).`
    );
    const SHOWN = 50;
    for (const diff of diffs.slice(0, SHOWN)) {
        console.log(
            `  ${diff.file}: printId ${diff.printId} ${diff.field} ` +
                `handwritten=${diff.handwritten} generated=${diff.generated ?? "<missing>"}`
        );
    }
    if (diffs.length > SHOWN) {
        console.log(`  … and ${diffs.length - SHOWN} more`);
    }
    if (diffs.length > 0) process.exitCode = 1;
}

function runWrite(rows: readonly CardPrintRow[]): void {
    const cwd = primaryCheckout();
    let inserted = 0;
    let patched = 0;
    let unchanged = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = spawnSync(
            "npx",
            [
                "convex",
                "run",
                "cardPrints:upsertBatch",
                JSON.stringify({ rows: batch }),
            ],
            { cwd, encoding: "utf8", timeout: 120_000 }
        );
        if (result.error || result.status !== 0) {
            // `result.error` is a spawn-level failure (ENOENT, ETIMEDOUT on
            // the 120s cap) with no stdout/stderr to parse — prefer its own
            // message over `convexRunErrorMessage`'s generic fallback, same
            // as `scripts/lib/seed-preset-run.ts`'s `seedPreset`.
            const message = result.error
                ? result.error.message
                : convexRunErrorMessage(
                      `${result.stderr ?? ""}${result.stdout ?? ""}`
                  );
            throw new Error(
                `prints-sync: batch at offset ${i} failed — ${message}`
            );
        }
        const parsed = JSON.parse((result.stdout ?? "").trim()) as {
            inserted: number;
            patched: number;
            unchanged: number;
        };
        inserted += parsed.inserted;
        patched += parsed.patched;
        unchanged += parsed.unchanged;
    }
    console.log(
        `SYNC — inserted ${inserted}, patched ${patched}, unchanged ${unchanged} ` +
            `(of ${rows.length} matched rows).`
    );
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes("--dry-run");
    const equivalence = process.argv.includes("--equivalence");
    if (dryRun && equivalence) {
        throw new Error(
            "prints-sync: pass --dry-run OR --equivalence, not both"
        );
    }

    const { rows, scanned } = await buildRows();
    process.stderr.write(
        `prints-sync: scanned ${scanned} Scryfall printing(s), matched ${rows.length}\n`
    );

    if (equivalence) return runEquivalence(rows);
    if (dryRun) return runDryRun(rows);
    return runWrite(rows);
}

if (import.meta.main) {
    await main();
}
