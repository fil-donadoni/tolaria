import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * CPU admission control (scripts/gate.ts) — see CLAUDE.md § Quality gates.
 *
 * These assertions are the reason the gate exists: concurrent subagents each
 * spawning `ncpu - 1` vitest workers drove this machine to 5x oversubscription.
 * The mutex and the issue-worktree guard are what stop that, so they get a test
 * that actually runs the script rather than re-implementing its logic.
 *
 * The lock root is redirected to a temp dir (TOLARIA_GATE_LOCK_ROOT) so the
 * suite never contends with — or blocks on — a real gate run on this machine.
 */
const GATE = resolve(__dirname, "..", "gate.ts");

let lockRoot: string;

function env(extra: Record<string, string> = {}) {
    const base = { ...process.env, TOLARIA_GATE_LOCK_ROOT: lockRoot };
    // Strip everything gate.ts itself sets: this suite may well be running
    // UNDER a heavy gate (`bun run test`), which exports these to its whole
    // process tree — inheriting them would make the child observe the outer
    // gate's state instead of the one under test.
    delete base.TOLARIA_GATE_HELD;
    delete base.TOLARIA_ALLOW_FULL_SUITE;
    delete base.TOLARIA_VITEST_WORKERS;
    return { ...base, ...extra };
}

function run(
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
) {
    return spawnSync("bun", [GATE, ...args], {
        encoding: "utf8",
        cwd: opts.cwd,
        env: opts.env ?? env(),
    });
}

beforeEach(() => {
    lockRoot = mkdtempSync(join(tmpdir(), "tolaria-gate-test-"));
});

afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
});

describe("gate.ts — tier dispatch", () => {
    it("light tier runs the command without setting a worker override", () => {
        const r = run([
            "light",
            "echo held=[$TOLARIA_GATE_HELD] w=[$TOLARIA_VITEST_WORKERS]",
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("held=[]");
        expect(r.stdout).toContain("w=[]");
    });

    it("heavy tier raises the vitest worker cap for its child", () => {
        const r = run([
            "heavy",
            "echo held=[$TOLARIA_GATE_HELD] w=[$TOLARIA_VITEST_WORKERS]",
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("held=[1]");
        expect(r.stdout).toMatch(/w=\[[2-9]\d*\]/);
    });

    it("propagates the child's exit code", () => {
        expect(run(["heavy", "exit 3"]).status).toBe(3);
        expect(run(["light", "exit 3"]).status).toBe(3);
    });

    it("rejects an unknown tier", () => {
        expect(run(["turbo", "echo hi"]).status).toBe(2);
    });
});

describe("gate.ts — machine-wide mutex", () => {
    it("releases the lock after the command finishes", () => {
        run(["heavy", "true"]);
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);
    });

    it("serializes two heavy runs — the second starts only after the first ends", async () => {
        const stamp = (tag: string) => `printf '${tag}:%s\\n' "$(date +%s%N)"`;
        const first = spawn(
            "bun",
            [GATE, "heavy", `${stamp("A-end")}; sleep 2; ${stamp("A-out")}`],
            { encoding: "utf8", env: env() } as never
        );
        let outA = "";
        first.stdout!.on("data", (d) => (outA += d));

        // Let the first acquire before the second races for the lock.
        await new Promise((r) => setTimeout(r, 400));
        const second = run(["heavy", stamp("B-start")]);

        await new Promise<void>((r) => first.on("exit", () => r()));

        const aOut = Number(/A-out:(\d+)/.exec(outA)?.[1]);
        const bStart = Number(/B-start:(\d+)/.exec(second.stdout)?.[1]);
        expect(Number.isFinite(aOut)).toBe(true);
        expect(Number.isFinite(bStart)).toBe(true);
        // B may only begin once A has released — i.e. after A's last statement.
        expect(bStart).toBeGreaterThan(aOut);
    }, 20_000);

    it("prunes a lock whose holder is dead instead of waiting for it", () => {
        // A lock dir with no readable owner is indistinguishable from an
        // orphan: the acquirer must prune it rather than block forever.
        mkdirSync(join(lockRoot, "gate.lock"), { recursive: true });
        const r = run(["heavy", "echo acquired"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("acquired");
    }, 20_000);
});

describe("gate.ts — issue-worktree guard", () => {
    /** A non-repo dir whose path matches the issue-worktree naming convention. */
    function issueWorktree() {
        const d = join(lockRoot, "tolaria-issue-4242");
        mkdirSync(d, { recursive: true });
        return d;
    }

    it("blocks the heavy tier inside an issue worktree", () => {
        const r = run(["heavy", "echo SHOULD-NOT-RUN"], {
            cwd: issueWorktree(),
        });
        expect(r.status).toBe(1);
        expect(r.stdout).not.toContain("SHOULD-NOT-RUN");
        expect(r.stderr).toContain("Full gate blocked");
    });

    it("still allows the light tier there — targeted tests are the pre-PR gate", () => {
        const r = run(["light", "echo TARGETED-OK"], { cwd: issueWorktree() });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("TARGETED-OK");
    });

    it("honours the TOLARIA_ALLOW_FULL_SUITE escape hatch (merge-train only)", () => {
        const r = run(["heavy", "echo ESCAPE-OK"], {
            cwd: issueWorktree(),
            env: env({ TOLARIA_ALLOW_FULL_SUITE: "1" }),
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("ESCAPE-OK");
    });

    it("does not block outside an issue worktree", () => {
        const r = run(["heavy", "echo MAIN-OK"], { cwd: lockRoot });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("MAIN-OK");
    });
});
