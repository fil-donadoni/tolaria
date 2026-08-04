import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Runtime policy hooks (issue #2183, PRD #2180).
 *
 * These hooks exist because prose does not hold. The repo has already proven it
 * once in writing: the rule "subagents must not run the full suite" was ignored
 * routinely until `scripts/gate.ts` made it exit 1. Every rule enforced here is
 * one a model can read, agree with, and break anyway, because breaking it looks
 * locally reasonable in the moment.
 *
 * **Each hook is asserted in BOTH directions.** A deny-only suite passes for a
 * hook that denies everything — which would be a catastrophic regression that
 * looks exactly like a working guard. So every rule has a paired "and this
 * nearby legitimate command is still allowed" case, chosen to be as close as
 * possible to the denied one (force-push a feature branch vs. main; `git stash
 * list` vs `git stash`; `gh pr merge` from the main checkout vs. an issue
 * worktree).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS = path.join(REPO_ROOT, ".claude", "hooks");
const DENY_GUARD = path.join(HOOKS, "deny-guard.sh");
const CLAIM_LEDGER = path.join(HOOKS, "claim-ledger.sh");
const CLAIM_SWEEP = path.join(HOOKS, "claim-sweep.sh");

type HookResult = { code: number; stderr: string };

function runHook(
    script: string,
    payload: unknown,
    env: NodeJS.ProcessEnv = {}
): HookResult {
    const result = spawnSync("sh", [script], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
    return { code: result.status ?? -1, stderr: result.stderr ?? "" };
}

/** A Bash PreToolUse payload. */
function bash(command: string, cwd: string, session = "sess-1") {
    return {
        session_id: session,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
        cwd,
    };
}

const denied = (r: HookResult) => r.code === 2;

// ─────────────────────────────────────────────────────────────────────────────
// A real git repo + linked worktree. Rule 4 keys off git's own main-vs-linked
// worktree distinction rather than a path convention, so the fixture has to be
// a real repo — a temp directory with the right NAME would test nothing.
// ─────────────────────────────────────────────────────────────────────────────

let tmp: string;
let mainCheckout: string;
let linkedWorktree: string;
let issueWorktree: string;

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hook-policy-"));
    mainCheckout = path.join(tmp, "repo");
    fs.mkdirSync(mainCheckout);

    const git = (args: string[], cwd = mainCheckout) =>
        execFileSync("git", args, { cwd, stdio: "pipe" });

    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.invalid"]);
    git(["config", "user.name", "test"]);
    fs.writeFileSync(path.join(mainCheckout, "README.md"), "x\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    linkedWorktree = path.join(tmp, "repo-side");
    git(["worktree", "add", "-q", linkedWorktree, "-b", "side"]);

    issueWorktree = path.join(tmp, "repo-issue-42");
    git(["worktree", "add", "-q", issueWorktree, "-b", "feat/issue-42"]);
});

afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("deny-guard — a subagent may not merge a PR", () => {
    it("denies `gh pr merge` from an issue worktree", () => {
        const r = runHook(
            DENY_GUARD,
            bash("gh pr merge 123 --squash --delete-branch", issueWorktree)
        );
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/merge-train/);
    });

    it("allows `gh pr merge` from the main checkout — that is the orchestrator", () => {
        const r = runHook(
            DENY_GUARD,
            bash("gh pr merge 123 --squash --delete-branch", mainCheckout)
        );
        expect(r.code).toBe(0);
    });

    it("allows other `gh pr` commands from an issue worktree", () => {
        for (const cmd of [
            "gh pr create --title x --body y",
            "gh pr view 123 --json state",
            "gh pr checks 123",
        ]) {
            expect(runHook(DENY_GUARD, bash(cmd, issueWorktree)).code).toBe(0);
        }
    });
});

