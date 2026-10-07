import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dayHour } from "../lib/telemetry-db";

/**
 * `telemetry:ingest --quick` and `workflow:kpi` end to end (issue #4968),
 * against a scratch project and a scratch gate-run cache. `bun:sqlite` is a
 * Bun builtin, so both run as `bun` subprocesses and the DB is read back the
 * same way. Every spawn carries a `timeout`: a blocked `spawnSync` hangs the
 * worker rather than failing the test.
 */

const INGEST = resolve(__dirname, "../telemetry-ingest.ts");
const KPI = resolve(__dirname, "../workflow-kpi.ts");
const SPAWN_TIMEOUT_MS = 60_000;

let root: string;
let proj: string;
let tel: string;
let runs: string;

function run(script: string, args: string[]) {
    return spawnSync("bun", [script, ...args], {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: proj,
            XDG_CACHE_HOME: join(root, "cache"),
        },
    });
}

function query<T>(sql: string): T[] {
    const r = spawnSync(
        "bun",
        [
            "-e",
            `import { Database } from "bun:sqlite";
             const db = new Database(${JSON.stringify(join(tel, "telemetry.db"))});
             console.log(JSON.stringify(db.query(${JSON.stringify(sql)}).all()));`,
        ],
        { encoding: "utf8", timeout: SPAWN_TIMEOUT_MS }
    );
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout) as T[];
}

/** One tool call: its pre and post events, as `timing-log.sh` writes them. */
function span(id: string, ts: number): string {
    return (
        JSON.stringify({
            id,
            phase: "pre",
            ts,
            session: "s1",
            tool: "Bash",
            cmd: "git status",
        }) +
        "\n" +
        JSON.stringify({ id, phase: "post", ts: ts + 1 }) +
        "\n"
    );
}

function gateRun(
    name: string,
    started: number,
    opts: { command: string; log: string; green: boolean }
) {
    const dir = join(runs, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "command"), `${opts.command}\n`);
    writeFileSync(join(dir, "started"), `${started}\n`);
    writeFileSync(join(dir, "log"), opts.log);
    const green = join(dir, "green");
    if (opts.green) writeFileSync(green, "");
    else rmSync(green, { force: true });
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "telemetry-quick-"));
    proj = join(root, "proj");
    tel = join(proj, ".claude/telemetry");
    runs = join(root, "cache/tolaria/gate-runs");
    mkdirSync(join(tel, "health"), { recursive: true });
    mkdirSync(runs, { recursive: true });
});

