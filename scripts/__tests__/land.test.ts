import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    refusalReason,
    buildLockedCommand,
    rebaseStep,
    type LandFacts,
    type LockedCommandOptions,
} from "../land";

const GATE = resolve(__dirname, "..", "gate.ts");

/**
 * `bun run land <PR#>` (issue #2517) — one `gate.ts heavy` invocation
 * wrapping fetch → rebase → check:all → test → push → merge, so `main`
 * cannot move between "gate green" and "merge" the way it did under the
 * three-separate-steps merge-train.
 *
 * Per repo convention (docs-lane.test.ts, worktree-gc.test.ts): git/gh
 * plumbing stays thin and untested; every DECISION land.ts makes is a pure
 * function, tested directly here. The one exception is the rebase-conflict
 * behaviour, which is proven against a real (local, no-remote) git fixture —
 * a string match cannot tell a genuine `--abort` from a shell fragment that
 * merely LOOKS like one.
 */

describe("land.ts — refusal matrix", () => {
    const clean: LandFacts = {
        branch: "fix/issue-2517",
        dirty: false,
        prState: "OPEN",
        prHeadRefName: "fix/issue-2517",
    };

    it("allows a clean branch with a matching open PR", () => {
        expect(refusalReason(clean)).toBeNull();
    });

    it("refuses on main", () => {
        expect(refusalReason({ ...clean, branch: "main" })).toMatch(/main/);
    });

    it("refuses a dirty tree", () => {
        expect(refusalReason({ ...clean, dirty: true })).toMatch(/dirty/);
    });

    it("refuses when the PR is not found", () => {
        expect(
            refusalReason({ ...clean, prState: null, prHeadRefName: null })
        ).toMatch(/not found/);
    });

    it("refuses when the PR is not open", () => {
        expect(refusalReason({ ...clean, prState: "MERGED" })).toMatch(
            /not open/
        );
        expect(refusalReason({ ...clean, prState: "CLOSED" })).toMatch(
            /not open/
        );
    });

    it("refuses when the PR head branch does not match the current branch", () => {
        expect(
            refusalReason({ ...clean, prHeadRefName: "someone-elses-branch" })
        ).toMatch(/head branch/);
    });

    it("checks main before dirty — a session on main never needs the dirty check to fire", () => {
        expect(
            refusalReason({ ...clean, branch: "main", dirty: true })
        ).toMatch(/main/);
    });

    // Proof-of-failure: commented out the `if (facts.dirty)` branch in
    // refusalReason — "refuses a dirty tree" went red (refusalReason
    // returned null instead of the dirty-tree reason). Reverted.
});

