#!/usr/bin/env bun
// `bun run convex:ensure` — start the local Convex backend when none answers,
// never a second one (issue #4945).
//
// The AFK loop needs the deployment `VITE_CONVEX_URL` names for `check:ui`,
// for the health gate's `check:ui --all` walk and for preset seeding, and
// nothing in the loop ever started it: a laptop sleep or a session that
// killed its own `convex dev` stopped every run until a human typed
// `bunx convex dev`. `check:ui` deliberately never starts a backend ("a second
// backend on the same deployment is worse than a clear failure") and that
// rule stays. The loop owns the machine while AFK, so it — and only it, via
// this script — may start one:
//
//   1. probe the URL; it answers → exit 0, nothing spawned;
//   2. take `.claude/telemetry/convex-ensure.lock` (O_EXCL, stale owner by
//      pid + start stamp) so two callers never both start one; re-probe;
//   3. a `convex-local-backend` for this `--instance-name` is alive but not
//      answering → wait for it (bounded); never answers → fail, never start a
//      second;
//   4. otherwise start `bunx convex dev --local` from the PRIMARY checkout,
//      detached in its own process group, stdin /dev/null, output to
//      `.claude/telemetry/convex-dev.log`, pid + start stamp to
//      `.claude/telemetry/convex-dev.pid`; poll until the URL answers
//      (bounded) or fail with the log tail;
//   5. report — never kill — Convex processes that belong to another
//      checkout or deployment, and a backend for this one serving with no
//      `convex dev` parent (restarting it is out of scope).
//
// Exit: 0 = the URL answers (already, after a wait, or after a start);
// 1 = it does not and this run could not safely make it; 2 = usage.
//
// The flags exist for the tests (a stub HTTP server on a free port, a stub
// start command, a scratch telemetry dir), never the real deployment:
//   --url <u> --instance-name <n> --root <dir> --telemetry-dir <dir>
//   --start-cmd <json argv> --start-timeout-ms <n> --wait-alive-ms <n>
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { primaryCheckout } from "./lib/primary-checkout.ts";
import {
    localInstanceName,
    reachable,
    readEnvLocal,
} from "./lib/convex-reachable.ts";

export interface EnsureOptions {
    url: string;
    /** `null` = no local instance to look for (cloud deployment). */
    instanceName: string | null;
    /** The primary checkout: where `convex dev` runs. */
    root: string;
    telemetryDir: string;
    startCommand: string[];
    startTimeoutMs: number;
    waitAliveMs: number;
    probeTimeoutMs: number;
    pollMs: number;
    log: (line: string) => void;
}

export type EnsureOutcome =
    | { kind: "up" }
    | { kind: "waited"; pid: number }
    | { kind: "started"; pid: number }
    | { kind: "failed"; reason: string };

export interface ProcessRow {
    pid: number;
    ppid: number;
    args: string;
}

const LOG_TAIL_LINES = 20;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export function listProcesses(): ProcessRow[] {
    const r = spawnSync("ps", ["-axo", "pid=,ppid=,args="], {
        encoding: "utf8",
        timeout: 10_000,
    });
    const rows: ProcessRow[] = [];
    for (const line of (r.stdout ?? "").split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m) rows.push({ pid: +m[1], ppid: +m[2], args: m[3] });
    }
    return rows;
}

/** The token after `--instance-name`, or null. */
export function instanceOf(args: string): string | null {
    const m = /(?:^|\s)--instance-name[ =](\S+)/.exec(args);
    return m ? m[1] : null;
}

export function isBackend(args: string): boolean {
    return /(?:^|[\s/])convex-local-backend(?:\s|$)/.test(args);
}

/** `convex dev` as the CLI runs it: `node …/convex/bin/main.js dev …` or
 *  `bunx convex dev …`. */
export function isConvexDev(args: string): boolean {
    return /\bconvex(?:\/bin\/main\.js)?\s+dev(?:\s|$)/.test(args);
}

/** `ps lstart` — with the pid, the identity of a process: a recycled pid has
 *  a different start stamp. Empty when the process is gone. */
export function startStamp(pid: number): string {
    const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 5_000,
    });
    return (r.stdout ?? "").trim();
}

function processCwd(pid: number): string | null {
    const r = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
        encoding: "utf8",
        timeout: 5_000,
    });
    const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
}

// ── lock ────────────────────────────────────────────────────────────────────

interface LockOwner {
    pid: number;
    stamp: string;
}

function readOwner(file: string): LockOwner | null {
    try {
        const o = JSON.parse(fs.readFileSync(file, "utf8")) as LockOwner;
        return typeof o.pid === "number" ? o : null;
    } catch {
        return null;
    }
}

/** A lock whose owner is gone — dead pid, or a live pid with another start
 *  stamp (recycled) — is stale and may be broken. An unreadable lock is a
 *  writer mid-`writeFileSync`: not stale. */