afterEach(() => {
    rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

describe("telemetry:ingest --quick (issue #4968)", () => {
    it("keeps every land ATTEMPT, though gate-run.sh reuses one dir per key", () => {
        const now = Math.floor(Date.now() / 1000);
        // First attempt of `land 10`: the rebase stopped.
        gateRun("land-10", now - 600, {
            command: "land 10",
            log: 'Could not apply abc123... # x\nerror: script "land" exited with code 1\n',
            green: false,
        });
        expect(run(INGEST, ["--quick"]).status).toBe(0);
        // The retry under the SAME key rewrites the same dir — and lands.
        gateRun("land-10", now - 60, {
            command: "land 10",
            log: "lane: ran\npr-merge: PR #10 merged (attempt 1)\n",
            green: true,
        });
        expect(run(INGEST, ["--quick"]).status).toBe(0);

        const rows = query<{ started: number; green: number; bucket: string }>(
            "SELECT started, green, bucket FROM gate_attempts ORDER BY started"
        );
        expect(rows).toEqual([
            { started: now - 600, green: 0, bucket: "rebase" },
            { started: now - 60, green: 1, bucket: null },
        ]);
        // gate_runs still holds the dir's latest state only.
        expect(
            query<{ n: number }>("SELECT count(*) AS n FROM gate_runs")[0].n
        ).toBe(1);
    });

    it("reads the attempts gate-run.sh archived before reusing a dir, even beside a live retry", () => {
        const now = Math.floor(Date.now() / 1000);
        gateRun("land-11", now - 60, {
            command: "land 11",
            log: "lane: ran\n",
            green: false,
        });
        // The retry is still running: its own record must wait…
        writeFileSync(join(runs, "land-11/pid"), String(process.pid));
        const ident = spawnSync(
            "ps",
            ["-o", "lstart=,command=", "-p", String(process.pid)],
            { encoding: "utf8", timeout: SPAWN_TIMEOUT_MS }
        )
            .stdout.split("\n")[0]
            .replace(/ +/g, " ")
            .trim();
        writeFileSync(join(runs, "land-11/pidstart"), ident);
        // …but the archived attempt is immutable and is read now.
        const a = join(runs, "land-11/attempts", String(now - 900));
        mkdirSync(a, { recursive: true });
        writeFileSync(join(a, "command"), "land 11\n");
        writeFileSync(join(a, "started"), `${now - 900}\n`);
        writeFileSync(
            join(a, "log"),
            'lane: ran\n  ✗ tsc  9.0s\nerror: script "check:lane" exited with code 1\n'
        );
        expect(run(INGEST, ["--quick"]).status).toBe(0);
        expect(run(INGEST, ["--quick"]).status).toBe(0); // no duplicate
        expect(
            query<{ started: number; green: number; bucket: string }>(
                "SELECT started, green, bucket FROM gate_attempts"
            )
        ).toEqual([{ started: now - 900, green: 0, bucket: "static" }]);
    });

    it("ingests gate-lock.jsonl and detach.log incrementally, and spans to today", () => {
        const now = Math.floor(Date.now() / 1000);
        writeFileSync(
            join(tel, "gate-lock.jsonl"),
            JSON.stringify({
                ts: now,
                tier: "heavy",
                event: "acquired",
                cmd: "x",
                cwd: "/r",
                waited_ms: 42000,
            }) +
                "\n" +
                JSON.stringify({
                    ts: now,
                    tier: "heavy",
                    event: "run",
                    exit: 0,
                    duration_ms: 5,
                    load_start: 6.5,
                    pressure_start: 1,
                }) +
                "\n"
        );
        writeFileSync(
            join(tel, "health/detach.log"),
            [
                "health-cadence: firing on age — 2h since the first un-healthed landing; gating aa785cf0",
                "health-main: [1/5] worktree:init — start",
                "health-main: [1/5] worktree:init — exit 0 after 2s",
                "health-main: GREEN @ aa785cf0",
                "",
            ].join("\n")
        );
        writeFileSync(join(tel, "tool-events.jsonl"), span("a", now));

        expect(run(INGEST, ["--quick"]).status).toBe(0);
        expect(run(INGEST, ["--quick"]).status).toBe(0); // no duplicates

        expect(
            query<{ waited_ms: number | null; load_start: number | null }>(
                "SELECT waited_ms, load_start FROM gate_lock ORDER BY id"
            )
        ).toEqual([
            { waited_ms: 42000, load_start: null },
            { waited_ms: null, load_start: 6.5 },
        ]);
        expect(
            query<{ kind: string; step: string; secs: number | null }>(
                "SELECT kind, step, secs FROM health_detach ORDER BY id"
            )
        ).toEqual([
            { kind: "fire", step: "age", secs: null },
            { kind: "step", step: "worktree:init", secs: 2 },
            { kind: "verdict", step: "GREEN", secs: null },
        ]);
        // The acceptance query: after an ingest, the newest span is today's.
        expect(
            query<{ d: string }>("SELECT max(day) AS d FROM spans")[0].d
        ).toBe(dayHour(now).day);
        expect(
            query<{ n: number }>("SELECT count(*) AS n FROM spans")[0].n
        ).toBe(1);
    });

    it("drains a backlog in slices without losing a line at a slice boundary", () => {
        const now = Math.floor(Date.now() / 1000);
        let body = "";
        for (let i = 0; i < 40; i++) body += span(`c${i}`, now + i);
        writeFileSync(join(tel, "tool-events.jsonl"), body);
        // ~150-byte events in 200-byte slices: nearly every slice ends mid-line.
        expect(run(INGEST, ["--quick", "--chunk-bytes=200"]).status).toBe(0);
        expect(
            query<{ n: number }>("SELECT count(*) AS n FROM spans")[0].n
        ).toBe(40);
    });

    it("rotates tool-events.jsonl once fully read, and keeps reading the new file", () => {
        const now = Math.floor(Date.now() / 1000);
        const events = join(tel, "tool-events.jsonl");
        let body = "";
        for (let i = 0; i < 50; i++) body += span(`e${i}`, now + i);
        writeFileSync(events, body);

        const r = run(INGEST, ["--quick", "--rotate-bytes=1024"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("tool-events.jsonl rotated");
        expect(existsSync(events)).toBe(false);
        expect(existsSync(`${events}.rotating`)).toBe(false);

        // The hook's next `>>` creates a fresh file, read from offset 0.
        writeFileSync(events, span("after", now + 100));
        expect(run(INGEST, ["--quick", "--rotate-bytes=1024"]).status).toBe(0);
        expect(
            query<{ n: number }>("SELECT count(*) AS n FROM spans")[0].n
        ).toBe(51);
        expect(statSync(events).size).toBeLessThan(1024);
    });

    it("finishes a rotation a dead run left half-done, without losing its tail", () => {
        const now = Math.floor(Date.now() / 1000);
        const events = join(tel, "tool-events.jsonl");
        writeFileSync(events, span("x1", now));
        expect(run(INGEST, ["--quick"]).status).toBe(0);
        // Died after the rename: one more event had landed in the old file,
        // and the hook has already started a new one.
        writeFileSync(
            `${events}.rotating`,
            span("x1", now) + span("x2", now + 1)
        );
        rmSync(events);
        writeFileSync(events, span("x3", now + 2));

        expect(run(INGEST, ["--quick"]).status).toBe(0);
        expect(existsSync(`${events}.rotating`)).toBe(false);
        expect(
            query<{ id: string }>("SELECT id FROM spans ORDER BY id").map(
                (r) => r.id
            )
        ).toEqual(["x1", "x2", "x3"]);
    });
});

describe("workflow:kpi (issue #4968)", () => {
    it("prints the four lines per window and exits 1 over a ceiling", () => {
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < 4; i++)
            gateRun(`land-${i}`, now - 3600 * (i + 1), {
                command: `land ${i}`,
                log: i === 0 ? "lane: ran\n" : "Could not apply x\n",
                green: i === 0,
            });
        const r = run(KPI, []);
        expect(r.status).toBe(1);
        const lines = r.stdout.trimEnd().split("\n");
        expect(lines).toHaveLength(8);
        expect(lines[0]).toMatch(
            /^ 7d failed lands {3}3\/4 \(75\.0%\) — rebase 3$/
        );
        expect(r.stderr).toContain("OVER —  7d failed lands 75.0%");
    });

    it("exits 0 when every KPI is within its ceiling", () => {
        const now = Math.floor(Date.now() / 1000);
        // A machine-admission wait is not a MUTEX wait (review, issue #4968):
        // 30 minutes of it must not read as a p90 over the ceiling.
        writeFileSync(
            join(tel, "gate-lock.jsonl"),
            JSON.stringify({
                ts: now,
                tier: "heavy",
                event: "machine-saturated",
                waited_ms: 1_800_000,
            }) +
                "\n" +
                JSON.stringify({
                    ts: now,
                    tier: "heavy",
                    event: "acquired",
                    waited_ms: 3000,
                }) +
                "\n"
        );
        gateRun("land-1", now - 60, {
            command: "land 1",
            log: "lane: ran\n",
            green: true,
        });
        const r = run(KPI, []);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("every KPI within its ceiling");
    });
});
