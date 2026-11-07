/**
 * `bun run combos:census` — the Combo Census report (ADR 0164 § 2, issue
 * #8417): per Combo Corpus entry, Executable / Initiated / Untouched /
 * unmeasurable. A report, never a verdict on the tree: it exits non-zero only
 * when it cannot run. Its measured cost is its `HEALTH_ONLY_GUARDS` row.
 *
 * The corpus is read here and handed in, because nothing under `convex/` may
 * reach it (`combo-corpus-seam.test.ts`). The entries are dealt to child
 * processes by index and the rows merged back in corpus order: a reading depends
 * on its entry and the seeds alone, so the shard count cannot move a byte. The
 * report goes to stdout and carries no wall-clock; progress and the elapsed time
 * go to stderr.
 *
 * Usage: bun run combos:census [--limit N] [--jobs N]
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    COMBO_CENSUS_OPTIONS,
    collectComboCensus,
    formatComboCensus,
    type ComboCensusRow,
} from "../convex/gre/ai/blade/comboCensus";
import type { ComboCorpusEntry } from "./lib/combo-corpus";

const CORPUS_PATH = resolve(import.meta.dir, "../data/combos/corpus.json");
const MAX_DEFAULT_JOBS = 4;

function intFlag(argv: readonly string[], flag: string): number | undefined {
    const at = argv.indexOf(flag);
    if (at === -1) return undefined;
    const value = Number(argv[at + 1]);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
            `${flag} needs a positive integer, got ${argv[at + 1]}`
        );
    }
    return value;
}

function readEntries(limit: number | undefined): ComboCorpusEntry[] {
    const { combos } = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as {
        combos: ComboCorpusEntry[];
    };
    return limit === undefined ? combos : combos.slice(0, limit);
}

/** The child: one shard's rows as JSON on stdout, one progress dot per row. */
function runShard(shard: number, jobs: number, limit: number | undefined) {
    const entries = readEntries(limit).filter((_, i) => i % jobs === shard);
    const rows = collectComboCensus(entries, COMBO_CENSUS_OPTIONS, () => {
        process.stderr.write(".");
    });
    process.stdout.write(JSON.stringify(rows));
}

function spawnShard(
    shard: number,
    jobs: number,
    limit: number | undefined
): Promise<ComboCensusRow[]> {
    return new Promise((resolveRows, reject) => {
        const child = spawn(
            process.execPath,
            [
                import.meta.path,
                "--shard",
                String(shard + 1),
                "--jobs",
                String(jobs),
                ...(limit === undefined ? [] : ["--limit", String(limit)]),
            ],
            { stdio: ["ignore", "pipe", "inherit"] }
        );
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => (stdout += chunk));
        child.on("error", reject);
        child.on("close", (code, signal) => {
            if (code === 0) resolveRows(JSON.parse(stdout) as ComboCensusRow[]);
            else
                reject(
                    new Error(
                        `shard ${shard + 1}/${jobs} ended with ${signal ?? `exit ${code}`}`
                    )
                );
        });
    });
}

async function main(argv: readonly string[]): Promise<void> {
    const limit = intFlag(argv, "--limit");
    const jobs =
        intFlag(argv, "--jobs") ??
        Math.min(Math.max(availableParallelism() - 1, 1), MAX_DEFAULT_JOBS);
    const shard = intFlag(argv, "--shard");
    if (shard !== undefined) {
        runShard(shard - 1, jobs, limit);
        return;
    }
    const startedAt = Date.now();
    const shards = await Promise.all(
        Array.from({ length: jobs }, (_, i) => spawnShard(i, jobs, limit))
    );
    const byId = new Map(shards.flat().map((row) => [row.id, row]));
    const rows = readEntries(limit).map((entry) => byId.get(entry.id)!);
    process.stderr.write(
        `\ncombos:census: ${rows.length} entries, ${jobs} jobs, ${Math.round((Date.now() - startedAt) / 1000)} s\n`
    );
    console.log(formatComboCensus(rows, COMBO_CENSUS_OPTIONS));
}

await main(process.argv.slice(2));
