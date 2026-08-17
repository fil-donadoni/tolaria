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
    // Rule 0 lets gitignored paths through — the loop writes its telemetry and
    // its receipts into the main checkout by design — so the fixture needs a
    // real .gitignore, not a path convention.
    fs.writeFileSync(
        path.join(mainCheckout, ".gitignore"),
        ".claude/telemetry/\n.claude/receipts/\n*.local\n"
    );
    fs.mkdirSync(path.join(mainCheckout, "docs", "adr"), { recursive: true });
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

    it("reads the push command's own arguments, not prose that happens to travel with it", () => {
        // Observed the first time the rule met a real command: a `git commit`
        // whose MESSAGE discussed force-pushing main, chained with a `git push`
        // of a feature branch. Scanning the whole command string denied it.
        // Prose rides inside commands all the time — commit bodies, PR bodies,
        // echoed explanations — and a guard that reads it blocks legitimate
        // work at random, which is how guards end up switched off.
        const forceWord = "--force";
        const branch = "ma" + "in";
        for (const cmd of [
            // The trailing space after the branch name is deliberate: it is
            // what makes the prose match the ref pattern, so this case really
            // does discriminate same-line from any-line matching.
            `git commit -m 'docs: nothing may ${forceWord} push to ${branch} , ever'\n&& git push -u origin fix/issue-2203`,
            `git commit -m 'never ${forceWord} push to ${branch} again' && git push -u origin fix/issue-2203`,
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(r.code, `expected ALLOW for: ${cmd}\n${r.stderr}`).toBe(0);
        }
    });

    it("still denies when the force and the ref are in the push command itself, even alongside prose", () => {
        const cmd = [
            "git commit -m 'a message mentioning nothing in particular'",
            "&& git push --force origin main",
        ].join("\n");
        expect(denied(runHook(DENY_GUARD, bash(cmd, issueWorktree)))).toBe(
            true
        );
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

    it("allows a gate redirected to a file followed by a SEPARATE piped grep of that file", () => {
        // Observed live: the gate and the pager were in different commands, and
        // the whole-string match denied it anyway. This is the correct way to
        // read a gate's output, so denying it left no legal way to do the thing
        // the rule is telling you to do.
        // Both spellings: separated by a newline, and — the case a line-based
        // match cannot see — chained with `;` or `&&` on ONE line.
        for (const cmd of [
            "bun run check:pr >/tmp/gate.log 2>&1\ngrep -E 'Tests|FAIL' /tmp/gate.log | tail -4",
            "bun run check:pr >/tmp/gate.log 2>&1; grep -E 'Tests' /tmp/gate.log | tail -4",
            "bun run test >/tmp/g.log 2>&1 && grep Tests /tmp/g.log | head -3",
        ]) {
            expect(
                runHook(DENY_GUARD, bash(cmd, issueWorktree)).code,
                `expected ALLOW for: ${cmd}`
            ).toBe(0);
        }
    });

    it("still denies when the gate and the pager are in the SAME pipeline, alongside other commands", () => {
        const cmd = [
            "echo starting",
            "bun run test | tail -20",
            "echo done",
        ].join("\n");
        expect(denied(runHook(DENY_GUARD, bash(cmd, issueWorktree)))).toBe(
            true
        );
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
        // `git add -A && git commit -m` is `commit -a` in two steps: it sweeps
        // whatever another session left in the tree into an unrelated commit.
        "git add -A",
        "git add --all",
        "git add .",
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
            // Naming the path cannot pick up a file you did not mean.
            "git add src/foo.ts",
            "git add docs/adr/0101-x.md CONTEXT.md",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
            expect(r.code, `expected ALLOW for: ${cmd}`).toBe(0);
        }
    });
});

