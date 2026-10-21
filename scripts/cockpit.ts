#!/usr/bin/env bun
// `bun run cockpit [--days 7] [--port 5174] [--no-open]` — one page of the
// workflow's trends (issue #5652, ADR 0156 Amendment I § The dashboard is
// simplified, not removed). The Actions tab is the "now"; this is "is the
// flow getting better".
//
//   1. ingest      `telemetry:ingest` into the primary checkout's store
//   2. read        this machine's `telemetry:budget` / `telemetry:latency`,
//                  the other machines' readings from the last
//                  `weekly-report` run, the weekly report's GitHub facts over
//                  the `--days` ending now (`weekly-report.ts`'s
//                  `gatherFacts`), GitHub's runner list
//   3. write       the reading (`lib/cockpit-reading.ts`) to
//                  `~/.cache/tolaria/cockpit/cockpit.json`
//   4. build       the page, when a source is newer than its build
//   5. serve, open `telemetry-serve.ts` on 127.0.0.1, the browser on it
//
// A source that cannot be read is a line in the reading's `errors`, never a
// failed run: the page says what is missing. A server already on the port
// (an earlier `bun run cockpit`) is left running — it reads the file on
// every request, so the browser opens on the fresh reading.

import { spawn, spawnSync } from "node:child_process";
import {
    mkdirSync,
    rmSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { gh } from "./lib/gh";
import { originRepo } from "./lib/health-verdict-store";
import { primaryCheckout } from "./lib/primary-checkout";
import { parseDeclaration, sanitizeHost } from "./lib/github-runner";
import type { RunnerRow } from "./lib/afk-dispatch";
import {
    buildIsStale,
    cockpitArtifactCache,
    cockpitDir,
    cockpitReadingPath,
    machinesToReport,
    runnerViews,
} from "./lib/cockpit";
import type { CockpitReading, RunnerView } from "./lib/cockpit-reading";
import { DASHBOARD_OUT_DIR } from "./lib/dashboard-build";
import {
    weeklyTrends,
    type MachineReading,
    type Trends,
} from "./lib/workflow-trends";
import {
    gatherFacts,
    machineReadings,
    readMachine,
    windowEnding,
} from "./weekly-report";
import { resolvePort, startServer } from "./telemetry-serve";

/** The checkout this script runs from: its page is the one built and served. */
const ROOT = join(import.meta.dirname, "..");
const WEEKLY_WORKFLOW = "weekly-report.yml";
/** Where the runner install remembers this machine's host (`runner`). */
const MACHINE_DECLARATION = join(
    homedir(),
    ".local/share/tolaria/actions-runner/machine.json"
);

function argOf(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const say = (msg: string) => console.error(`cockpit: ${msg}`);
const firstLine = (e: unknown) =>
    (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200);

/** The host this machine's runners carry (`host:<name>`), so its reading
 *  replaces the one its `weekly-report` job uploaded. */
function localHost(): string {
    try {
        const d = parseDeclaration(readFileSync(MACHINE_DECLARATION, "utf8"));
        if (d) return d.host;
    } catch {
        // No runner on this machine: its hostname stands for it.
    }
    return sanitizeHost(hostname());
}

/** The other machines' readings: the newest completed `weekly-report` run's
 *  `weekly-machine-*` artifacts (kept seven days). */
function storedReadings(): MachineReading[] {
    const id = gh([
        "run",
        "list",
        "--workflow",
        WEEKLY_WORKFLOW,
        "--status",
        "completed",
        "--limit",
        "1",
        "--json",
        "databaseId",
        "--jq",
        ".[0].databaseId // empty",
    ]).trim();
    if (id === "") return [];
    const dir = join(cockpitArtifactCache(), `weekly-machines-${id}`);
    const cached = machineReadings(dir);
    if (cached.length > 0) return cached;
    // A failed or partial download is removed, never mistaken for a cache.
    const r = spawnSync(
        "gh",
        ["run", "download", id, "--pattern", "weekly-machine-*", "--dir", dir],
        { stdio: "ignore" }
    );
    if (r.status !== 0) {
        rmSync(dir, { recursive: true, force: true });
        return [];
    }
    return machineReadings(dir);
}

function runners(): RunnerView[] {
    const lines = gh([
        "api",
        "--paginate",
        `repos/${originRepo(primaryCheckout())}/actions/runners`,
        "--jq",
        ".runners[] | {name, status, busy, labels: [.labels[].name]} | @json",
    ]);
    return runnerViews(
        lines
            .split("\n")
            .filter((l) => l.trim() !== "")
            .map((l) => JSON.parse(l) as RunnerRow)
    );
}

/** The newest modification under the page's sources. */
function newestSourceMs(): number {
    let newest = 0;
    const walk = (p: string) => {
        const s = statSync(p);
        if (s.isDirectory()) {
            for (const n of readdirSync(p))
                if (n !== "dist" && n !== "__tests__" && n !== "node_modules")
                    walk(join(p, n));
        } else newest = Math.max(newest, s.mtimeMs);
    };
    for (const p of [
        "dashboard",
        "src/components/ui",
        "src/lib",
        // The two `scripts/lib` modules the page imports at runtime.
        "scripts/lib/cockpit-reading.ts",
        "scripts/lib/landing-causes.ts",
        "vite.dashboard.config.ts",
    ])
        walk(join(ROOT, p));
    return newest;
}

function buildPage(): void {
    let builtAt: number | null;
    try {
        builtAt = statSync(
            join(ROOT, DASHBOARD_OUT_DIR, ".vite", "manifest.json")
        ).mtimeMs;
    } catch {
        builtAt = null;
    }
    if (!buildIsStale(builtAt, newestSourceMs())) return;
    say("building the page");
    const r = spawnSync(
        "bunx",
        [
            "vite",
            "build",
            "--config",
            "vite.dashboard.config.ts",
            "--logLevel",
            "warn",
        ],
        { cwd: ROOT, stdio: "inherit" }
    );
    if (r.status !== 0) {
        say(
            "the page did not build — `bun run telemetry:dash:build` shows why"
        );
        process.exit(1);
    }
}

function openBrowser(url: string): void {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => say(`open ${url} by hand`));
    child.unref();
}

async function main(): Promise<void> {
    const days = Number(argOf("--days") ?? 7);
    if (!Number.isFinite(days) || days <= 0) {
        say("--days is not a positive number");
        process.exit(2);
    }
    // The store and the readers live in the PRIMARY checkout, wherever this
    // runs from — an issue worktree has no telemetry of its own.
    process.env.CLAUDE_PROJECT_DIR ??= primaryCheckout();
    const errors: string[] = [];

    say("ingesting telemetry");
    const ingest = spawnSync("bun", ["scripts/telemetry-ingest.ts"], {
        cwd: ROOT,
        // Explicit, never inherited: Bun hands a child the environment the
        // process started with, without the line above — and an ingest with
        // no `CLAUDE_PROJECT_DIR` writes a store into the worktree.
        env: process.env,
        stdio: ["ignore", "ignore", "inherit"],
    });
    if (ingest.status !== 0)
        errors.push(
            `telemetry:ingest exited ${ingest.status ?? "on a signal"} — the machine reading is from the store as it was`
        );

    const host = localHost();
    say(`reading this machine (${host})`);
    const local = readMachine(host);
    let stored: MachineReading[] = [];
    try {
        stored = storedReadings();
    } catch (e) {
        errors.push(`the other machines' readings: ${firstLine(e)}`);
    }

    const readAt = new Date();
    mkdirSync(cockpitArtifactCache(), { recursive: true });
    say(`reading GitHub over the last ${days} days`);
    let trends: Trends | null = null;
    try {
        trends = weeklyTrends(
            await gatherFacts({
                window: windowEnding(readAt.getTime(), days),
                machines: machinesToReport(local, stored),
                artifactCache: cockpitArtifactCache(),
            })
        );
    } catch (e) {
        errors.push(`GitHub could not be read: ${firstLine(e)}`);
    }
    let runnerList: RunnerView[] | null = null;
    try {
        runnerList = runners();
    } catch (e) {
        errors.push(`the runner list: ${firstLine(e)}`);
    }

    const reading: CockpitReading = {
        version: 1,
        readAt: readAt.toISOString(),
        host,
        trends,
        runners: runnerList,
        errors,
    };
    mkdirSync(cockpitDir(), { recursive: true });
    writeFileSync(cockpitReadingPath(), `${JSON.stringify(reading)}\n`);
    for (const e of errors) say(`unread — ${e}`);

    buildPage();
    const port = resolvePort();
    try {
        startServer(port);
    } catch (e) {
        say(
            `port ${port} is taken (${firstLine(e)}) — an earlier cockpit serves this reading too`
        );
    }
    if (!process.argv.includes("--no-open"))
        openBrowser(`http://127.0.0.1:${port}`);
}

if (import.meta.main) {
    main().catch((e: unknown) => {
        say(firstLine(e));
        process.exit(1);
    });
}