function ownerIsStale(owner: LockOwner): boolean {
    if (!alive(owner.pid)) return true;
    return owner.stamp !== "" && startStamp(owner.pid) !== owner.stamp;
}

async function acquireLock(
    file: string,
    deadline: number,
    pollMs: number
): Promise<(() => void) | string> {
    const me: LockOwner = { pid: process.pid, stamp: startStamp(process.pid) };
    for (;;) {
        try {
            const fd = fs.openSync(file, "wx");
            fs.writeSync(fd, JSON.stringify(me));
            fs.closeSync(fd);
            return () => {
                const o = readOwner(file);
                if (o && o.pid === me.pid) fs.rmSync(file, { force: true });
            };
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        const owner = readOwner(file);
        if (owner && ownerIsStale(owner)) {
            fs.rmSync(file, { force: true });
            continue;
        }
        if (Date.now() >= deadline) {
            return `the lock ${file} is held by pid ${owner?.pid ?? "?"} past the wait`;
        }
        await sleep(pollMs);
    }
}

// ── the ensure ──────────────────────────────────────────────────────────────

function logTail(file: string): string {
    try {
        const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
        return lines.slice(-LOG_TAIL_LINES).join("\n");
    } catch {
        return "(no log)";
    }
}

async function pollUntil(
    o: EnsureOptions,
    timeoutMs: number,
    stillWorth: () => boolean
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await reachable(o.url, o.probeTimeoutMs)) return true;
        if (!stillWorth()) return false;
        await sleep(o.pollMs);
    }
    return reachable(o.url, o.probeTimeoutMs);
}

/** Step 5: report, never kill. */
export function reportStrays(
    rows: ProcessRow[],
    o: Pick<EnsureOptions, "root" | "instanceName" | "log">,
    cwdOf: (pid: number) => string | null = processCwd
): void {
    const pids = new Set(rows.map((r) => r.pid));
    for (const r of rows) {
        const backend = isBackend(r.args);
        if (!backend && !isConvexDev(r.args)) continue;
        const instance = backend ? instanceOf(r.args) : null;
        const ours = o.instanceName !== null && instance === o.instanceName;
        if (ours) {
            const parent = rows.find((p) => p.pid === r.ppid);
            if (!pids.has(r.ppid) || !parent || !isConvexDev(parent.args)) {
                o.log(
                    `convex:ensure: note — backend pid ${r.pid} for ${instance} has no \`convex dev\` parent (ppid ${r.ppid}); left serving, functions will not hot-push`
                );
            }
            continue;
        }
        const cwd = cwdOf(r.pid);
        if (cwd !== null && path.resolve(cwd) === path.resolve(o.root))
            continue;
        o.log(
            `convex:ensure: note — pid ${r.pid} (${backend ? `backend ${instance ?? "?"}` : "convex dev"}, cwd ${cwd ?? "?"}) is not this checkout's deployment; reported, not killed`
        );
    }
}

