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
//   3. a process for THIS deployment (`deploymentProcesses()`: a
//      `convex-local-backend` for its `--instance-name`, a `convex dev` in the
//      primary checkout, the pid `convex-dev.pid` records) is alive but not
//      answering → wait for it (bounded); still alive and silent → RECLAIM it
//      (issue #5138): SIGTERM, bounded grace, SIGKILL, confirm it gone and
//      the URL's port free, then fall through to 4. "Never two backends on
//      the same deployment" is kept by killing the wedged one first, never by
//      handing it to a human. An unknown instance fails closed: no kill;
//   4. otherwise start `bunx convex dev --local` from the PRIMARY checkout,
//      detached in its own process group, stdin /dev/null, output to
//      `.claude/telemetry/convex-dev.log`, pid + start stamp to
//      `.claude/telemetry/convex-dev.pid`; poll until the URL answers
//      (bounded) or fail with the log tail;
//   5. report — never kill — Convex processes that belong to another
//      checkout or deployment, and a backend for this one serving with no
//      `convex dev` parent (it answers, so there is nothing to reclaim).
//
// Exit: 0 = the URL answers (already, after a wait, or after a start);
// 1 = it does not and this run could not safely make it; 2 = usage.
//
// The flags exist for the tests (a stub HTTP server on a free port, a stub
// start command, a scratch telemetry dir), never the real deployment:
//   --url <u> --instance-name <n> --root <dir> --telemetry-dir <dir>
//   --start-cmd <json argv> --start-timeout-ms <n> --wait-alive-ms <n>
//   --reclaim-grace-ms <n>
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
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
    /** SIGTERM → SIGKILL grace, and SIGKILL → gone, when reclaiming. */
    reclaimGraceMs: number;
    probeTimeoutMs: number;
    pollMs: number;
    log: (line: string) => void;
}

export type EnsureOutcome =
    | { kind: "up" }
    | { kind: "waited"; pid: number }
    | { kind: "started"; pid: number }
    | { kind: "reclaimed"; killed: number[]; pid: number }
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