describe("deny-guard — nothing authors a versioned file in the main checkout", () => {
    /** An Edit/Write PreToolUse payload. */
    function write(filePath: string, cwd: string, tool = "Write") {
        return {
            session_id: "sess-1",
            hook_event_name: "PreToolUse",
            tool_name: tool,
            tool_input: { file_path: filePath, content: "x" },
            cwd,
        };
    }

    it("denies authoring a versioned file there, whatever the authoring tool", () => {
        // The shape that produced ~40 documentation-only commits straight on
        // main: a discussion writes its ADR wherever the session happens to be.
        const targets = [
            "docs/adr/0101-something.md",
            "CONTEXT.md",
            "README.md",
            "src/components/board/Hand.tsx",
        ];
        for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
            for (const t of targets) {
                const r = runHook(
                    DENY_GUARD,
                    write(path.join(mainCheckout, t), mainCheckout, tool)
                );
                expect(denied(r), `expected DENY for ${tool} ${t}`).toBe(true);
                expect(r.stderr).toMatch(/worktree/);
            }
        }
    });

    it("denies it no matter where the SESSION is — the path decides, not the cwd", () => {
        // A session sitting in its own worktree can still reach across into the
        // shared tree, and that does exactly the same damage.
        const r = runHook(
            DENY_GUARD,
            write(path.join(mainCheckout, "CONTEXT.md"), linkedWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("denies a file whose directory does not exist yet", () => {
        // A new ADR is the common case and its parent may be new too; the probe
        // has to walk up to an existing ancestor rather than give up.
        const r = runHook(
            DENY_GUARD,
            write(
                path.join(mainCheckout, "docs", "brand", "new", "note.md"),
                mainCheckout
            )
        );
        expect(denied(r)).toBe(true);
    });

    it("ALLOWS the same write inside a linked worktree — that is the whole point", () => {
        for (const t of ["docs/adr/0101-something.md", "CONTEXT.md"]) {
            const r = runHook(
                DENY_GUARD,
                write(path.join(linkedWorktree, t), linkedWorktree)
            );
            expect(r.code, `expected ALLOW in worktree for: ${t}`).toBe(0);
        }
    });

    it("ALLOWS gitignored paths in the main checkout — the loop writes them by design", () => {
        // green-sha, the claim ledger and every subagent receipt live here and
        // cannot dirty anyone's tree. Denying them would break the loop itself.
        for (const t of [
            ".claude/telemetry/green-sha",
            ".claude/receipts/batch-1/issue-2.json",
            "settings.local",
        ]) {
            const r = runHook(
                DENY_GUARD,
                write(path.join(mainCheckout, t), mainCheckout)
            );
            expect(r.code, `expected ALLOW for gitignored: ${t}`).toBe(0);
        }
    });

    it("ALLOWS writes outside any repository", () => {
        const r = runHook(
            DENY_GUARD,
            write(path.join(tmp, "scratch.md"), mainCheckout)
        );
        expect(r.code).toBe(0);
    });

    it("ALLOWS everything under the visible escape hatch", () => {
        const r = runHook(
            DENY_GUARD,
            write(path.join(mainCheckout, "CONTEXT.md"), mainCheckout),
            { TOLARIA_ALLOW_MAIN_EDIT: "1" }
        );
        expect(r.code).toBe(0);
    });

    it("does not touch READS", () => {
        const r = runHook(DENY_GUARD, {
            session_id: "s",
            hook_event_name: "PreToolUse",
            tool_name: "Read",
            tool_input: { file_path: path.join(mainCheckout, "CONTEXT.md") },
            cwd: mainCheckout,
        });
        expect(r.code).toBe(0);
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

    /**
     * gh stub: issue is claimed, and NOTHING is in flight for it.
     *
     * The `pr list` arm answers per QUERY SHAPE rather than unconditionally,
     * because the shape is what was broken (#2314). Real `gh` behaviour,
     * reproduced against PR #2313 on head `feat/issue-1625`:
     *
     *     gh pr list --state open --search "issue-1625 in:head"  → 0
     *     gh pr list --state open --limit 200 --json headRefName → the PR
     *
     * `in:` is a qualifier over title/body/comments, not over the head branch,
     * so the search form returns 0 for EVERY issue. A stub that echoes a fixed
     * count regardless of arguments cannot tell the two apart — which is why
     * the original suite passed against a guard that never matched anything.
     */
    const CLAIMED_NO_PR = `
echo "$@" >> "$GH_CALLS"
case "$1 $2" in
  "issue view") echo "bug,in-progress" ;;
  "pr list")
    case "$*" in
      *--search*) echo "0" ;;        # the broken form: matches nothing, ever
      *headRefName*) echo "0" ;;     # the working form: genuinely no open PR
      *) echo "0" ;;
    esac
    ;;
  *) exit 0 ;;
esac
`;

    /** gh stub: issue is claimed AND an open PR exists on its head branch. */
    const CLAIMED_WITH_PR = `
echo "$@" >> "$GH_CALLS"
case "$1 $2" in
  "issue view") echo "bug,in-progress" ;;
  "pr list")
    case "$*" in
      *--search*)    echo "0" ;;     # what real gh returns for \`in:head\`
      *headRefName*) echo "1" ;;     # the PR is visible only to the head probe
      *) echo "0" ;;
    esac
    ;;
  *) exit 0 ;;
esac
`;

    it("releases an issue this session claimed that is still labelled and has no open PR", () => {
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-A", issue: 700, event: "claim" }],
            CLAIMED_NO_PR
        );
        const r = runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
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
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        expect(fs.existsSync(calls)).toBe(false);
    });

    it("does NOT release an issue with an open PR — the work is in flight", () => {
        // The load-bearing regression (#2314). The probe must look at the head
        // REF; the previous `--search "issue-N in:head"` form returned 0 with
        // the PR wide open, so the guard failed OPEN and the sweep released
        // every claim it saw. The stub answers per query shape, so a revert to
        // the search form goes red here instead of silently passing.
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-A", issue: 700, event: "claim" }],
            CLAIMED_WITH_PR
        );
        runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
            {
                CLAUDE_PROJECT_DIR: dir,
                PATH: `${bin}:${process.env.PATH}`,
                GH_CALLS: calls,
            }
        );
        const log = fs.readFileSync(calls, "utf8");
        expect(log).not.toMatch(/issue edit/);
        // …and it must be asking about the head ref at all.
        expect(log).toMatch(/headRefName/);
    });

    it("does NOT release an issue whose branch is pushed but has no PR yet", () => {
        // The window between the subagent's first push and `gh pr create` is
        // exactly when a claim is most load-bearing and least visible: no PR
        // exists, so a PR-only probe reads it as abandoned work.
        const { dir, bin, calls } = setup(
            [{ ts: 1, session: "sess-A", issue: 700, event: "claim" }],
            CLAIMED_NO_PR
        );
        fs.writeFileSync(
            path.join(bin, "git"),
            `#!/bin/sh\ncase "$*" in\n  *ls-remote*) echo "deadbeef\\trefs/heads/feat/issue-700" ;;\n  *) exit 0 ;;\nesac\n`,
            { mode: 0o755 }
        );
        runHook(
            CLAIM_SWEEP,
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
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
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
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
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
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
            { session_id: "sess-A", hook_event_name: "SessionEnd" },
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

        // Derived from the DIRECTORY, not an allow-list. A hard-coded list stops
        // covering everything written after it — which is exactly what a
        // registration guard must not do, since an unregistered hook produces no
        // error, no output and no failing test: it simply never runs.
        const scripts = fs
            .readdirSync(HOOKS)
            .filter((f) => f.endsWith(".sh"))
            .sort();
        expect(scripts.length).toBeGreaterThan(0);

        for (const script of scripts) {
            expect(wired, `${script} is not registered`).toContain(script);
            const full = path.join(HOOKS, script);
            expect(fs.existsSync(full)).toBe(true);
            expect(fs.statSync(full).mode & 0o111).toBeGreaterThan(0);
        }

        expect(settings.hooks.SubagentStop).toBeDefined();
    });

    it("wires each hook to the EVENT it is written for", () => {
        // Registration is not enough. `claim-sweep.sh` was wired to `Stop`,
        // which fires at the end of every assistant TURN — so it ran mid-batch
        // and released claims whose work had barely started (issue #2314). The
        // registration guard above was green throughout: the hook was present,
        // executable and referenced, just listening to the wrong thing.
        //
        // The map is the declaration a new hook must make. Adding a script
        // without an entry fails here, which forces the "when does this run?"
        // question to be answered once, in writing.
        const EVENT_OF: Record<string, string> = {
            "claim-ledger.sh": "PreToolUse",
            "claim-sweep.sh": "SessionEnd",
            "deny-guard.sh": "PreToolUse",
            "receipt-guard.sh": "SubagentStop",
            "spawn-guard.sh": "PreToolUse",
            "timing-log.sh": "PreToolUse", // also PostToolUse; asserted below
        };

        const settings = JSON.parse(
            fs.readFileSync(
                path.join(REPO_ROOT, ".claude", "settings.json"),
                "utf8"
            )
        );

        /** Every event a given script is registered under. */
        const eventsOf = (script: string): string[] =>
            Object.entries(settings.hooks as Record<string, unknown[]>)
                .filter(([, groups]) => JSON.stringify(groups).includes(script))
                .map(([event]) => event);

        const scripts = fs
            .readdirSync(HOOKS)
            .filter((f) => f.endsWith(".sh"))
            .sort();

        for (const script of scripts) {
            const expected = EVENT_OF[script];
            expect(
                expected,
                `${script} has no declared event — add it to EVENT_OF`
            ).toBeDefined();
            expect(
                eventsOf(script),
                `${script} is not wired to ${expected}`
            ).toContain(expected);
        }

        // The sweep releases claims. On `Stop` it would fire while the batch's
        // subagents are still working — the exact #2314 regression.
        expect(eventsOf("claim-sweep.sh")).not.toContain("Stop");
        expect(eventsOf("timing-log.sh")).toContain("PostToolUse");
    });

    it("every hook script is executable in git's INDEX, not just on this disk", () => {
        // `fs.statSync` above reads the local file; git records the mode
        // separately. A hook committed 100644 is executable here and inert in
        // every fresh checkout — the shape that left `.husky/pre-commit` silently
        // skipped for six days after the change that was supposed to restore it.
        const listing = execFileSync(
            "git",
            ["ls-files", "-s", ".claude/hooks/"],
            { cwd: REPO_ROOT, encoding: "utf8" }
        );
        const entries = listing
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [meta, file] = line.split("\t");
                return { mode: meta.split(" ")[0], file };
            })
            .filter((e) => e.file.endsWith(".sh"));

        expect(entries.length).toBeGreaterThan(0);
        const nonExecutable = entries
            .filter((e) => e.mode !== "100755")
            .map((e) => `${e.file} is ${e.mode}`);
        expect(
            nonExecutable,
            `fix with: git update-index --chmod=+x <file>\n${nonExecutable.join("\n")}`
        ).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent spawn policy (`spawn-guard.sh`) — the model tier and the role are
// DECLARED. Both rules replace a CLAUDE.md paragraph that measurably did not
// hold: 12% of spawns passed no model, and 55% of agent tokens could not be
// attributed to a role.
//
// Asserted in both directions, same as every rule above: a guard that denies
// every spawn would stop the loop dead while looking exactly like a working one.
// ─────────────────────────────────────────────────────────────────────────────

const SPAWN_GUARD = path.join(HOOKS, "spawn-guard.sh");

function spawn(input: Record<string, unknown>) {
    return {
        session_id: "sess-1",
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: input,
        cwd: REPO_ROOT,
    };
}

describe("Agent spawns declare their model tier", () => {
    it("denies a spawn with no model", () => {
        const r = runHook(
            SPAWN_GUARD,
            spawn({ description: "implement #1", prompt: "x" })
        );
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/inherits THIS session's tier/);
    });

    it("allows the same spawn once a model is passed", () => {
        expect(
            denied(
                runHook(
                    SPAWN_GUARD,
                    spawn({ description: "implement #1", model: "sonnet" })
                )
            )
        ).toBe(false);
    });

    it("exempts `fork`, which cannot honour a model parameter", () => {
        // A fork always inherits the parent model by design and the parameter
        // is ignored — requiring one would deny a spawn that cannot comply.
        expect(
            denied(
                runHook(
                    SPAWN_GUARD,
                    spawn({
                        description: "investigate the layer stack",
                        subagent_type: "fork",
                    })
                )
            )
        ).toBe(false);
    });
});

describe("Agent spawns declare their role", () => {
    it("denies an empty description", () => {
        const r = runHook(SPAWN_GUARD, spawn({ model: "sonnet" }));
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/no `description`/);
    });

    it("denies a description with no role prefix", () => {
        const r = runHook(
            SPAWN_GUARD,
            spawn({ description: "look at the bot driver", model: "sonnet" })
        );
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/does not start with a role/);
    });

    it("allows every role in the closed vocabulary", () => {
        for (const role of [
            "implement",
            "review",
            "fixup",
            "investigate",
            "research",
            "verify",
            "migrate",
            "audit",
        ]) {
            const r = runHook(
                SPAWN_GUARD,
                spawn({
                    description: `${role} #42 — something`,
                    model: "sonnet",
                })
            );
            expect(denied(r), `${role} was denied`).toBe(false);
        }
    });

    it("matches the role case-insensitively", () => {
        expect(
            denied(
                runHook(
                    SPAWN_GUARD,
                    spawn({ description: "Review PR #2211", model: "opus" })
                )
            )
        ).toBe(false);
    });

    it("ignores tools that are not Agent", () => {
        const r = runHook(SPAWN_GUARD, {
            session_id: "s",
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "ls" },
            cwd: REPO_ROOT,
        });
        expect(r.code).toBe(0);
    });
});
