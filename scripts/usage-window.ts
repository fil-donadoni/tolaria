#!/usr/bin/env bun
// `bun run usage:window` — report a LOCAL PROXY for recent token burn against
// a user-declared budget, over Claude Code's own JSONL session transcripts.
//
// This wrapper holds no decisions of its own — parsing, summing, weighting
// and the budget percentage are all pure functions in `lib/usage-window.ts`.
// This file's only job is I/O: find candidate transcript files, prefilter by
// mtime, stream them line by line, and print one JSON object.
//
// TWO READINGS, AND THEY ANSWER DIFFERENT QUESTIONS (issue #3699):
//
//   --hours H            a trailing WINDOW over every session on the machine.
//                        "How hot has this box been lately." It forgets: an
//                        eight-hour run never accumulates more than H hours of
//                        it, and the figure falls as often as it rises.
//   --since MS --run ID  a RUN's own spend, from its launch forward, counting
//                        only the transcripts of the sessions that run
//                        started. Monotonic by construction, and blind to the
//                        operator's concurrent interactive work.
//
// The second is what a BUDGET means, and using the first for it is the bug
// this file was fixed for: a launch with a 140M budget tripped immediately at
// 132% on spend the driver had not made, and across 23 recorded runs not one
// ever ended with reason `budget`.
//
// Usage:
//   bun run usage:window
//   bun run usage:window --hours 5 --budget 2000000
//   bun run usage:window --since 1757980000000 --run 1757980000-4242 --budget 2e8
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
import { sessionsOfRun, originLedgerPath } from "./lib/session-origin";

interface Args {
    hours: number;
    /** Absolute left edge in epoch ms, from `--since`. When set it REPLACES
     *  the `--hours` window: a run's budget is counted from its own launch,
     *  never from a rolling window that predates it. */
    sinceMs: number | undefined;
    /** From `--run`: count only the sessions the journal attributes to this
     *  AFK run. Undefined means every session, the old machine-wide reading. */
    runId: string | undefined;
    sessionsFile: string;
    budget: number;
    projectsDir: string;
    weightsFile: string | undefined;
    pretty: boolean;
}

/** `--since` accepts epoch milliseconds or an ISO timestamp — the driver has
 *  the former in a shell variable, a human reading the docs reaches for the
 *  latter, and refusing one of them buys nothing. */
function parseSince(v: string): number {
    if (/^\d+$/.test(v)) return Number(v);
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) {
        usageError(`--since must be epoch ms or an ISO timestamp, got: '${v}'`);
    }
    return ms;
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
    let sinceMs: number | undefined;
    let runId: string | undefined;
    let sessionsFile = originLedgerPath();

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
            case "--since": {
                const v = argv[++i];
                if (v === undefined) usageError("--since needs a value");
                sinceMs = parseSince(v);
                break;
            }
            case "--run": {
                const v = argv[++i];
                if (v === undefined) usageError("--run needs a value");
                runId = v;
                break;
            }
            case "--sessions": {
                const v = argv[++i];
                if (v === undefined) usageError("--sessions needs a value");
                sessionsFile = v;
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
    if (sinceMs !== undefined && (!Number.isFinite(sinceMs) || sinceMs < 0)) {
        usageError("--since must be a non-negative epoch or an ISO timestamp");
    }
    return {
        hours,
        sinceMs,
        runId,
        sessionsFile,
        budget,
        projectsDir,
        weightsFile,
        pretty,
    };
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
        fable: { ...DEFAULT_WEIGHTS.fable },
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
function candidateFiles(
    dir: string,
    sinceMs: number,
    /** When present, only transcripts whose file name IS one of these session
     *  ids are read. A Claude Code transcript lives at
     *  `<projects>/<slug>/<session-id>.jsonl`, so the file name is the join
     *  key — the lines themselves need no new field, and a run's spend is
     *  read from exactly the run's own files. An EMPTY set is not "no filter":
     *  it means the run owns no session yet, and therefore has spent nothing,
     *  which is precisely why a fresh run is never blocked by pre-existing
     *  spend (issue #3699). */
    sessions?: ReadonlySet<string>
): string[] {
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
                if (
                    sessions &&
                    !sessions.has(entry.name.slice(0, -".jsonl".length))
                ) {
                    continue;
                }
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
    const sinceMs = args.sinceMs ?? Date.now() - args.hours * 60 * 60 * 1000;

    // The run's own sessions, or undefined for the machine-wide reading. A
    // missing/unreadable journal yields an EMPTY set rather than "no filter":
    // failing open here would silently restore the machine-wide reading under
    // a flag that says the opposite.
    let sessions: Set<string> | undefined;
    if (args.runId !== undefined) {
        let text = "";
        try {
            text = fs.readFileSync(args.sessionsFile, "utf8");
        } catch {
            text = "";
        }
        sessions = sessionsOfRun(text, args.runId);
    }

    const files = candidateFiles(args.projectsDir, sinceMs, sessions);
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
        sinceMs,
        hours: args.sinceMs === undefined ? args.hours : null,
        runId: args.runId ?? null,
        sessions: sessions ? sessions.size : null,
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