describe("deny-guard — nothing force-pushes the default branch", () => {
    it("denies a force-push naming main", () => {
        for (const cmd of [
            "git push --force origin main",
            "git push -f origin main",
            "git push --force-with-lease origin main",
            "git push origin +main",
            "git push --force origin HEAD:main",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
            expect(denied(r), `expected DENY for: ${cmd}`).toBe(true);
        }
    });

    it("allows force-pushing a FEATURE branch — the merge-train does exactly this after a rebase", () => {
        for (const cmd of [
            "git push --force-with-lease",
            "git push --force-with-lease origin feat/issue-42",
            "git push -u origin feat/issue-42",
            "git push origin main",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(r.code, `expected ALLOW for: ${cmd}`).toBe(0);
        }
    });
});

describe("deny-guard — a gate may not be piped into a pager", () => {
    it("denies a gate command piped into a pager", () => {
        for (const cmd of [
            "bun run test | tail -20",
            "bun run test:app 2>&1 | tail -30",
            "bun run check:all | head -5",
            "bun run check:pr | less",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(denied(r), `expected DENY for: ${cmd}`).toBe(true);
        }
    });

    it("explains that the exit code becomes the pager's", () => {
        const r = runHook(
            DENY_GUARD,
            bash("bun run test | tail -20", mainCheckout)
        );
        expect(r.stderr).toMatch(/exit code/i);
    });

    it("allows a TARGETED vitest run piped into a pager — its verdict is not load-bearing", () => {
        // Measured: 2,295 of 4,189 targeted runs are piped. Denying them would
        // add a round-trip to more than half of all test invocations for no
        // safety gain — a targeted false green is caught by the gate anyway.
        for (const cmd of [
            "bunx vitest run scripts/__tests__ | tail",
            "bunx vitest run convex/gre/__tests__/sba.test.ts 2>&1 | tail -30",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(r.code, `expected ALLOW for: ${cmd}`).toBe(0);
        }
    });

    it("allows a gate redirected to a file, and allows piping NON-gate commands", () => {
        for (const cmd of [
            "bun run test >/tmp/gate.log 2>&1",
            "bun run test",
            "git log --oneline | head -5",
            "gh issue list | tail -20",
            "cat package.json | head -20",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(r.code, `expected ALLOW for: ${cmd}`).toBe(0);
        }
    });
});

describe("deny-guard — no discarding git operations in the shared main checkout", () => {
    const DISCARDING = [
        "git checkout -- src/foo.ts",
        "git restore src/foo.ts",
        "git stash",
        "git stash push -m wip",
        "git reset --hard origin/main",
        "git clean -fd",
        "git commit -am 'wip'",
        "git commit -a -m 'wip'",
    ];

    it("denies them in the main checkout", () => {
        for (const cmd of DISCARDING) {
            const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
            expect(
                denied(r),
                `expected DENY in main checkout for: ${cmd}`
            ).toBe(true);
        }
    });

    it("allows the SAME commands in a linked worktree — it is yours to discard", () => {
        // This is the direction that matters most: the guard keys off git's own
        // main-vs-linked distinction, not off the path. A guard that fired
        // everywhere would make normal work in a worktree impossible.
        for (const cmd of DISCARDING) {
            const r = runHook(DENY_GUARD, bash(cmd, linkedWorktree));
            expect(r.code, `expected ALLOW in worktree for: ${cmd}`).toBe(0);
        }
    });

    it("allows non-discarding git in the main checkout", () => {
        for (const cmd of [
            "git status --short",
            "git stash list",
            "git checkout main",
            "git commit -m 'msg'",
            "git pull --ff-only",
            "git worktree add ../repo-issue-9 -b feat/issue-9",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
            expect(r.code, `expected ALLOW for: ${cmd}`).toBe(0);
        }
    });
});

describe("deny-guard — scope", () => {
    it("ignores non-Bash tools", () => {
        const r = runHook(DENY_GUARD, {
            session_id: "s",
            hook_event_name: "PreToolUse",
            tool_name: "Read",
            tool_input: { file_path: "/x" },
            cwd: mainCheckout,
        });
        expect(r.code).toBe(0);
    });

    it("ignores a directory that is not a git repo at all", () => {
        const r = runHook(DENY_GUARD, bash("git stash", os.tmpdir()));
        expect(r.code).toBe(0);
    });
});

describe("claim-ledger — records what THIS session claimed", () => {
    let projectDir: string;

    const ledger = () =>
        path.join(projectDir, ".claude", "telemetry", "claims.jsonl");

    beforeAll(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-ledger-"));
    });

    it("records a claim, with the issue number and the session id", () => {
        const r = runHook(
            CLAIM_LEDGER,
            bash(
                "gh issue edit 2183 --add-label in-progress --add-assignee @me",
                "/x",
                "sess-A"
            ),
            { CLAUDE_PROJECT_DIR: projectDir }
        );
        expect(r.code).toBe(0);

        const rows = fs
            .readFileSync(ledger(), "utf8")
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            issue: 2183,
            session: "sess-A",
            event: "claim",
        });
    });

    it("does NOT record an issue edit that is not a claim", () => {
        // Without this, every relabel would look like a claim and the Stop
        // sweep would try to release issues this session never took.
        const before = fs.readFileSync(ledger(), "utf8");
        for (const cmd of [
            "gh issue edit 999 --add-label ready-for-human",
            "gh issue edit 999 --remove-label in-progress",
            "gh issue view 999 --json labels",
            "gh issue list --label in-progress",
        ]) {
            runHook(CLAIM_LEDGER, bash(cmd, "/x", "sess-A"), {
                CLAUDE_PROJECT_DIR: projectDir,
            });
        }
        expect(fs.readFileSync(ledger(), "utf8")).toBe(before);
    });

    it("never blocks — it is an observer", () => {
        const r = runHook(CLAIM_LEDGER, bash("rm -rf /", "/x"), {
            CLAUDE_PROJECT_DIR: projectDir,
        });
        expect(r.code).toBe(0);
    });
});

describe("claim-sweep — releases this session's claims, and only those", () => {
    /** A fake `gh` on PATH, scripted per test. Recording what it was CALLED
     *  with is the whole assertion: the failure mode being guarded is the sweep
     *  releasing an issue it should not have. */
    function makeGhStub(dir: string, script: string) {
        const bin = path.join(dir, "bin");
        fs.mkdirSync(bin, { recursive: true });
        const gh = path.join(bin, "gh");
        fs.writeFileSync(gh, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
        return bin;
    }

    function setup(ledgerRows: object[], ghScript: string) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-sweep-"));
        fs.mkdirSync(path.join(dir, ".claude", "telemetry"), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(dir, ".claude", "telemetry", "claims.jsonl"),
            ledgerRows.map((r) => JSON.stringify(r)).join("\n") + "\n"
        );
        const bin = makeGhStub(dir, ghScript);
        return { dir, bin, calls: path.join(dir, "gh-calls.log") };
    }

    /** gh stub: issue is claimed, no open PR. */
    const CLAIMED_NO_PR = `
echo "$@" >> "$GH_CALLS"
case "$1 $2" in
  "issue view") echo "bug,in-progress" ;;
  "pr list")    echo "0" ;;
  *)            exit 0 ;;
esac
`;

    it("releases an issue this session claimed that is still labelled and has no open PR", () => {
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-A", issue: 700, event: "claim" }],
            CLAIMED_NO_PR
        );
        const r = runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "Stop" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        expect(r.code).toBe(0);
        expect(fs.readFileSync(calls, "utf8")).toMatch(
            /issue edit 700 --remove-label in-progress/
        );
    });

    it("does NOT release a claim made by a DIFFERENT session", () => {
        // The load-bearing case: several sessions run under the same GitHub
        // account, so assignee cannot distinguish them. Ownership comes from
        // the ledger or the sweep unclaims somebody else's live work.
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-OTHER", issue: 700, event: "claim" }],
            CLAIMED_NO_PR
        );
        runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "Stop" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        expect(fs.existsSync(calls)).toBe(false);
    });

    it("does NOT release an issue with an open PR — the work is in flight", () => {
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-A", issue: 700, event: "claim" }],
            `
echo "$@" >> "$GH_CALLS"
case "$1 $2" in
  "issue view") echo "bug,in-progress" ;;
  "pr list")    echo "1" ;;
  *)            exit 0 ;;
esac
`
        );
        runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "Stop" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        expect(fs.readFileSync(calls, "utf8")).not.toMatch(/issue edit/);
    });

    it("does NOT release an issue that no longer carries the claim label", () => {
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-A", issue: 700, event: "claim" }],
            `
echo "$@" >> "$GH_CALLS"
case "$1 $2" in
  "issue view") echo "bug" ;;
  "pr list")    echo "0" ;;
  *)            exit 0 ;;
esac
`
        );
        runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "Stop" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        expect(fs.readFileSync(calls, "utf8")).not.toMatch(/issue edit/);
    });

    it("does NOT release a claim this session already released", () => {
        const { dir, bin, calls } = setup(
            [
                { ts: 1, session: "sess-A", issue: 700, event: "claim" },
                { ts: 2, session: "sess-A", issue: 700, event: "released" },
            ],
            CLAIMED_NO_PR
        );
        runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "Stop" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        expect(fs.existsSync(calls)).toBe(false);
    });

    it("exits 0 with no ledger at all — a Stop hook must never block the session ending", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-sweep-empty-"));
        const r = runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "Stop" },
            { CLAUDE_PROJECT_DIR: dir }
        );
        expect(r.code).toBe(0);
    });
});

describe("hooks are wired into settings.json", () => {
    it("registers every hook script, and each script is executable", () => {
        // A hook that exists but is not registered is silent — the exact shape
        // of the husky pre-commit disappearance (six weeks of red CI).
        const settings = JSON.parse(
            fs.readFileSync(
                path.join(REPO_ROOT, ".claude", "settings.json"),
                "utf8"
            )
        );
        const wired = JSON.stringify(settings);

        for (const script of [
            "deny-guard.sh",
            "claim-ledger.sh",
            "claim-sweep.sh",
        ]) {
            expect(wired, `${script} is not registered`).toContain(script);
            const full = path.join(HOOKS, script);
            expect(fs.existsSync(full)).toBe(true);
            // eslint-disable-next-line no-bitwise
            expect(fs.statSync(full).mode & 0o111).toBeGreaterThan(0);
        }

        expect(settings.hooks.Stop).toBeDefined();
    });
});