describe("land.ts — the locked command", () => {
    const base: LockedCommandOptions = {
        branch: "fix/issue-2517",
        pr: 2517,
        primaryCheckout: "/repo",
        worktree: "/repo-issue-2517",
        merge: true,
        teardown: true,
    };

    it("wraps fetch, rebase, both gates, the push and the merge in ONE string", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain("git fetch origin main");
        expect(cmd).toContain("git rebase origin/main");
        expect(cmd).toContain("bun run check:all");
        expect(cmd).toContain("bun run test");
        expect(cmd).toContain("git push --force-with-lease origin");
        expect(cmd).toContain("gh pr merge 2517 --squash --delete-branch");
    });

    it("orders fetch/rebase < gates < push < merge", () => {
        const cmd = buildLockedCommand(base);
        const at = (needle: string) => {
            const i = cmd.indexOf(needle);
            expect(
                i,
                `expected to find "${needle}" in: ${cmd}`
            ).toBeGreaterThan(-1);
            return i;
        };
        expect(at("git rebase origin/main")).toBeGreaterThan(
            at("git fetch origin main")
        );
        expect(at("bun run check:all")).toBeGreaterThan(
            at("git rebase origin/main")
        );
        expect(at("bun run test")).toBeGreaterThan(at("bun run check:all"));
        expect(at("git push --force-with-lease")).toBeGreaterThan(
            at("bun run test")
        );
        expect(at("gh pr merge")).toBeGreaterThan(
            at("git push --force-with-lease")
        );
    });

    it("--no-merge gates and pushes but omits the merge", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).toContain("bun run check:all");
        expect(cmd).toContain("bun run test");
        expect(cmd).toContain("git push --force-with-lease");
        expect(cmd).not.toContain("gh pr merge");
        expect(cmd).not.toContain("worktree remove");
        expect(cmd).not.toContain("green-sha");
    });

    it("--keep merges but skips worktree teardown", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toContain("gh pr merge 2517");
        expect(cmd).toContain("green-sha");
        expect(cmd).not.toContain("worktree remove");
    });

    it("writes green-sha under the PRIMARY checkout, never the worktree", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain("/repo/.claude/telemetry/green-sha");
        expect(cmd).not.toContain(
            "/repo-issue-2517/.claude/telemetry/green-sha"
        );
    });

    it("re-fetches origin/main AFTER the merge, before reading the tip for green-sha", () => {
        const cmd = buildLockedCommand(base);
        const mergeIdx = cmd.indexOf("gh pr merge");
        const refetchIdx = cmd.indexOf("git fetch origin main -q");
        const revParseIdx = cmd.indexOf("git rev-parse origin/main >");
        expect(refetchIdx).toBeGreaterThan(mergeIdx);
        expect(revParseIdx).toBeGreaterThan(refetchIdx);
    });

    it("is syntactically valid shell", () => {
        for (const opts of [
            base,
            { ...base, merge: false },
            { ...base, teardown: false },
        ]) {
            const cmd = buildLockedCommand(opts);
            const r = spawnSync("sh", ["-n", "-c", cmd], { encoding: "utf8" });
            expect(r.status, r.stderr).toBe(0);
        }
    });

    // Proof-of-failure: changed `if (opts.merge)` to `if (true)` (so
    // `--no-merge` no longer omitted the merge step) — "--no-merge gates and
    // pushes but omits the merge" went red (cmd still contained
    // "gh pr merge"). Reverted.
});

describe("land.ts — nested heavy gate inside the locked command", () => {
    let lockRoot: string;

    function gateEnv(extra: Record<string, string> = {}) {
        const base = { ...process.env, TOLARIA_GATE_LOCK_ROOT: lockRoot };
        delete base.TOLARIA_GATE_HELD;
        delete base.TOLARIA_ALLOW_FULL_SUITE;
        delete base.TOLARIA_VITEST_WORKERS;
        return { ...base, ...extra };
    }

    beforeEach(() => {
        lockRoot = mkdtempSync(join(tmpdir(), "tolaria-land-gate-test-"));
    });

    afterEach(() => {
        rmSync(lockRoot, { recursive: true, force: true });
    });

    it("a heavy gate.ts call nested inside another (the shape `bun run check:all` takes inside land's locked command) passes straight through instead of blocking on itself", () => {
        // This is exactly the composition `buildLockedCommand` produces:
        // the OUTER `gate.ts heavy` (land's own invocation) wraps a shell
        // command whose steps (`bun run check:all`, `bun run test`) are
        // themselves `gate.ts heavy` calls. Reproduce that nesting directly.
        const r = spawnSync(
            "bun",
            [GATE, "heavy", `bun ${GATE} heavy "echo NESTED-OK"`],
            { encoding: "utf8", cwd: lockRoot, env: gateEnv() }
        );
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).toContain("NESTED-OK");
    }, 20_000);

    // Proof-of-failure: ran a variant of this scenario by hand — pre-seeded
    // a lock dir with an owner.json naming a live pid (this test process's
    // own pid), then spawned `gate.ts heavy` against that SAME lock root
    // from a neutral cwd but WITHOUT TOLARIA_GATE_HELD (i.e. the situation
    // land.ts's design exists to avoid: a heavy call that does not know it
    // is nested). With a 4s timeout it never returned — killed by SIGTERM,
    // elapsed ~4005ms — instead of the ~76ms a passthrough call takes. That
    // is the deadlock: a nested call that does not inherit
    // TOLARIA_GATE_HELD waits forever for a lock its own ancestor holds. The
    // test above passes precisely because `gate.ts` DOES stamp
    // TOLARIA_GATE_HELD=1 on its child's env (gate.ts:271-272), which is
    // what land.ts's locked command relies on.
});

