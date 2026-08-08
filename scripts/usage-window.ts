#!/usr/bin/env bun
// `bun run usage:window` — report a LOCAL PROXY for recent token burn against
// a user-declared budget, over Claude Code's own JSONL session transcripts.
//
// This wrapper holds no decisions of its own — parsing, summing, weighting
// and the budget percentage are all pure functions in `lib/usage-window.ts`.
// This file's only job is I/O: find candidate transcript files, prefilter by
// mtime, stream them line by line, and print one JSON object.
//
// Usage:
//   bun run usage:window
//   bun run usage:window --hours 5 --budget 2000000
//   bun run usage:window --projects ~/.claude/projects --weights w.json --pretty
//
// Exit code: 0 always, EXCEPT bad arguments (2). This is a reporter, not a
// gate — `scripts/loop-drain.sh` is the thing that decides to stop.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

import {
    parseUsageLine,
    sumWindow,
    weightedTokens,
    pctOfBudget,
    DEFAULT_WEIGHTS,
    type UsageRecord,
    type CategoryWeights,
    type WeightClass,
} from "./lib/usage-window";

interface Args {
    hours: number;
    budget: number;
    projectsDir: string;
    weightsFile: string | undefined;
    pretty: boolean;
}

function usageError(message: string): never {
    console.error(`usage-window: ${message}`);
    process.exit(2);
}

function parseArgs(argv: string[]): Args {
    let hours = 5;
    const envBudget = Number(process.env.TOLARIA_LOOP_TOKEN_BUDGET ?? "");
    let budget = Number.isFinite(envBudget) ? envBudget : 0;
    let projectsDir = path.join(os.homedir(), ".claude", "projects");
    let weightsFile: string | undefined;
    let pretty = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--hours": {
                const v = argv[++i];
                if (v === undefined) usageError("--hours needs a value");
                hours = Number(v);
                break;
            }
            case "--budget": {
                const v = argv[++i];
                if (v === undefined) usageError("--budget needs a value");
                budget = Number(v);
                break;
            }
            case "--projects": {
                const v = argv[++i];
                if (v === undefined) usageError("--projects needs a value");
                projectsDir = v;
                break;
            }
            case "--weights": {
                const v = argv[++i];
                if (v === undefined) usageError("--weights needs a value");
                weightsFile = v;
                break;
            }
            case "--pretty":
                pretty = true;
                break;
            default:
                usageError(`unknown argument: ${a}`);
        }
    }

    if (!Number.isFinite(hours) || hours <= 0) {
        usageError("--hours must be a positive number");
    }
    if (!Number.isFinite(budget) || budget < 0) {
        usageError("--budget must be a non-negative number");
    }
    return { hours, budget, projectsDir, weightsFile, pretty };
}

function loadWeights(
    weightsFile: string | undefined
): Record<WeightClass, CategoryWeights> {
    if (!weightsFile) return DEFAULT_WEIGHTS;
    let raw: string;
    try {
        raw = fs.readFileSync(weightsFile, "utf8");
    } catch (e) {
        usageError(
            `could not read --weights file ${weightsFile}: ${(e as Error).message}`
        );
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        usageError(
            `--weights file ${weightsFile} is not valid JSON: ${(e as Error).message}`
        );
    }
    if (typeof parsed !== "object" || parsed === null) {
        usageError(`--weights file ${weightsFile} must be a JSON object`);
    }
    const overrides = parsed as Partial<
        Record<WeightClass, Partial<CategoryWeights>>
    >;
    const merged: Record<WeightClass, CategoryWeights> = {
        sonnet: { ...DEFAULT_WEIGHTS.sonnet },
        opus: { ...DEFAULT_WEIGHTS.opus },
        haiku: { ...DEFAULT_WEIGHTS.haiku },
    };
    for (const cls of Object.keys(merged) as WeightClass[]) {
        const o = overrides[cls];
        if (o) merged[cls] = { ...merged[cls], ...o };
    }
    return merged;
}

/** Recursively list `.jsonl` files under `dir` whose mtime is on/after
 * `sinceMs`. This is a file-level prefilter only — Claude Code transcripts
 * are append-only and chronological, so a file untouched since before the
 * window cannot contain any in-window line. A missing/unreadable directory
 * yields an empty list rather than throwing (reporter, not a gate). */
function candidateFiles(dir: string, sinceMs: number): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                let stat: fs.Stats;
                try {
                    stat = fs.statSync(full);
                } catch {
                    continue;
                }
                if (stat.mtimeMs >= sinceMs) out.push(full);
            }
        }
    };
    walk(dir);
    return out;
}

/** Stream one file line by line (never slurping the whole file into memory —
 * transcripts run to hundreds of MB) and parse each line. */
async function collectFromFile(file: string): Promise<UsageRecord[]> {
    const out: UsageRecord[] = [];
    const rl = readline.createInterface({
        input: fs.createReadStream(file, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });
    for await (const line of rl) {
        const rec = parseUsageLine(line);
        if (rec) out.push(rec);
    }
    return out;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const sinceMs = Date.now() - args.hours * 60 * 60 * 1000;

    const files = candidateFiles(args.projectsDir, sinceMs);
    const records: UsageRecord[] = [];
    for (const file of files) {
        records.push(...(await collectFromFile(file)));
    }

    const sum = sumWindow(records, sinceMs);
    const weights = loadWeights(args.weightsFile);
    const weighted = weightedTokens(sum, weights);
    const pct = pctOfBudget(weighted, args.budget);

    const out = {
        sinceIso: new Date(sinceMs).toISOString(),
        hours: args.hours,
        models: sum.models,
        totals: sum.totals,
        weighted,
        budget: args.budget,
        pct,
    };

    console.log(JSON.stringify(out, null, args.pretty ? 2 : undefined));
    process.exit(0);
}

main().catch((e: unknown) => {
    // A reporter should not throw an unattended loop into a stack trace it
    // has to grep for a pct — but a genuinely broken invocation still needs
    // to be visible, so print and exit 0 with an empty-shaped report rather
    // than crash the caller.
    console.error(`usage-window: ${(e as Error)?.stack ?? String(e)}`);
    process.exit(0);
});
