import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fmtElapsed, runHealthStep, type HealthStep } from "../lib/health-step";

/**
 * The health gate's step runner (issue #3487). `bun run release` used to sit
 * silent for 10+ minutes because every step's output — including the gate's
 * own `[gate] waiting … for the heavy mutex` lines — was captured to the log.
 * These run a real child process (no mocks, per the scripts-project rule) and
 * assert what reaches the terminal, WHEN it reaches it, and that the log is
 * byte-identical to the old `spawnSync` capture.
 */
let dir: string;
let logPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tolaria-health-step-"));
    logPath = join(dir, "tip.log");
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** A step running `script` in this runtime — node under vitest, bun elsewhere. */
function nodeStep(script: string, name = "check:all"): HealthStep {
    return {
        ordinal: 2,
        total: 3,
        name,
        cmd: process.execPath,
        args: ["-e", script],
    };
}

function recorder() {
    const lines: { line: string; at: number }[] = [];
    return {
        lines,
        out: (line: string) => lines.push({ line, at: Date.now() }),
        text: () => lines.map((l) => l.line).join(""),
    };
}

describe("health-step — terminal progress", () => {
    it("announces the step with its ordinal before it runs, and ends with exit status and elapsed", async () => {
        const rec = recorder();
        const r = await runHealthStep(
            nodeStep(`process.stdout.write("hi\\n"); process.exit(3)`),
            { cwd: dir, env: process.env, logPath, out: rec.out }
        );
        expect(r).toMatchObject({ ok: false, status: 3 });
        expect(rec.lines[0]!.line).toBe(
            "health-main: [2/3] check:all — start\n"
        );
        expect(rec.lines.at(-1)!.line).toMatch(
            /^health-main: \[2\/3\] check:all — exit 3 after \d+s\n$/
        );
    });

    it("reports a green step as ok", async () => {
        const rec = recorder();
        const r = await runHealthStep(nodeStep(`process.exit(0)`), {
            cwd: dir,
            env: process.env,
            logPath,
            out: rec.out,
        });
        expect(r).toMatchObject({ ok: true, status: 0 });
        expect(rec.text()).toContain("check:all — exit 0 after");
    });

    it("forwards [gate] mutex-wait lines LIVE, while the step is still running, and nothing else", async () => {
        const rec = recorder();
        const script = [
            `process.stderr.write("[gate] waiting 1m03s for the heavy mutex — pid 42\\n");`,
            `process.stdout.write("vitest noise\\n");`,
            `setTimeout(() => process.stdout.write("[gate] acquired the heavy mutex after 1m04s\\n"), 50);`,
            `setTimeout(() => {}, 1500);`,
        ].join("");
        const t0 = Date.now();
        const r = await runHealthStep(nodeStep(script), {
            cwd: dir,
            env: process.env,
            logPath,
            out: rec.out,
        });
        const end = t0 + r.elapsedMs;
        const wait = rec.lines.find((l) => l.line.startsWith("[gate] waiting"));
        expect(wait?.line).toBe(
            "[gate] waiting 1m03s for the heavy mutex — pid 42\n"
        );
        // Live means before the child exits — not flushed with the verdict.
        expect(wait!.at).toBeLessThan(end - 700);
        // Both streams are scanned: the acquired line came on stdout.
        expect(rec.text()).toContain(
            "[gate] acquired the heavy mutex after 1m04s\n"
        );
        expect(rec.text()).not.toContain("vitest noise");
    }, 10_000);

    it("holds a [gate] line split across chunks until its newline, and flushes an unterminated one", async () => {
        const rec = recorder();
        const script = [
            `process.stderr.write("[ga");`,
            `setTimeout(() => process.stderr.write("te] split line\\n[gate] no newline"), 150);`,
        ].join("");
        await runHealthStep(nodeStep(script), {
            cwd: dir,
            env: process.env,
            logPath,
            out: rec.out,
        });
        expect(rec.text()).toContain("[gate] split line\n");
        expect(rec.text()).toContain("[gate] no newline\n");
    }, 10_000);

    it("prints a liveness line naming the step and elapsed while it runs, and stops after it ends", async () => {
        const rec = recorder();
        await runHealthStep(nodeStep(`setTimeout(() => {}, 900)`, "test"), {
            cwd: dir,
            env: process.env,
            logPath,
            out: rec.out,
            livenessMs: 200,
        });
        const alive = () =>
            rec.lines.filter((l) =>
                /^health-main: \[2\/3\] test — still running, \d+s elapsed\n$/.test(
                    l.line
                )
            ).length;
        const atEnd = alive();
        expect(atEnd).toBeGreaterThanOrEqual(2);
        await new Promise((r) => setTimeout(r, 500));
        expect(alive()).toBe(atEnd);
    }, 10_000);
});

describe("health-step — the per-sha log", () => {
    it("is byte-identical to the spawnSync capture it replaced: header, whole stdout, whole stderr", async () => {
        const script = `process.stdout.write("out1\\n"); process.stderr.write("[gate] err1\\n"); process.stdout.write("out2\\n"); process.exit(4)`;
        const step = nodeStep(script);
        await runHealthStep(step, {
            cwd: dir,
            env: process.env,
            logPath,
            out: () => {},
        });
        await runHealthStep(nodeStep(`process.exit(0)`), {
            cwd: dir,
            env: process.env,
            logPath,
            out: () => {},
        });
        expect(readFileSync(logPath, "utf8")).toBe(
            `\n===== ${process.execPath} -e ${script} (exit 4) =====\nout1\nout2\n[gate] err1\n` +
                `\n===== ${process.execPath} -e process.exit(0) (exit 0) =====\n`
        );
    });

    it("records a step that could not spawn as red, with the reason in the log", async () => {
        const rec = recorder();
        const r = await runHealthStep(
            {
                ordinal: 1,
                total: 3,
                name: "worktree:init",
                cmd: join(dir, "no-such-binary"),
                args: [],
            },
            { cwd: dir, env: process.env, logPath, out: rec.out }
        );
        expect(r).toMatchObject({ ok: false, status: null });
        expect(readFileSync(logPath, "utf8")).toContain("ENOENT");
        expect(rec.text()).toContain(
            "worktree:init — no exit code (signal or spawn failure)"
        );
    });
});

describe("health-step — fmtElapsed", () => {
    it("reads like the gate's holder lines", () => {
        expect(fmtElapsed(37_400)).toBe("37s");
        expect(fmtElapsed(252_000)).toBe("4m12s");
        expect(fmtElapsed(3_720_000)).toBe("1h02m");
    });
});
