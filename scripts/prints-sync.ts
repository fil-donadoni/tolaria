#!/usr/bin/env bun
/**
 * `bun run prints:sync [--dry-run]` — ADR 0140, issue #4116.
 *
 * Reads Scryfall's `default_cards` bulk and keeps every printing of every
 * oracle id with a Card Definition (`data/card-index.json`), except oversized
 * cards, then upserts the result into the `cardPrints` table
 * (`convex/cardPrints.ts:upsertBatch`) — idempotent, never deletes a row.
 *
 * The printing whose id IS the Card ID gets no `cardPrints` row, but when it
 * links a token its Token Prints go to `definitionTokenPrints`
 * (`cardPrints:upsertDefinitionTokensBatch`, issue #4120) — the row an object
 * on its default printing resolves its tokens through.
 *
 * Two modes:
 *
 *   bun run prints:sync             — the real sync: writes to the LOCAL
 *                                      deployment (the primary checkout's
 *                                      `.env.local`, mirroring
 *                                      `scripts/seed-preset-deck.ts`).
 *   bun run prints:sync --dry-run   — builds every row, prints the row
 *                                      count, token-link count and total
 *                                      bytes, WRITES NOTHING (no Convex call
 *                                      at all).
 *
 * Bootstrap flags (issue #5414 — empty tables make every token render the
 * placeholder, silently):
 *
 *   --if-empty    skip (before the Scryfall download) when both tables
 *                 already have rows. `bun run prints:ensure` and the
 *                 hosting build use it, so they cost nothing once filled.
 *   --deploy      write to the deployment CONVEX_DEPLOY_KEY selects instead
 *                 of the local one (`bun run prints:sync:deploy`, chained
 *                 after `convex deploy` in `vercel.json`).
 *   --warn-only   a failure prints loudly and exits 0, for chains a red exit
 *                 would block for an unrelated reason (`dev`, a deploy).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
    emptyPrintTables,
    emptyTablesMessage,
    parsePrintsSyncArgs,
    printsSyncTarget,
    type PrintsPopulated,
} from "./lib/prints-sync-run";
import type { SeedTargetPlan } from "./lib/seed-preset-run";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { streamDefaultCards } from "./lib/prints-bulk";
import {
    buildCardPrintRow,
    buildDefinitionIndex,
    buildDefinitionTokenRow,
    summarizePrintRows,
    type CardIndexRow,
    type CardPrintRow,
    type DefinitionTokenRow,
} from "./lib/prints-transform";
import { loadRarityOverrides } from "./lib/prints-rarity";

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

async function buildRows(): Promise<{
    rows: CardPrintRow[];
    definitionTokens: DefinitionTokenRow[];
    scanned: number;
}> {
    const definitionByOracleId = buildDefinitionIndex(readCardIndex());
    const overrides = loadRarityOverrides();
    const rows: CardPrintRow[] = [];
    const definitionTokens: DefinitionTokenRow[] = [];
    let scanned = 0;
    await streamDefaultCards((row) => {
        scanned++;
        const built = buildCardPrintRow(row, definitionByOracleId, overrides);
        if (built) rows.push(built);
        const definition = buildDefinitionTokenRow(row, definitionByOracleId);
        if (definition) definitionTokens.push(definition);
    });
    return { rows, definitionTokens, scanned };
}

function runDryRun(
    rows: readonly CardPrintRow[],
    definitionTokens: readonly DefinitionTokenRow[]
): void {
    const summary = summarizePrintRows(rows);
    console.log(
        `DRY RUN — rows: ${summary.rowCount}, token links: ${summary.tokenLinkCount}, ` +
            `definition token rows: ${definitionTokens.length}, ` +
            `total bytes: ${summary.totalBytes} (${(
                summary.totalBytes / 1_000_000
            ).toFixed(2)} MB). Nothing written.`
    );
}

function runWrite(
    plan: Required<SeedTargetPlan>,
    rows: readonly CardPrintRow[],
    definitionTokens: readonly DefinitionTokenRow[]
): void {
    upsertAll(plan, "cardPrints:upsertBatch", rows, "matched rows");
    upsertAll(
        plan,
        "cardPrints:upsertDefinitionTokensBatch",
        definitionTokens,
        "definition token rows"
    );
}

function readPopulated(plan: Required<SeedTargetPlan>): PrintsPopulated {
    const result = spawnSync(
        "npx",
        ["convex", "run", ...plan.flags, "cardPrints:populated"],
        { cwd: plan.cwd, encoding: "utf8", timeout: 120_000 }
    );
    if (result.error || result.status !== 0) {
        throw new Error(
            result.error
                ? result.error.message
                : convexRunErrorMessage(
                      `${result.stderr ?? ""}${result.stdout ?? ""}`
                  )
        );
    }
    return JSON.parse((result.stdout ?? "").trim()) as PrintsPopulated;
}

function upsertAll(
    plan: Required<SeedTargetPlan>,
    fn: string,
    rows: readonly unknown[],
    what: string
): void {
    const { cwd, flags } = plan;
    let inserted = 0;
    let patched = 0;
    let unchanged = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = spawnSync(
            "npx",
            ["convex", "run", ...flags, fn, JSON.stringify({ rows: batch })],
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
            `(of ${rows.length} ${what}).`
    );
}

async function sync(
    args: ReturnType<typeof parsePrintsSyncArgs>
): Promise<void> {
    const target = printsSyncTarget(args);
    const plan = target.cwd ? (target as Required<SeedTargetPlan>) : null;
    if (!args.dryRun) {
        if (!plan) throw new Error(target.error ?? "no deployment selected");
        if (args.ifEmpty) {
            const empty = emptyPrintTables(readPopulated(plan));
            if (empty.length === 0) {
                console.log("prints-sync: tables already populated, skipping.");
                return;
            }
            console.warn(emptyTablesMessage(empty));
        }
    }

    const { rows, definitionTokens, scanned } = await buildRows();
    process.stderr.write(
        `prints-sync: scanned ${scanned} Scryfall printing(s), matched ${rows.length}, ` +
            `${definitionTokens.length} definition printing(s) link a token\n`
    );

    if (args.dryRun) return runDryRun(rows, definitionTokens);
    return runWrite(plan!, rows, definitionTokens);
}

async function main(): Promise<void> {
    const args = parsePrintsSyncArgs(process.argv);
    try {
        await sync(args);
    } catch (err) {
        const message = (err as Error).message;
        if (!args.warnOnly) throw err;
        console.error(
            `prints-sync: FAILED — ${message}\n` +
                `prints-sync: tokens render the placeholder until \`bun run prints:sync\` succeeds`
        );
    }
}

if (import.meta.main) {
    await main();
}