export async function ensureConvex(o: EnsureOptions): Promise<EnsureOutcome> {
    if (await reachable(o.url, o.probeTimeoutMs)) return { kind: "up" };

    fs.mkdirSync(o.telemetryDir, { recursive: true });
    const lockFile = path.join(o.telemetryDir, "convex-ensure.lock");
    const lockDeadline = Date.now() + o.startTimeoutMs + o.waitAliveMs + 30_000;
    const release = await acquireLock(lockFile, lockDeadline, o.pollMs);
    if (typeof release === "string") return { kind: "failed", reason: release };
    try {
        // Another caller may have started it while this one queued.
        if (await reachable(o.url, o.probeTimeoutMs)) return { kind: "up" };

        const rows = listProcesses();
        reportStrays(rows, o);
        const ours =
            o.instanceName === null
                ? []
                : rows.filter(
                      (r) =>
                          isBackend(r.args) &&
                          instanceOf(r.args) === o.instanceName
                  );
        if (ours.length > 0) {
            const pid = ours[0].pid;
            o.log(
                `convex:ensure: backend pid ${pid} for ${o.instanceName} is alive but not answering ${o.url} — waiting up to ${Math.round(o.waitAliveMs / 1000)} s, never starting a second`
            );
            if (await pollUntil(o, o.waitAliveMs, () => alive(pid))) {
                return { kind: "waited", pid };
            }
            return {
                kind: "failed",
                reason: alive(pid)
                    ? `backend pid ${pid} for ${o.instanceName} is alive but never answered ${o.url} — not starting a second backend on the same deployment; kill it by hand if it is wedged`
                    : `backend pid ${pid} for ${o.instanceName} exited without answering ${o.url} — re-run convex:ensure`,
            };
        }

        const logFile = path.join(o.telemetryDir, "convex-dev.log");
        const pidFile = path.join(o.telemetryDir, "convex-dev.pid");
        const out = fs.openSync(logFile, "a");
        fs.writeSync(
            out,
            `\n── convex:ensure ${new Date().toISOString()}: ${o.startCommand.join(" ")} (cwd ${o.root})\n`
        );
        const child = spawn(o.startCommand[0], o.startCommand.slice(1), {
            cwd: o.root,
            detached: true,
            stdio: ["ignore", out, out],
        });
        fs.closeSync(out);
        const spawnError = await new Promise<Error | null>((resolve) => {
            child.once("spawn", () => resolve(null));
            child.once("error", (e) => resolve(e));
        });
        if (spawnError || child.pid === undefined) {
            return {
                kind: "failed",
                reason: `could not start ${o.startCommand.join(" ")}: ${spawnError?.message ?? "no pid"}`,
            };
        }
        const pid = child.pid;
        child.unref();
        fs.writeFileSync(
            pidFile,
            JSON.stringify({
                pid,
                stamp: startStamp(pid),
                startedAt: new Date().toISOString(),
                command: o.startCommand,
            }) + "\n"
        );
        o.log(
            `convex:ensure: started ${o.startCommand.join(" ")} (pid ${pid}, cwd ${o.root}, log ${logFile}) — waiting up to ${Math.round(o.startTimeoutMs / 1000)} s for ${o.url}`
        );
        if (await pollUntil(o, o.startTimeoutMs, () => alive(pid))) {
            return { kind: "started", pid };
        }
        return {
            kind: "failed",
            reason:
                `${o.startCommand.join(" ")} (pid ${pid}${alive(pid) ? ", still running" : ", exited"}) never made ${o.url} answer. Log tail (${logFile}):\n` +
                logTail(logFile),
        };
    } finally {
        release();
    }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): EnsureOptions | string {
    const flags = new Map<string, string>();
    for (let i = 0; i < argv.length; i += 2) {
        const k = argv[i];
        if (!k.startsWith("--") || i + 1 >= argv.length) {
            return `unexpected argument: ${k}`;
        }
        flags.set(k.slice(2), argv[i + 1]);
    }
    const known = new Set([
        "url",
        "instance-name",
        "root",
        "telemetry-dir",
        "start-cmd",
        "start-timeout-ms",
        "wait-alive-ms",
    ]);
    for (const k of flags.keys()) {
        if (!known.has(k)) return `unknown flag: --${k}`;
    }
    const root = path.resolve(flags.get("root") ?? primaryCheckout());
    const env = { ...readEnvLocal(root), ...process.env } as Record<
        string,
        string | undefined
    >;
    const url = flags.get("url") ?? env.VITE_CONVEX_URL;
    if (!url) return `VITE_CONVEX_URL is unset (${root}/.env.local)`;
    let startCommand = ["bunx", "convex", "dev", "--local"];
    if (flags.has("start-cmd")) {
        const parsed: unknown = JSON.parse(flags.get("start-cmd")!);
        if (
            !Array.isArray(parsed) ||
            parsed.length === 0 ||
            !parsed.every((s) => typeof s === "string")
        ) {
            return "--start-cmd must be a non-empty JSON array of strings";
        }
        startCommand = parsed as string[];
    }
    const num = (k: string, d: number): number => {
        const v = flags.get(k);
        return v === undefined ? d : Number(v);
    };
    return {
        url,
        instanceName: flags.has("instance-name")
            ? flags.get("instance-name")!
            : localInstanceName(env.CONVEX_DEPLOYMENT),
        root,
        telemetryDir: path.resolve(
            flags.get("telemetry-dir") ??
                path.join(root, ".claude", "telemetry")
        ),
        startCommand,
        startTimeoutMs: num("start-timeout-ms", 120_000),
        waitAliveMs: num("wait-alive-ms", 60_000),
        probeTimeoutMs: 3_000,
        pollMs: 500,
        log: (line) => process.stderr.write(`${line}\n`),
    };
}

async function main(): Promise<number> {
    const opts = parseArgs(process.argv.slice(2));
    if (typeof opts === "string") {
        process.stderr.write(`convex:ensure: ${opts}\n`);
        return 2;
    }
    const outcome = await ensureConvex(opts);
    switch (outcome.kind) {
        case "up":
            console.log(`convex:ensure: ${opts.url} answers — nothing started`);
            return 0;
        case "waited":
            console.log(
                `convex:ensure: ${opts.url} answers (backend pid ${outcome.pid}, waited) — nothing started`
            );
            return 0;
        case "started":
            console.log(
                `convex:ensure: ${opts.url} answers — started pid ${outcome.pid}`
            );
            return 0;
        case "failed":
            process.stderr.write(`convex:ensure: FAILED — ${outcome.reason}\n`);
            return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