/** The binary itself, never a `sh -c` wrapper or a `grep` naming it. */
export function isBackend(args: string): boolean {
    const first = args.trim().split(/\s+/)[0] ?? "";
    return path.basename(first) === "convex-local-backend";
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

/** `lsof` prints the resolved path (`/private/var/…` for `/var/…` on macOS). */
function samePath(a: string, b: string): boolean {
    const real = (p: string): string => {
        try {
            return fs.realpathSync(p);
        } catch {
            return path.resolve(p);
        }
    };
    return real(a) === real(b);
}

/** One `ps -o <field>=` column for `pid`; empty when the process is gone. */
function psField(pid: number, field: string): string {
    const r = spawnSync("ps", ["-o", `${field}=`, "-p", String(pid)], {
        encoding: "utf8",
        timeout: 5_000,
    });
    return (r.stdout ?? "").trim();
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

/** A lock created by O_EXCL but never written — its owner was killed
 *  between the create and the write — is stale once it is this old. Younger,
 *  it is a writer mid-write. */
const UNWRITTEN_LOCK_GRACE_MS = 10_000;

/** What a lock file IS: its inode and its bytes. A lock broken and re-taken
 *  by another caller has a new inode even when the bytes match. */
export interface LockSighting {
    ino: number;
    raw: string;
    mtimeMs: number;
}

export function sight(file: string): LockSighting | null {
    try {
        const st = fs.statSync(file);
        return {
            ino: st.ino,
            raw: fs.readFileSync(file, "utf8"),
            mtimeMs: st.mtimeMs,
        };
    } catch {
        return null;
    }
}

function parseOwner(raw: string): LockOwner | null {
    try {
        const o = JSON.parse(raw) as LockOwner;
        return typeof o.pid === "number" ? o : null;
    } catch {
        return null;
    }
}

function readOwner(file: string): LockOwner | null {
    const s = sight(file);
    return s ? parseOwner(s.raw) : null;
}

/** A lock whose owner is gone — dead pid, or a live pid with another start
 *  stamp (recycled) — is stale and may be broken; so is one never written
 *  past the grace. */
function isStale(s: LockSighting): boolean {
    const owner = parseOwner(s.raw);
    if (owner === null) {
        return Date.now() - s.mtimeMs > UNWRITTEN_LOCK_GRACE_MS;
    }
    if (!alive(owner.pid)) return true;
    return owner.stamp !== "" && startStamp(owner.pid) !== owner.stamp;
}

/** Break the stale lock `judged` without ever deleting a live one. Two
 *  waiters can judge the SAME stale lock: the first breaks it and takes a
 *  fresh one, and a plain `rm` by the second would delete that live lock and
 *  let both start a backend. `rename` is atomic, so exactly one breaker moves
 *  the file aside; a breaker that finds it moved something other than what it
 *  judged (another inode, other bytes) puts it back — `link` refuses if a
 *  third caller has already re-taken the name. */
export function breakStale(file: string, judged: LockSighting): void {
    const aside = `${file}.${process.pid}.stale`;
    try {
        fs.renameSync(file, aside);
    } catch {
        return; // another breaker got there first
    }
    const moved = sight(aside);
    if (moved && (moved.ino !== judged.ino || moved.raw !== judged.raw)) {
        try {
            fs.linkSync(aside, file);
        } catch {
            /* the name is taken again: that lock rules */
        }
    }
    fs.rmSync(aside, { force: true });
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
        const seen = sight(file);
        if (seen && isStale(seen)) {
            breakStale(file, seen);
            continue;
        }
        if (Date.now() >= deadline) {
            const owner = seen ? parseOwner(seen.raw) : null;
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
        if (cwd !== null && samePath(cwd, o.root)) continue;
        o.log(
            `convex:ensure: note — pid ${r.pid} (${backend ? `backend ${instance ?? "?"}` : "convex dev"}, cwd ${cwd ?? "?"}) is not this checkout's deployment; reported, not killed`
        );
    }
}

/** Every live process that may already be bringing THIS deployment up — the
 *  ones a start would duplicate: a `convex-local-backend` for its instance
 *  (ANY backend when the instance is unknown: fail closed), a `convex dev` in
 *  the primary checkout (one still starting, or restarting its backend,
 *  before any backend shows), and the process `convex-dev.pid` records (a
 *  start this script made whose earlier wait ran out). */
export function deploymentProcesses(
    rows: ProcessRow[],
    o: Pick<EnsureOptions, "root" | "instanceName">,
    recorded: LockOwner | null,
    cwdOf: (pid: number) => string | null = processCwd
): ProcessRow[] {
    return rows.filter((r) => {
        if (isBackend(r.args)) {
            return (
                o.instanceName === null || instanceOf(r.args) === o.instanceName
            );
        }
        if (recorded && r.pid === recorded.pid) {
            return (
                recorded.stamp === "" || startStamp(r.pid) === recorded.stamp
            );
        }
        if (isConvexDev(r.args)) {
            const cwd = cwdOf(r.pid);
            return cwd !== null && samePath(cwd, o.root);
        }
        return false;
    });
}

function describeProcess(
    r: ProcessRow,
    o: Pick<EnsureOptions, "instanceName">
): string {
    if (isBackend(r.args)) {
        return `backend pid ${r.pid} for ${instanceOf(r.args) ?? o.instanceName ?? "an unknown instance"}`;
    }
    if (isConvexDev(r.args)) return `convex dev pid ${r.pid}`;
    return `pid ${r.pid} (${r.args.slice(0, 80)})`;
}

// ── reclaim (issue #5138) ───────────────────────────────────────────────────

/** `pid` and every process below it in `rows`. */
export function withDescendants(rows: ProcessRow[], pid: number): number[] {
    const out = [pid];
    for (let i = 0; i < out.length; i++) {
        for (const r of rows) {
            if (r.ppid === out[i] && !out.includes(r.pid)) out.push(r.pid);
        }
    }
    return out;
}

/** Why a still-silent deployment process is reclaimed: a `convex dev` whose
 *  tree holds no live backend for the instance is a CLI wrapper whose
 *  backend died (it retries forever, it never restarts it). */
export function reclaimReason(
    rows: ProcessRow[],
    r: ProcessRow,
    instanceName: string,
    waitedMs: number
): string {
    if (isConvexDev(r.args)) {
        const backendChild = withDescendants(rows, r.pid).some((pid) => {
            const row = rows.find((x) => x.pid === pid);
            return (
                row !== undefined &&
                isBackend(row.args) &&
                instanceOf(row.args) === instanceName
            );
        });
        if (!backendChild) return "no backend child";
    }
    return `never answered in ${Math.round(waitedMs / 1000)} s`;
}

/** Gone: dead, a zombie awaiting its reaper, or the pid recycled (another
 *  start stamp). */
function gone(pid: number, stamp: string): boolean {
    if (!alive(pid)) return true;
    if (psField(pid, "stat").startsWith("Z")) return true;
    const now = startStamp(pid);
    return now === "" || (stamp !== "" && now !== stamp);
}

function signal(target: number, sig: NodeJS.Signals): void {
    try {
        process.kill(target, sig);
    } catch {
        /* already gone */
    }
}

/** Something accepts TCP connections on the URL's port — the probe's HTTP
 *  failing does not mean the port is free. */
export function portHeld(url: string, timeoutMs: number): Promise<boolean> {
    const u = new URL(url);
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    return new Promise((resolve) => {
        const sock = net.connect({ host: u.hostname, port });
        const done = (held: boolean): void => {
            sock.destroy();
            resolve(held);
        };
        sock.setTimeout(timeoutMs, () => done(false));
        sock.once("connect", () => done(true));
        sock.once("error", () => done(false));
    });
}

/** Kill the deployment processes `ours` still alive after the wait, and
 *  their trees: SIGTERM (the process group too when the process leads its
 *  own, as a detached start does — never this script's group), the grace,
 *  SIGKILL the survivors, the grace again. Returns the killed pids, or why
 *  the deployment is still not safe to start. */
async function reclaim(
    o: EnsureOptions,
    ours: ProcessRow[],
    instanceName: string,
    recorded: LockOwner | null
): Promise<number[] | string> {
    // `ours` is a snapshot from before the wait: re-attribute on fresh rows,
    // so a pid that died and was recycled meanwhile is never a root.
    const rows = listProcesses();
    const before = new Set(ours.map((r) => r.pid));
    const roots = deploymentProcesses(rows, o, recorded).filter((r) =>
        before.has(r.pid)
    );
    // A recorded pid with no stamp has no identity: unless its command line
    // is Convex's own, it may be anything that reused the pid.
    const unproven = roots.find(
        (r) =>
            recorded?.pid === r.pid &&
            recorded.stamp === "" &&
            !isBackend(r.args) &&
            !isConvexDev(r.args)
    );
    if (unproven) {
        return `${describeProcess(unproven, o)} is the pid convex-dev.pid records, but with no start stamp its identity is unproven — not reclaimed, not starting a second backend`;
    }
    // Never this script's own chain (`bun run`, `sh`, the loop): a root
    // above it is refused, an ancestor below a root is skipped.
    const ancestors = new Set<number>([process.pid]);
    for (
        let r = rows.find((x) => x.pid === process.pid);
        r && r.ppid > 1 && !ancestors.has(r.ppid);
        r = rows.find((x) => x.pid === r!.ppid)
    ) {
        ancestors.add(r.ppid);
    }
    const above = roots.find((r) => ancestors.has(r.pid));
    if (above) {
        return `${describeProcess(above, o)} is an ancestor of this convex:ensure — not reclaimed, not starting a second backend`;
    }
    const ownGroup = psField(process.pid, "pgid");
    const victims = new Map<number, { stamp: string; group: number | null }>();
    for (const r of roots) {
        const pgid = psField(r.pid, "pgid");
        o.log(
            `convex:ensure: reclaiming ${describeProcess(r, o)} (etime ${psField(r.pid, "etime") || "?"}) — ${reclaimReason(rows, r, instanceName, o.waitAliveMs)}`
        );
        for (const pid of withDescendants(rows, r.pid)) {
            if (ancestors.has(pid) || victims.has(pid)) continue;
            victims.set(pid, {
                stamp: startStamp(pid),
                group:
                    pid === r.pid && pgid === String(r.pid) && pgid !== ownGroup
                        ? r.pid
                        : null,
            });
        }
    }
    const survivors = (): number[] =>
        [...victims].filter(([pid, v]) => !gone(pid, v.stamp)).map(([p]) => p);
    const send = (sig: NodeJS.Signals): void => {
        for (const pid of survivors()) {
            const { group } = victims.get(pid)!;
            if (group !== null) signal(-group, sig);
            signal(pid, sig);
        }
    };
    const settle = async (): Promise<void> => {
        const deadline = Date.now() + o.reclaimGraceMs;
        while (survivors().length > 0 && Date.now() < deadline) {
            await sleep(Math.min(o.pollMs, 200));
        }
    };
    send("SIGTERM");
    await settle();
    send("SIGKILL");
    await settle();
    const left = survivors();
    if (left.length > 0) {
        return `could not kill pid ${left.join(", ")} after SIGKILL — not starting a second backend on the same deployment`;
    }
    if (await portHeld(o.url, o.probeTimeoutMs)) {
        return `reclaimed pid ${roots.map((r) => r.pid).join(", ")} but something still listens on ${o.url}'s port without answering it — a foreign listener; not starting a second backend`;
    }
    return roots.map((r) => r.pid);
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

        const logFile = path.join(o.telemetryDir, "convex-dev.log");
        const pidFile = path.join(o.telemetryDir, "convex-dev.pid");
        const rows = listProcesses();
        reportStrays(rows, o);
        const ours = deploymentProcesses(rows, o, readOwner(pidFile));
        let killed: number[] = [];
        if (ours.length > 0) {
            const what = describeProcess(ours[0], o);
            const anyAlive = () => ours.some((r) => alive(r.pid));
            o.log(
                `convex:ensure: ${what} is alive but not answering ${o.url} — waiting up to ${Math.round(o.waitAliveMs / 1000)} s, never starting a second`
            );
            if (await pollUntil(o, o.waitAliveMs, anyAlive)) {
                return { kind: "waited", pid: ours[0].pid };
            }
            if (!anyAlive()) {
                return {
                    kind: "failed",
                    reason: `${what} exited without answering ${o.url} — re-run convex:ensure`,
                };
            }
            if (o.instanceName === null) {
                return {
                    kind: "failed",
                    reason: `${what} is alive but never answered ${o.url}, and the local instance is unknown (CONVEX_DEPLOYMENT is not local:<name>) — it may be another deployment's backend, so it is not reclaimed and no second is started`,
                };
            }
            const reclaimed = await reclaim(
                o,
                ours,
                o.instanceName,
                readOwner(pidFile)
            );
            if (typeof reclaimed === "string") {
                return { kind: "failed", reason: reclaimed };
            }
            killed = reclaimed;
        }

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
            return killed.length > 0
                ? { kind: "reclaimed", killed, pid }
                : { kind: "started", pid };
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
        "reclaim-grace-ms",
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
        // `--instance-name ""` = unknown: every live backend then counts.
        instanceName: flags.has("instance-name")
            ? flags.get("instance-name") || null
            : localInstanceName(env.CONVEX_DEPLOYMENT),
        root,
        telemetryDir: path.resolve(
            flags.get("telemetry-dir") ??
                path.join(root, ".claude", "telemetry")
        ),
        startCommand,
        startTimeoutMs: num("start-timeout-ms", 120_000),
        waitAliveMs: num("wait-alive-ms", 60_000),
        reclaimGraceMs: num("reclaim-grace-ms", 10_000),
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
        case "reclaimed":
            console.log(
                `convex:ensure: ${opts.url} answers — reclaimed pid ${outcome.killed.join(", ")}, started pid ${outcome.pid}`
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
