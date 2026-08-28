import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    refusalReason,
    buildLockedCommand,
    rebaseStep,
    remoteBranchDeleteStep,
    primaryMainFastForwardStep,
    lockedEnv,
    computeSkinReceiptInvalid,
    safeSkinReceiptInvalid,
    isTestOnlySrcDiff,
    type LandFacts,
    type LockedCommandOptions,
} from "../land";
import {
    evaluateRun,
    formatResultRow,
    coverageLine,
    receiptKindLine,
    loadBudgets,
    BUDGET_KEYS,
    type Ceilings,
    type SurfaceWalk,
} from "../ui-gate/budgets.ts";
import { SURFACE_IDS } from "../ui-gate/surfaces.ts";

const GATE = resolve(__dirname, "..", "gate.ts");

/**
 * `bun run land <PR#>` (issue #2517) — one `gate.ts heavy` invocation
 * wrapping fetch → rebase → check:lane → push → merge (ADR 0110), so `main`
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
        skinReceiptInvalid: false,
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

    // Issue #2760 — `land` refuses a `skin` landing diff whose pasted
    // check:ui receipt failed verification. `skinReceiptInvalid` is a
    // PRE-COMPUTED fact (`lane === "skin" && !verifyReceiptText(body).ok`)
    // by the time it reaches `refusalReason` — this suite proves only the
    // refusal-matrix side (the flag is checked, and checked last, after the
    // cheaper structural facts); `verify-receipt.test.ts` proves the flag
    // itself is computed correctly.
    it("refuses a skin diff with an invalid receipt", () => {
        expect(refusalReason({ ...clean, skinReceiptInvalid: true })).toMatch(
            /check:ui receipt failed verification/
        );
    });

    it("does not refuse when the receipt verified clean (or the diff never reached skin)", () => {
        expect(
            refusalReason({ ...clean, skinReceiptInvalid: false })
        ).toBeNull();
    });

    it("checks head-branch match before the receipt — a branch mismatch never needs the (expensive) receipt fact to fire", () => {
        expect(
            refusalReason({
                ...clean,
                prHeadRefName: "someone-elses-branch",
                skinReceiptInvalid: true,
            })
        ).toMatch(/head branch/);
    });

    // Proof-of-failure: commented out the `if (facts.skinReceiptInvalid)`
    // branch — "refuses a skin diff with an invalid receipt" went red
    // (refusalReason returned null instead of naming the receipt failure).
    // Reverted.
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

    it("wraps fetch, rebase, the lane gate, the push and the merge in ONE string", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain("git fetch origin main");
        expect(cmd).toContain("git rebase origin/main");
        // The LANE gate, not the full gate (ADR 0110 §3): the full gate is
        // the post-merge health detach asserted below.
        expect(cmd).toContain("bun run check:lane");
        expect(cmd).not.toContain("bun run check:all");
        expect(cmd).toContain("git push --force-with-lease origin");
        // The merge is `pr-merge.ts` since #2536 (settle-aware retry), but
        // what this test guards is unchanged: it is textually inside the ONE
        // string the heavy lock wraps.
        expect(cmd).toMatch(/bun '[^']*pr-merge\.ts' 2517/);
    });

    it("never passes --delete-branch (review round 2, B2)", () => {
        // `gh --delete-branch` switches the LOCAL repo to the default branch
        // before deleting, and `main` is checked out in the primary
        // worktree — `land` runs from a linked worktree — so that step dies
        // with `fatal: 'main' is already used by worktree at …` AFTER the
        // API merge has already landed. Ref cleanup is done explicitly
        // instead (see the two tests below). The flag's absence from the
        // merge ARGV is asserted in pr-merge.test.ts (`mergeArgs`); this test
        // covers the shell string `land` builds around it.
        const cmd = buildLockedCommand(base);
        expect(cmd).not.toContain("--delete-branch");
    });

    it("deletes the remote and local branch refs explicitly, past the green-sha write", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain("git push origin --delete 'fix/issue-2517'");
        expect(cmd).toContain("git -C '/repo' branch -D 'fix/issue-2517'");
        const greenShaIdx = cmd.indexOf("git rev-parse origin/main >");
        const remoteDeleteIdx = cmd.indexOf("git push origin --delete");
        const localDeleteIdx = cmd.indexOf("branch -D");
        expect(remoteDeleteIdx).toBeGreaterThan(greenShaIdx);
        expect(localDeleteIdx).toBeGreaterThan(greenShaIdx);
    });

    it("wraps ref cleanup so it can never gate land's exit status on a merged PR", () => {
        // The remote-branch delete has its own richer wrapper (issue #2877,
        // see `remoteBranchDeleteStep`'s own describe block below for the
        // DIAGNOSTIC-filtering behaviour) — it is asserted to appear here
        // VERBATIM, byte-for-byte, so this test also proves
        // `buildLockedCommand` doesn't reimplement or diverge from it. The
        // worktree-remove and local branch -D steps keep the plain
        // `(… || true)` wrapper: a stale remote, an already-removed
        // worktree, or a branch that will not delete cannot turn a MERGED
        // PR's landing into a reported failure — ref cleanup is cosmetic,
        // the merge is not.
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain(remoteBranchDeleteStep("fix/issue-2517"));
        expect(cmd).toContain(
            "(git -C '/repo' worktree remove --force '/repo-issue-2517' || true)"
        );
        expect(cmd).toContain(
            "(git -C '/repo' branch -D 'fix/issue-2517' || true)"
        );
    });

    it("orders fetch/rebase < lane gate < push < merge < health detach", () => {
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
        expect(at("bun run check:lane")).toBeGreaterThan(
            at("git rebase origin/main")
        );
        expect(at("git push --force-with-lease")).toBeGreaterThan(
            at("bun run check:lane")
        );
        expect(at("pr-merge.ts")).toBeGreaterThan(
            at("git push --force-with-lease")
        );
        expect(at("health-main.ts")).toBeGreaterThan(at("pr-merge.ts"));
    });

    it("detaches the post-merge health gate, non-gating, with the lock hold scrubbed (ADR 0110)", () => {
        const cmd = buildLockedCommand(base);
        // After the green-sha write, in the primary checkout, backgrounded
        // with nohup and wrapped so it can never fail the landing.
        const healthIdx = cmd.indexOf("health-main.ts");
        expect(healthIdx).toBeGreaterThan(
            cmd.indexOf("git rev-parse origin/main >")
        );
        expect(cmd).toMatch(
            /\(cd '\/repo' && nohup env -u TOLARIA_GATE_HELD -u TOLARIA_ALLOW_FULL_SUITE bun '[^']*health-main\.ts' >> '[^']*detach\.log' 2>&1 &\) \|\| true/
        );
    });

    it("--no-merge gates and pushes but omits the merge and the health detach", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).toContain("bun run check:lane");
        expect(cmd).toContain("git push --force-with-lease");
        expect(cmd).not.toContain("pr-merge.ts");
        expect(cmd).not.toContain("worktree remove");
        expect(cmd).not.toContain("green-sha");
        expect(cmd).not.toContain("health-main.ts");
    });

    it("--keep merges but skips worktree teardown", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toMatch(/bun '[^']*pr-merge\.ts' 2517/);
        expect(cmd).toContain("green-sha");
        expect(cmd).not.toContain("worktree remove");
    });

    it("fast-forwards the primary checkout's local main onto the merged tip, past the green-sha write", () => {
        // The API merge moves `origin/main` only; without this step the
        // checkout every session branches from sits one commit behind after a
        // green land, and the next `git worktree add` starts from a stale tip.
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain(primaryMainFastForwardStep("/repo"));
        expect(cmd.indexOf("merge --ff-only")).toBeGreaterThan(
            cmd.indexOf("git rev-parse origin/main >")
        );
    });

    it("guards the fast-forward on the primary checkout actually being on main", () => {
        // Unguarded, `merge --ff-only origin/main` would fast-forward whatever
        // OTHER branch is checked out there — silently moving a user's
        // work-in-progress branch. The guard is the whole safety of the step.
        const step = primaryMainFastForwardStep("/repo");
        expect(step).toContain(
            `[ "$(git -C '/repo' symbolic-ref --quiet --short HEAD)" = "main" ]`
        );
        expect(step).toContain("git -C '/repo' merge --ff-only -q origin/main");
        // Non-gating: a dirty tree in the primary checkout must not turn a
        // MERGED PR into a reported failure.
        expect(step.endsWith("; true)")).toBe(true);
    });

    it("--keep still fast-forwards local main (teardown is about the WORKTREE)", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toContain("merge --ff-only");
    });

    it("--no-merge never touches local main — nothing landed to catch up with", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).not.toContain("merge --ff-only");
    });

    it("--keep leaves the REMOTE branch alone too, not just the worktree (#2536)", () => {
        // `--keep` exists so the worktree survives the landing; deleting its
        // upstream leaves that worktree with no remote to push to. Teardown
        // is ONE decision and `--keep` opts out of all of it.
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).not.toContain("git push origin --delete");
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
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        const refetchIdx = cmd.indexOf("git fetch origin main -q");
        const revParseIdx = cmd.indexOf("git rev-parse origin/main >");
        expect(refetchIdx).toBeGreaterThan(mergeIdx);
        expect(revParseIdx).toBeGreaterThan(refetchIdx);
    });

    it("captures the pre-merge tip and verifies the merged tip before writing green-sha (review round 2, F5)", () => {
        // The gate mutex is machine-wide only — it says nothing about a push
        // landing from elsewhere while this session held it. `land` must
        // prove `origin/main` advanced by exactly its own squash before it
        // trusts the tip enough to record it as verified-green.
        const cmd = buildLockedCommand(base);
        const oldTipIdx = cmd.indexOf("OLD_TIP=$(git rev-parse origin/main)");
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        const refetchIdx = cmd.indexOf("git fetch origin main -q");
        const verifyIdx = cmd.indexOf('$OLD_TIP..origin/main" | wc -l');
        const revParseIdx = cmd.indexOf("git rev-parse origin/main >");

        expect(oldTipIdx).toBeGreaterThan(-1);
        expect(mergeIdx).toBeGreaterThan(oldTipIdx);
        expect(refetchIdx).toBeGreaterThan(mergeIdx);
        expect(verifyIdx).toBeGreaterThan(refetchIdx);
        expect(revParseIdx).toBeGreaterThan(verifyIdx);

        // A failed verification must exit before the green-sha write is
        // reached, and must never write it.
        expect(cmd).toContain("refusing to record green-sha");
    });

    it("unsets GITHUB_TOKEN as the very first thing the locked shell does (review round 3, B1)", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd.split(" && ")[0]).toBe("unset GITHUB_TOKEN");
        expect(cmd.indexOf("unset GITHUB_TOKEN")).toBeLessThan(
            cmd.indexOf("pr-merge.ts")
        );
    });

    it("the unset actually clears GITHUB_TOKEN for anything the locked shell runs — closing the bun .env.local re-injection gap, not just a string position (review round 3, B1)", () => {
        // `lockedEnv()` strips GITHUB_TOKEN from what land.ts hands to
        // spawnSync("bun", [GATE, …]) — but that child is `bun scripts/gate.ts`,
        // and bun auto-loads `.env.local` from ITS OWN cwd back into its own
        // process.env (the worktree carries the server-side bug-report PAT),
        // which gate.ts then spreads onto the `sh -c` child that runs the
        // embedded merge (`pr-merge.ts`). `sh` never reads `.env.local`, so `unset`
        // baked into the emitted command string is the one point left that
        // can remove a re-injected token. Extract the EXACT first step
        // `buildLockedCommand` produces (not a hand-written stand-in) and run
        // it through a real shell with GITHUB_TOKEN seeded exactly as the
        // re-injection would leave it.
        const firstStep = buildLockedCommand(base).split(" && ")[0];
        const r = spawnSync(
            "sh",
            ["-c", `${firstStep} && echo "TOKEN=[$GITHUB_TOKEN]"`],
            {
                encoding: "utf8",
                env: { ...process.env, GITHUB_TOKEN: "github_pat_leaked" },
            }
        );
        expect(r.stdout).toContain("TOKEN=[]");
    });

    it("an earlier step's failure (e.g. the lane gate going red) exits on its own status, never laundered into the concurrency-refusal message (review round 3)", () => {
        // `&&`/`||` are equal-precedence and left-associative: splicing
        // VERIFY_MERGED_TIP bare into the `&&` chain let a failure anywhere
        // EARLIER cascade past every `&&`-joined step and trip its `||`
        // anyway, misreporting a red gate as "refusing to record green-sha".
        // Reproduces the reviewer's exact repro (an earlier step failing)
        // without touching real git/gh: stand `rebaseStep()` in for a no-op
        // (it would otherwise hit the real network) and force the next step
        // to fail — everything after must then be skipped by `&&`
        // short-circuit, the merge step and the rest included.
        const cmd = buildLockedCommand(base)
            .replace(rebaseStep(), "true")
            .replace("bun run check:lane", "false");
        const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8" });
        expect(r.status).toBe(1);
        expect(r.stderr).not.toContain("refusing to record green-sha");
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
    // pushes but omits the merge" went red (cmd still contained the merge
    // step). Reverted.
    //
    // Proof-of-failure (#2536): moved the remote-ref delete back OUTSIDE the
    // `if (opts.teardown)` block — "--keep leaves the REMOTE branch alone
    // too" went red. Reverted.
});

describe("land.ts — lockedEnv (review round 2, B1)", () => {
    // bun auto-loads `.env.local`, which in this repo carries a server-side
    // bug-report `GITHUB_TOKEN` that `gh` prefers over the keyring login.
    // Inherited by the locked child that runs the embedded `gh pr merge`,
    // that PAT lacks merge permission and the merge 403s AFTER check:all +
    // test have already run inside the lock. `lockedEnv` is a NECESSARY but
    // NOT SUFFICIENT part of the fix — a pure function of a base env so this
    // test never touches real process.env. It is insufficient by itself
    // because the child it strips the token FOR is `bun scripts/gate.ts`,
    // which auto-loads `.env.local` from its OWN cwd and re-injects the
    // token into its OWN process.env regardless of what `lockedEnv` passed
    // in — these tests catch a regression in the env transform, but the
    // actual leak this env transform cannot reach is covered by the
    // command-string / real-shell tests above (review round 3, B1).
    const base: NodeJS.ProcessEnv = {
        PATH: "/usr/bin",
        GITHUB_TOKEN: "github_pat_bug-report-token",
        GH_TOKEN: "gho_keyring-token",
    };

    it("strips GITHUB_TOKEN", () => {
        expect(lockedEnv(base).GITHUB_TOKEN).toBeUndefined();
    });

    it("leaves GH_TOKEN alone", () => {
        expect(lockedEnv(base).GH_TOKEN).toBe("gho_keyring-token");
    });

    it("preserves the rest of the base env and sets TOLARIA_ALLOW_FULL_SUITE", () => {
        const env = lockedEnv(base);
        expect(env.PATH).toBe("/usr/bin");
        expect(env.TOLARIA_ALLOW_FULL_SUITE).toBe("1");
    });
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
        //
        // `timeout` is mandatory here (review round 2, medium): spawnSync
        // BLOCKS THE WORKER SYNCHRONOUSLY, so vitest's own test timeout
        // cannot preempt a hang — without a `timeout` a regression here
        // hangs `bun run test` instead of reddening it, which on a repo
        // whose green-main invariant is absolute is worse than a red.
        // `r.status` is the tell: a real passthrough finishes in well under
        // 100ms with status 0, while a blocked one is SIGTERMed by `timeout`
        // and gate.ts's own signal handler turns that into exit 130 — so
        // `r.signal` stays null and line 371 is the assertion that fires.
        // `expect(r.signal).toBeNull()` is kept as belt-and-braces for a
        // child that dies BEFORE installing that handler.
        const r = spawnSync(
            "bun",
            [GATE, "heavy", `bun ${GATE} heavy "echo NESTED-OK"`],
            { encoding: "utf8", cwd: lockRoot, env: gateEnv(), timeout: 15_000 }
        );
        expect(r.signal).toBeNull();
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).toContain("NESTED-OK");
    }, 20_000);

    // This test proves passthrough (TOLARIA_GATE_HELD present → no wait), not
    // the absence of deadlock — proving a negative needs the failure mode to
    // actually occur under a bound. The test below is that: it reproduces the
    // deadlock committed, on a bounded timeout, rather than resting on a
    // manual probe recorded only in prose (review round 2 caveat).
    it("a heavy call that does NOT inherit TOLARIA_GATE_HELD deadlocks against a lock its own ancestor holds", () => {
        // Pre-seed the lock exactly as a live heavy holder would: owner.json
        // naming a pid that IS alive (this test process's own — `alive()` in
        // gate.ts checks `process.kill(pid, 0)`, which succeeds for our own
        // pid) and a fresh timestamp (nowhere near STALE_MS). Then spawn a
        // heavy call against that SAME lock root from a neutral cwd with
        // TOLARIA_GATE_HELD stripped — the exact situation land.ts's design
        // exists to avoid: a heavy call that does not know it is nested.
        mkdirSync(join(lockRoot, "gate.lock"), { recursive: true });
        writeFileSync(
            join(lockRoot, "gate.lock", "owner.json"),
            JSON.stringify({
                pid: process.pid,
                label: "simulated live holder",
                cwd: lockRoot,
                ts: Date.now(),
            })
        );

        const env = gateEnv();
        delete env.TOLARIA_GATE_HELD;

        const r = spawnSync("bun", [GATE, "heavy", "echo SHOULD-NOT-RUN"], {
            encoding: "utf8",
            cwd: lockRoot,
            env,
            timeout: 3000,
        });

        // spawnSync's `timeout` SIGTERMs the child when it fires and never
        // sets a normal exit `status` — that is the proof the process was
        // still blocked in acquire()'s poll loop, not merely slow: a
        // passthrough call (see the test above) returns in well under 100ms.
        expect(r.signal).toBe("SIGTERM");
        expect(r.stdout).not.toContain("SHOULD-NOT-RUN");
    }, 8000);

    // Proof-of-failure: temporarily deleted the `TOLARIA_GATE_HELD:
    // tier === "heavy" ? "1" : …` line in gate.ts's `env` object (main()),
    // so a nested heavy call would never see the flag its own parent had.
    // The FIRST test above ("passes straight through") then goes RED at
    // ~15s: the inner call blocks in acquire()'s poll loop, spawnSync's
    // `timeout: 15_000` SIGTERMs it, gate.ts's signal handler exits 130,
    // and line 371 fails on `r.status`. vitest completes normally
    // (1 failed, exit 1). Reverted.
    //
    // Why the bound is load-proof: the happy path returns in <100ms, three
    // orders of magnitude inside 15s, and the bound sits under the test's
    // own 20s vitest timeout so spawnSync always fires first and leaves
    // room to report.
    //
    // Run WITHOUT that `timeout` (the round-2 shape), the same mutation did
    // not redden at all — it hung: spawnSync blocks the worker
    // synchronously, so vitest's timeout could not preempt it and
    // `bun run test` had to be force-stopped. That is the regression the
    // bound exists to convert into a failing assertion.
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

describe("land.ts — remoteBranchDeleteStep (issue #2877: no error: noise on an already-gone branch, real git)", () => {
    // A string match on the shell fragment cannot tell "filters the right
    // diagnostic" from "filters nothing" — only running it against a real
    // git remote that has already had the branch deleted (exactly what
    // GitHub's "Automatically delete head branches" does before `land`'s own
    // teardown runs) proves the stderr is actually gone.
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
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-delete-test-"));
        origin = join(dir, "origin.git");
        clone = join(dir, "clone");

        run(["init", "--bare", "-b", "main", origin], dir);
        run(["clone", origin, clone], dir);
        run(["config", "user.email", "test@example.com"], clone);
        run(["config", "user.name", "Test"], clone);

        writeFileSync(join(clone, "base.txt"), "base\n");
        run(["add", "base.txt"], clone);
        run(["commit", "-m", "base"], clone);
        run(["push", "origin", "main"], clone);

        run(["checkout", "-b", "feature"], clone);
        writeFileSync(join(clone, "feature.txt"), "feature\n");
        run(["add", "feature.txt"], clone);
        run(["commit", "-m", "feature"], clone);
        run(["push", "origin", "feature"], clone);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    // Proof-of-failure (issue #2877): swap the `sh -c` argument below for
    // the OLD unfiltered wrapper `(git push origin --delete 'feature' ||
    // true)` and this test goes red — `stderr` contains
    // "error: unable to delete 'feature': remote ref does not exist" even
    // though the branch really is already gone (confirmed by hand:
    // `git push origin --delete` on a ref the bare remote no longer has
    // prints exactly that plus "error: failed to push some refs to …", exit
    // 1, on real git — reproduced before writing this fixture).
    it("prints nothing when the remote branch is already gone (GitHub's auto-delete beat us to it)", () => {
        // Simulate GitHub having already deleted the head branch on merge —
        // the ref is gone from the remote, but the local clone (standing in
        // for `land`'s worktree, mid-teardown) still has a local branch and
        // upstream to push a delete to.
        run(["update-ref", "-d", "refs/heads/feature"], origin);

        const r = spawnSync("sh", ["-c", remoteBranchDeleteStep("feature")], {
            cwd: clone,
            encoding: "utf8",
        });
        expect(r.status).toBe(0);
        expect(r.stderr).toBe("");
    });

    it("still surfaces a delete that fails for a real reason, not just an absent ref", () => {
        // An unreachable remote stands in for "the delete genuinely failed"
        // — whatever the real-world cause (permissions, a lock, …), git's
        // own text will not read "remote ref does not exist", and that
        // phrase is the only thing the diagnostic filter trusts.
        run(
            ["remote", "set-url", "origin", join(dir, "nonexistent.git")],
            clone
        );

        const r = spawnSync("sh", ["-c", remoteBranchDeleteStep("feature")], {
            cwd: clone,
            encoding: "utf8",
        });
        // Still non-gating — a real ref-cleanup failure still can't fail a
        // landing whose merge already succeeded.
        expect(r.status).toBe(0);
        expect(r.stderr.length).toBeGreaterThan(0);
        expect(r.stderr).not.toContain("remote ref does not exist");
    });
});

describe("land.ts — computeSkinReceiptInvalid (issue #2760 review, finding 3)", () => {
    // The PR that introduced this function claimed it was "tested directly"
    // — it was not: `grep -rn computeSkinReceiptInvalid scripts/` returned
    // only the definition and its one call site. Deleting the
    // `lane === "skin" &&` guard left the receipt check firing on every
    // lane, which would make `land` refuse EVERY engine/full landing (the
    // merge-train dies). These tests exercise the function directly, per
    // this file's own convention.

    it("is false for a non-skin lane, regardless of the receipt body", () => {
        expect(
            computeSkinReceiptInvalid("engine", "garbage, not a receipt")
        ).toBe(false);
        expect(
            computeSkinReceiptInvalid("full", "garbage, not a receipt")
        ).toBe(false);
    });

    it("is true for a skin lane whose receipt is garbage/invalid", () => {
        expect(
            computeSkinReceiptInvalid("skin", "garbage, not a receipt")
        ).toBe(true);
    });

    it("is false for a skin lane whose receipt actually verifies clean", () => {
        // Build a REAL full walk against the real budgets.json/SURFACE_IDS
        // — every budgeted viewport measured exactly at its ceiling (never
        // over budget) — and render it through the real functions, exactly
        // as `check:ui` would. This must verify clean under
        // `verifyReceiptText`'s defaults, which `computeSkinReceiptInvalid`
        // calls with no overrides.
        const budgets = loadBudgets();
        const walks: SurfaceWalk[] = [];
        for (const surface of SURFACE_IDS) {
            const budget = budgets.surfaces[surface];
            if (!budget || budget.status !== "budgeted") continue;
            const vpBudgets = budget.viewports ?? {};
            walks.push({
                surface,
                status: "measured",
                measurements: Object.entries(vpBudgets).map(
                    ([viewport, ceilings]) => ({
                        viewport,
                        metrics: Object.fromEntries(
                            BUDGET_KEYS.map((k) => [k, ceilings[k]])
                        ) as Ceilings,
                    })
                ),
            });
        }
        const ev = evaluateRun(budgets, SURFACE_IDS, walks, SURFACE_IDS);
        const body = [
            "Closes #2760",
            "",
            "```",
            receiptKindLine(ev),
            ...ev.rows.map(formatResultRow),
            coverageLine(ev),
            "```",
        ].join("\n");

        expect(computeSkinReceiptInvalid("skin", body)).toBe(false);
    });

    // Proof-of-failure (not a permanent test): deleted the
    // `lane === "skin" &&` guard in `computeSkinReceiptInvalid` — "is false
    // for a non-skin lane…" went red (`true` instead of `false` for both
    // "engine" and "full", on garbage input that always fails
    // `verifyReceiptText`). Reverted after confirming red; recorded in the
    // PR receipt's `proofOfFailure` list.
});

describe("land.ts — safeSkinReceiptInvalid tolerates a diff-classification failure (issue #2760 review, finding 6)", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-safe-test-"));
        const r = spawnSync("git", ["init", "-q", "-b", "main", dir], {
            encoding: "utf8",
        });
        if (r.status !== 0) {
            throw new Error(`git init failed: ${r.stderr}`);
        }
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("returns false instead of throwing when origin/main does not exist (no remote at all)", () => {
        // `changedPaths` shells out to `git diff … origin/main...HEAD` —
        // with no remote configured at all, that is an unresolvable
        // revision and `check-lane.ts`'s `git()` throws. This used to run
        // BEFORE any of `land`'s refusal checks, on every lane.
        expect(() =>
            safeSkinReceiptInvalid(dir, "irrelevant body")
        ).not.toThrow();
        expect(safeSkinReceiptInvalid(dir, "irrelevant body")).toBe(false);
    });

    // Proof-of-failure (not a permanent test): removed the try/catch from
    // `safeSkinReceiptInvalid` (called `classifyLane(changedPaths(...))`
    // directly, unguarded) — the test above went red with an UNCAUGHT
    // exception ("git diff … failed: fatal: ambiguous argument
    // 'origin/main...HEAD': unknown revision…") instead of returning `false`
    // cleanly. Reverted after confirming red; recorded in the PR receipt's
    // `proofOfFailure` list.
});

describe("land.ts — isTestOnlySrcDiff (ADR 0110 §4)", () => {
    // A src/** diff made only of test files cannot reach the DOM, so it owes
    // no check:ui receipt. The incident: a one-line test-constant green-main
    // repair (2026-08-27) was refused over a receipt for a diff with no
    // rendered surface.
    it("is true for a diff whose only src files are tests", () => {
        expect(isTestOnlySrcDiff(["src/__tests__/design-tokens.test.ts"])).toBe(
            true
        );
        expect(
            isTestOnlySrcDiff([
                "src/lib/__tests__/card-utils.test.ts",
                "src/components/board/Stack.test.tsx",
                "scripts/land.ts",
            ])
        ).toBe(true);
    });

    it("is false as soon as ONE non-test src file is in the diff", () => {
        expect(
            isTestOnlySrcDiff([
                "src/__tests__/design-tokens.test.ts",
                "src/components/board/Stack.tsx",
            ])
        ).toBe(false);
    });

    it("is false for a diff with no src files at all (not this exemption's business)", () => {
        expect(isTestOnlySrcDiff(["convex/gre/stack.ts"])).toBe(false);
        expect(isTestOnlySrcDiff([])).toBe(false);
    });

    it("does not treat a non-test file under a test-ish name as a test", () => {
        // `contest.ts` / `latest.tsx` must not match a sloppy substring
        // check — the regex anchors on `.test.` and `__tests__/`.
        expect(isTestOnlySrcDiff(["src/lib/contest.ts"])).toBe(false);
        expect(isTestOnlySrcDiff(["src/lib/latest.tsx"])).toBe(false);
    });
});