describe("land.ts — rebase conflict (real git, no remote/no lock)", () => {
    let dir: string;
    let origin: string;
    let clone: string;

    function run(args: string[], cwd: string) {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-test-"));
        origin = join(dir, "origin.git");
        clone = join(dir, "clone");

        run(["init", "--bare", "-b", "main", origin], dir);
        run(["clone", origin, clone], dir);
        run(["config", "user.email", "test@example.com"], clone);
        run(["config", "user.name", "Test"], clone);

        writeFileSync(join(clone, "shared.txt"), "base\n");
        run(["add", "shared.txt"], clone);
        run(["commit", "-m", "base"], clone);
        run(["push", "origin", "main"], clone);

        // Feature branch diverges from main...
        run(["checkout", "-b", "feature"], clone);
        writeFileSync(join(clone, "shared.txt"), "feature change\n");
        run(["commit", "-am", "feature edit"], clone);

        // ...and main moves under it, touching the same line.
        run(["checkout", "main"], clone);
        writeFileSync(join(clone, "shared.txt"), "main change\n");
        run(["commit", "-am", "main edit"], clone);
        run(["push", "origin", "main"], clone);
        run(["checkout", "feature"], clone);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("aborts the rebase, exits non-zero, and names the conflicting path", () => {
        const r = spawnSync("sh", ["-c", rebaseStep()], {
            cwd: clone,
            encoding: "utf8",
        });
        expect(r.status).not.toBe(0);
        expect(r.stdout).toContain("shared.txt");

        // The tree must be left usable — no rebase in progress, still on the
        // feature branch (a real `--abort`, not just a nonzero exit).
        const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
            cwd: clone,
            encoding: "utf8",
        }).stdout.trim();
        expect(existsSync(join(clone, gitDir, "rebase-merge"))).toBe(false);
        expect(existsSync(join(clone, gitDir, "rebase-apply"))).toBe(false);
        const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: clone,
            encoding: "utf8",
        }).stdout.trim();
        expect(branch).toBe("feature");
    });

    it("does nothing destructive when there is no conflict", () => {
        // A branch that never touches shared.txt rebases cleanly even though
        // main has moved — this is the common case `land` runs through on
        // every landing, and it must not be treated as a conflict.
        run(["checkout", "-b", "peaceful", "main"], clone);
        writeFileSync(join(clone, "peaceful.txt"), "peaceful change\n");
        run(["add", "peaceful.txt"], clone);
        run(["commit", "-m", "peaceful edit"], clone);

        run(["checkout", "main"], clone);
        writeFileSync(join(clone, "unrelated.txt"), "new file\n");
        run(["add", "unrelated.txt"], clone);
        run(["commit", "-m", "unrelated"], clone);
        run(["push", "origin", "main"], clone);
        run(["checkout", "peaceful"], clone);

        const r = spawnSync("sh", ["-c", rebaseStep()], {
            cwd: clone,
            encoding: "utf8",
        });
        expect(r.status, r.stdout + r.stderr).toBe(0);
    });

    // Proof-of-failure: removed the `git rebase --abort` call from
    // `rebaseStep` (kept only the diff + `exit 1`) — the "no rebase in
    // progress" assertions went red (both `rebase-merge`/`rebase-apply`
    // existed under .git/, and HEAD read `feature` only nominally while a
    // rebase was still active) — the test caught the tree being left
    // unusable. Reverted.
});
