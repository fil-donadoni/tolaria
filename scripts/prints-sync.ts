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
 * Bootstrap flags (issue #5414 — empty or stale tables make a token render
 * the placeholder, silently):
 *
 *   --if-stale    skip (before the Scryfall download) when both tables have
 *                 rows AND the last successful sync recorded the CURRENT
 *                 definition-set digest (issue #7690). `bun run
 *                 prints:ensure`, the hosting build and `post-merge` use it,
 *                 so a landed card gets its Token Prints and a fresh
 *                 deployment costs one query.
 *   --deploy      write to the deployment CONVEX_DEPLOY_KEY selects instead
 *                 of the local one (`bun run prints:sync:deploy`, chained
 *                 after `convex deploy` in `vercel.json`).
 *   --prod        write to the production deployment through the Convex CLI
 *                 login (`seed:preset --prod`'s target) — the by-hand repair.
 *   --warn-only   a failure prints loudly and exits 0, for chains a red exit
 *                 would block for an unrelated reason (`dev`, a deploy).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
    definitionSetDigest,
    deploymentPredatesSyncState,
    parsePrintsSyncArgs,
    printsSyncTarget,
    syncOwed,
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

async function buildRows(
    definitionByOracleId: ReadonlyMap<string, string>,
    overrides: ReturnType<typeof loadRarityOverrides>
): Promise<{
    rows: CardPrintRow[];
    definitionTokens: DefinitionTokenRow[];
    scanned: number;
}> {
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
    definitionTokens: readonly DefinitionTokenRow[],
    digest: string
): void {
    upsertAll(plan, "cardPrints:upsertBatch", rows, "matched rows");
    upsertAll(
        plan,
        "cardPrints:upsertDefinitionTokensBatch",
        definitionTokens,
        "definition token rows"
    );
    // Recorded only after BOTH upserts succeeded (each throws on a failed
    // batch): a half-written sync stays stale and the next run repeats it.
    convexRun(plan, "cardPrints:recordSync", { definitionSetDigest: digest });
    console.log(`SYNC — recorded definition-set digest ${digest.slice(0, 12)}`);
}

function convexRun(
    plan: Required<SeedTargetPlan>,
    fn: string,
    args: Record<string, unknown> = {}
): string {
    const result = spawnSync(
        "npx",
        ["convex", "run", ...plan.flags, fn, JSON.stringify(args)],
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
    return (result.stdout ?? "").trim();
}

function readPopulated(plan: Required<SeedTargetPlan>): PrintsPopulated {
    return JSON.parse(
        convexRun(plan, "cardPrints:populated")
    ) as PrintsPopulated;
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
    // Read ONCE, before the download: the rows are built from this
    // definition set, and the digest recorded (issue #7690) is ITS digest
    // even if a fast-forward rewrites card-index.json mid-sync.
    const definitionByOracleId = buildDefinitionIndex(readCardIndex());
    const overrides = loadRarityOverrides();
    const digest = definitionSetDigest(
        definitionByOracleId.values(),
        overrides
    );
    const plan = target.cwd ? (target as Required<SeedTargetPlan>) : null;
    if (!args.dryRun) {
        if (!plan) throw new Error(target.error ?? "no deployment selected");
        if (args.ifStale) {
            const populated = readPopulated(plan);
            if (deploymentPredatesSyncState(populated)) {
                console.warn(
                    "prints-sync: the deployment's cardPrints functions predate issue #7690 (no syncedDigest) — skipping; redeploy the functions, then rerun"
                );
                return;
            }
            const owed = syncOwed(populated, digest);
            if (owed.length === 0) {
                console.log(
                    "prints-sync: tables synced for the current definition set, skipping."
                );
                return;
            }
            console.warn(`prints-sync: sync owed — ${owed.join("; ")}`);
        }
    }

    const { rows, definitionTokens, scanned } = await buildRows(
        definitionByOracleId,
        overrides
    );
    process.stderr.write(
        `prints-sync: scanned ${scanned} Scryfall printing(s), matched ${rows.length}, ` +
            `${definitionTokens.length} definition printing(s) link a token\n`
    );

    if (args.dryRun) return runDryRun(rows, definitionTokens);
    return runWrite(plan!, rows, definitionTokens, digest);
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
