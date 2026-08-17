import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
 *
 * **Why the raised timeout.** Every assertion here spawns `sh` on a real hook
 * script, and several `it`s loop over a whole command table — 1.0-1.5s each on
 * an IDLE machine, measured 2026-08-18. The default 5s leaves only 3-5x
 * headroom, which the FULL suite eats: at `ncpu - 1` workers, with a second
 * session holding the heavy gate, two of these timed out inside
 * `bun run land` and went green immediately when re-run alone. A spawn-bound
 * test that fails on machine load is noise in the one gate this repo has, and
 * it reds the merge-train for whoever is landing next. Same treatment, and the
 * same reason, as `loop-drain.test.ts` / `loop-handoff.test.ts`.
 */
vi.setConfig({ testTimeout: 30_000 });

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS = path.join(REPO_ROOT, ".claude", "hooks");
const DENY_GUARD = path.join(HOOKS, "deny-guard.sh");
const CLAIM_LEDGER = path.join(HOOKS, "claim-ledger.sh");
const CLAIM_SWEEP = path.join(HOOKS, "claim-sweep.sh");
const JOIN_AWK = path.join(HOOKS, "lib", "join-continued-lines.awk");

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

/**
 * Runs the joiner exactly the way deny-guard.sh does — `cmd=$(cat)` mirrors
 * the `$()` capture the hook's own jq extraction already went through
 * before the joiner ever sees `cmd`; the second capture mirrors
 * `_cmd_joined=$(printf '%s' "$cmd" | awk -f join-continued-lines.awk)`
 * line-for-line. This is the SAME code the hook runs (`.claude/hooks/lib/
 * join-continued-lines.awk`, loaded via `awk -f`, not a reimplementation),
 * and the SAME two capture boundaries, so a byte-identity assertion here is
 * an assertion about the hook's real behavior. Operates on raw Buffers,
 * encoding left unset, so an invalid-UTF-8 payload round-trips as bytes
 * instead of getting mangled at a JS string boundary.
 */
function runJoinerAsHookWould(input: Buffer): Buffer {
    const result = spawnSync(
        "sh",
        [
            "-c",
            'cmd=$(cat); _j=$(printf "%s" "$cmd" | LC_ALL=C awk -f "$JOIN_AWK"); printf "%s" "$_j"',
        ],
        { input, env: { ...process.env, JOIN_AWK } }
    );
    return result.stdout as Buffer;
}

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

describe("deny-guard — merging goes through land, from anywhere (#2537)", () => {
    it("denies `gh pr merge` from an issue worktree", () => {
        const r = runHook(
            DENY_GUARD,
            bash("gh pr merge 123 --squash --delete-branch", issueWorktree)
        );
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/land/);
    });

    it("denies it from the MAIN checkout too — the gap that let three merges bypass the lock", () => {
        // Until #2537 this was the allowed case ("that is the orchestrator").
        // It is how #2524 and #2526 moved `main` under sessions that were
        // mid-gate on 2026-08-18: the gate mutex covers gating, `land` extends
        // it over the merge, and a merge typed here takes no lock at all.
        const r = runHook(
            DENY_GUARD,
            bash("gh pr merge 123 --squash --delete-branch", mainCheckout)
        );
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/bun run land/);
    });

    it("denies it from an ordinary linked worktree as well", () => {
        const r = runHook(
            DENY_GUARD,
            bash("gh pr merge 123 --squash", linkedWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("points the caller at the merge-only retry, not at re-running the gate", () => {
        // The recovery instruction matters as much as the denial: a second
        // `bun run land` re-pays a full heavy gate on a tree that is unchanged
        // and already verified (#2536).
        const r = runHook(DENY_GUARD, bash("gh pr merge 123", mainCheckout));
        expect(r.stderr).toMatch(/pr-merge\.ts/);
    });

    it("allows it behind the explicit per-command hatch", () => {
        const r = runHook(
            DENY_GUARD,
            bash(
                "TOLARIA_ALLOW_MANUAL_MERGE=1 gh pr merge 123 --squash",
                mainCheckout
            )
        );
        expect(r.code).toBe(0);
    });

    it("requires the hatch in the SAME segment as the merge it authorises", () => {
        // A hatch set by an earlier, unrelated command in the chain must not
        // vouch for a merge further down: the opt-in names one command.
        const r = runHook(
            DENY_GUARD,
            bash(
                "TOLARIA_ALLOW_MANUAL_MERGE=1 echo hi && gh pr merge 123 --squash",
                mainCheckout
            )
        );
        expect(denied(r)).toBe(true);
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

describe("deny-guard — heredoc bodies are data, not commands (#2537)", () => {
    // A command carries text it does not run: commit messages, PR bodies,
    // patch scripts. Widening §1 to the whole machine made this bite — a
    // `python3 - <<'PY'` patch that MENTIONED the merge (the tests in this very
    // file do) was denied while it edited a test file.

    it("allows a patch script whose BODY names the merge", () => {
        const cmd = [
            "python3 - <<'PY'",
            's = open("hook-policy.test.ts").read()',
            // Whitespace before the phrase, so it really does reach §1's
            // regex — this is the line that got the real patch denied.
            "old = 'never passes --delete-branch to gh pr merge'",
            "s = s.replace(old, 'never passes --delete-branch')",
            "PY",
        ].join("\n");
        expect(runHook(DENY_GUARD, bash(cmd, mainCheckout)).code).toBe(0);
    });

    it("allows a commit message that discusses force-pushing main", () => {
        const cmd = [
            "git commit -F - <<'MSG'",
            "fix: explain why nothing here runs git push --force origin main",
            "and why no gate is ever piped: bun run test | tail -20",
            "MSG",
        ].join("\n");
        expect(runHook(DENY_GUARD, bash(cmd, mainCheckout)).code).toBe(0);
    });

    it("still sees a REAL command after the terminator — the stripper resumes", () => {
        // The failure that would matter: swallowing the rest of the script.
        const cmd = [
            "gh pr create --body-file - <<'EOF'",
            "some prose",
            "EOF",
            "gh pr merge 123 --squash",
        ].join("\n");
        expect(denied(runHook(DENY_GUARD, bash(cmd, mainCheckout)))).toBe(true);
    });

    it("handles the tab-stripping `<<-` form", () => {
        const cmd = ["cat <<-EOF", "\tgh pr merge 123", "\tEOF", "true"].join(
            "\n"
        );
        expect(runHook(DENY_GUARD, bash(cmd, mainCheckout)).code).toBe(0);
    });

    it("does NOT treat a here-string as a heredoc — the next line is a command", () => {
        // `<<<` has no body; consuming the following line would be a false
        // ALLOW on a real command.
        const cmd = ["cat <<<hello", "gh pr merge 123 --squash"].join("\n");
        expect(denied(runHook(DENY_GUARD, bash(cmd, mainCheckout)))).toBe(true);
    });

    it("does NOT read `<<` buried mid-line as an introducer", () => {
        // `echo 'a << b'` must not swallow everything up to a line reading
        // `b` — the same false-ALLOW direction as the here-string case.
        const cmd = ["echo 'shift a << b here'", "gh pr merge 123"].join("\n");
        expect(denied(runHook(DENY_GUARD, bash(cmd, mainCheckout)))).toBe(true);
    });

    it("leaves a command with no heredoc byte-identical to the guard's eyes", () => {
        // Regression on the filter itself: the shapes join-continued-lines.awk
        // depends on (trailing `|`, trailing `\`) must survive it, or §3's
        // pager gate silently stops seeing them.
        const cmd = "bun run test |\ntail -20";
        expect(denied(runHook(DENY_GUARD, bash(cmd, mainCheckout)))).toBe(true);
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

    // The regression that started this rewrite: § 3 used to deny by matching a
    // hardcoded allowlist of gate command NAMES. That list was already stale —
    // `land` and `docs:ship` both reach `scripts/gate.ts` (via `scripts/land.ts`
    // and `scripts/docs-lane.ts` → `check:docs`) and neither name was in it, so
    // both of these were run for real against the old guard and sailed through.
    it("denies `bun run land` and `bun run docs:ship` piped into a pager — both reach scripts/gate.ts and neither was on the old name-list", () => {
        for (const cmd of [
            "bun run land 2524 | tail -80",
            "bun run docs:ship 2>&1 | tail -25",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(denied(r), `expected DENY for: ${cmd}`).toBe(true);
        }
    });

    // The test that makes the enumerate-the-gates class extinct: a script name
    // nobody has written yet must still be denied when piped, because the rule
    // is now "deny by default", not "deny if it matches a known gate name". If
    // someone reintroduces a hardcoded gate-name allowlist, this goes red.
    it("fails CLOSED on an invented, non-existent script piped into a pager", () => {
        const r = runHook(
            DENY_GUARD,
            bash("bun run some:future:gate | tail -5", issueWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("honours the informational allowlist — these scripts' exit codes are never load-bearing", () => {
        for (const cmd of [
            "bun run cr 605.1a | head -20",
            "bun run findings | head",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(r.code, `expected ALLOW for: ${cmd}`).toBe(0);
        }
    });

    // #2527 F1: three ways to pipe a gate past this rule, found on review.
    // `|&` is the live one — it is exactly the shape of the incident that
    // started this file (`docs:ship 2>&1 | tail -25`), just spelled with
    // zsh's shorthand for `2>&1 |` instead of the two separate tokens.
    it("denies `bun run test |& tail -20` — `|&` is zsh's `2>&1 |`, not a separate operator the old pattern could ignore", () => {
        const r = runHook(
            DENY_GUARD,
            bash("bun run test |& tail -20", issueWorktree)
        );
        expect(denied(r), `expected DENY for: bun run test |& tail -20`).toBe(
            true
        );
    });

    it("denies a backslash-continued gate pipeline — one pipeline split across two lines is still one pipeline", () => {
        const cmd = "bun run test \\\n  | tail -20";
        const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
        expect(denied(r), `expected DENY for: ${JSON.stringify(cmd)}`).toBe(
            true
        );
    });

    it("denies a non-allowlisted `bun run` even when a LATER allowlisted one shares the pipeline", () => {
        // The old extraction was a single greedy regex match, which picks up
        // the LAST `bun run` in the segment — an allowlisted name at the tail
        // (`cr`) laundered the non-allowlisted one ahead of it (`test`).
        const r = runHook(
            DENY_GUARD,
            bash("bun run test | bun run cr | tail", issueWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("still allows an all-informational multi-`bun run` pipeline piped into a pager", () => {
        const r = runHook(
            DENY_GUARD,
            bash("bun run cr 605.1a | bun run findings | tail", issueWorktree)
        );
        expect(r.code).toBe(0);
    });

    // #2527 F2: `format` (prettier --write) is a daily-reflex pipe into a
    // pager and a parse error is loud regardless; `telemetry:ingest` WRITES
    // telemetry.db and its exit code plausibly matters, so it defaults
    // fail-closed like any other writer.
    it("allows `bun run format` piped into a pager — informational, thousands of lines is the normal case", () => {
        const r = runHook(
            DENY_GUARD,
            bash("bun run format | tail -5", issueWorktree)
        );
        expect(r.code).toBe(0);
    });

    it("denies `bun run telemetry:ingest` piped into a pager — it writes telemetry.db, exit code matters", () => {
        const r = runHook(
            DENY_GUARD,
            bash("bun run telemetry:ingest | tail -5", issueWorktree)
        );
        expect(denied(r)).toBe(true);
    });
});

// PR #2527 round 2: the FIX for the backslash-join (the `sed -e :a -e
// '/\\$/N; s/\\\n/ /; ta'` above) was itself a fail-open regression on this
// machine's `sed` (BSD): `N` on the LAST line, with nothing to append, quits
// WITHOUT printing the pattern space — so a command whose FINAL physical line
// ends in `\` (a normal, working shell command: an unpaired trailing `\`
// before EOF is just a literal backslash argument) collapsed `_cmd_joined`
// to empty, which emptied `segments`, which made every rule below it —
// §1 `gh pr merge`, §2 force-push main, §3 this pager gate, §4 discarding
// git, §5 MAX_PASSES — match nothing. One trailing backslash turned a
// fail-closed guard fully fail-open. Replaced with `awk`, which has no
// last-record special case.
describe("deny-guard — the backslash-continuation joiner (awk, not sed)", () => {
    it("denies `bun run test | tail -20; : \\` — final line ends in a bare backslash with nothing after it", () => {
        // This exact payload ALLOWED (code 0) against the sed joiner: proven
        // by re-running it through the pre-fix script (`git show HEAD:` of
        // this file) with the SAME harness — 0 before, 2 after.
        const r = runHook(
            DENY_GUARD,
            bash("bun run test | tail -20; : \\", issueWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("denies `gh pr merge 123 --squash; echo \\` — same shape, through §1 instead of §3", () => {
        const r = runHook(
            DENY_GUARD,
            bash("gh pr merge 123 --squash; echo \\", issueWorktree)
        );
        expect(denied(r)).toBe(true);
        // §1's message names the one sanctioned path since #2537.
        expect(r.stderr).toMatch(/bun run land/);
    });

    it("still denies force-push-main past an unrelated mid-line backslash — the joiner does not corrupt segments it should leave alone", () => {
        // Retitled (round 3 review): this asserts a DENY, not byte
        // identity — it never compares the joined command to the input.
        // Mid-line backslashes (a Windows path in an echoed string) sit
        // nowhere near a line boundary; the joiner must leave them alone and
        // the underlying force-push-main detection must still fire on the
        // real trailing violation. The actual byte-identity property — a
        // command with no trailing continuation of either shape survives
        // the joiner unchanged — is asserted directly, corpus-wide, in
        // "the joiner is byte-identity for anything it doesn't join" below.
        const cmd =
            "echo 'building C:\\\\Users\\\\test' && git push --force origin main";
        const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
        expect(denied(r)).toBe(true);
        expect(r.stderr).toMatch(/force-push/);
    });

    it("joins `\\<CR><LF>` exactly like `\\<LF>` — a wrapped gate pipeline saved with CRLF line endings is still one pipeline", () => {
        // F1-b from round-2 review: the sed joiner's `/\\$/` never matches
        // with a trailing \r in the way, so a CRLF-saved continuation sailed
        // through unjoined. Re-run against the pre-fix script: ALLOWED.
        const cmd = "bun run test \\\r\n  | tail -20";
        const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
        expect(denied(r), `expected DENY for: ${JSON.stringify(cmd)}`).toBe(
            true
        );
    });

    it("does NOT join an escaped (even-count) trailing backslash — split pieces that are each safe alone must stay split", () => {
        // F1-c: `origin\\` ends in TWO literal backslash characters (one
        // escaped backslash, not a continuation marker). Naively joining on
        // "ends in \" regardless of parity welds this into
        // `git push --force origin\ main`, a false force-push-to-main deny —
        // confirmed against the pre-fix script: DENIED. Neither physical
        // line is dangerous on its own: line 1 never names `main`/`master`,
        // line 2 is just the bareword `main`.
        const cmd = "git push --force origin\\\\\nmain";
        const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
        expect(r.code, `expected ALLOW for: ${JSON.stringify(cmd)}`).toBe(0);
    });

    it("still joins the genuine odd-count case of the same shape — one backslash, not two, IS a continuation", () => {
        // Paired with the previous test, differing only in backslash count:
        // proves the parity check cuts both ways, not just fail-safe-by-
        // never-joining.
        const cmd = "git push --force origin\\\nmain";
        const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
        expect(denied(r), `expected DENY for: ${JSON.stringify(cmd)}`).toBe(
            true
        );
    });
});

// Round 3 review, #2527 §1: the joiner's own header comment asserts "a
// command with none of the above [backslash continuation / trailing
// operator] passes through unchanged" — nothing checked that claim, and the
// test whose TITLE claimed to ("passes an ordinary command through
// unchanged…", above) asserts a DENY and never compares a single byte. This
// is the real assertion: feed a corpus of ordinary commands through the
// SAME joiner the hook runs (`runJoinerAsHookWould`, `awk -f` on
// `join-continued-lines.awk`) and assert output === input, byte for byte.
describe("deny-guard — the joiner is byte-identity for anything it doesn't join", () => {
    const IDENTITY_CORPUS: Record<string, Buffer> = {
        "plain single-line command": Buffer.from("echo hello world", "utf8"),
        "ordinary multi-line command, no continuation of either shape":
            Buffer.from("echo one\necho two\necho three", "utf8"),
        "embedded quotes, dollar-sign and backticks": Buffer.from(
            "echo 'it'\\''s a test' \"quoted $VAR\" `date`",
            "utf8"
        ),
        globs: Buffer.from("ls *.ts src/**/*.tsx", "utf8"),
        "accented unicode": Buffer.from("echo café résumé", "utf8"),
        "CJK unicode": Buffer.from("echo 日本語のテスト", "utf8"),
        "emoji unicode": Buffer.from("echo 🎉🔥🚀", "utf8"),
        "a CR mid-line, not at any line boundary": Buffer.from(
            "echo foo\rbar baz",
            "utf8"
        ),
        "a lone CR at the very end of input, with no trailing LF at all":
            Buffer.from("echo hi\r", "utf8"),
        "a full CRLF document, every line, no final trailing newline":
            Buffer.from("echo one\r\necho two\r\necho three", "utf8"),
        "interior blank lines": Buffer.from("echo one\n\n\necho two", "utf8"),
        "tabs and trailing spaces, none of it at a line-ending operator":
            Buffer.from("echo\thello\t  ", "utf8"),
        "mid-line backslashes, nowhere near end-of-line": Buffer.from(
            "echo 'C:\\Users\\test' && echo done",
            "utf8"
        ),
        "even-count trailing backslash run (escaped, not a continuation)":
            Buffer.from("echo foo\\\\", "utf8"),
        "jq brace soup": Buffer.from(
            "cat data.json | jq -r '.[] | {a: .b, c: [1,2,3]} | tostring'",
            "utf8"
        ),
        "invalid UTF-8 bytes": Buffer.concat([
            Buffer.from("echo ", "utf8"),
            Buffer.from([0xff, 0xfe, 0x80, 0x81, 0xc3, 0x28]),
            Buffer.from(" done", "utf8"),
        ]),
        "a 200k-character single line": Buffer.from(
            "echo " + "x".repeat(200_000),
            "utf8"
        ),
        "a 5,000-line heredoc": Buffer.from(
            "cat <<'EOF'\n" +
                Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n") +
                "\nEOF",
            "utf8"
        ),
    };

    for (const [label, input] of Object.entries(IDENTITY_CORPUS)) {
        it(`round-trips unchanged: ${label}`, () => {
            const output = runJoinerAsHookWould(input);
            expect(
                Buffer.compare(output, input),
                `expected byte-identical output for ${label} ` +
                    `(input ${input.length}B, output ${output.length}B)`
            ).toBe(0);
        });
    }

    // The negative control — proves the corpus above is actually
    // discriminating and not vacuously identical for every input. Anything
    // ending in a bona fide continuation MUST change.
    it("does NOT pass through a genuine continuation unchanged — the corpus above is not vacuous", () => {
        for (const input of [
            Buffer.from("bun run test \\\n  | tail -20", "utf8"),
            Buffer.from("bun run test |\ntail -20", "utf8"),
        ]) {
            const output = runJoinerAsHookWould(input);
            expect(Buffer.compare(output, input)).not.toBe(0);
        }
    });
});

// Round 3 review, #2527 §2: "same evasion class as the `\` hole this PR
// closed, one shape over." A line ending in a shell operator (`|`, `||`,
// `&&`, `&`) is a continuation exactly as `\` is — real bash waits for the
// next line to complete the pipeline — but the segment splitter used to
// treat the bare newline as a separator regardless, so a gate and its pager
// landed in different segments whenever the wrap used an operator instead
// of a backslash.
describe("deny-guard — a trailing shell operator is a continuation too (§2)", () => {
    it("denies `bun run test |` wrapped onto the next line — the pipe is what actually matters", () => {
        // This is the shape that matters: joining is what puts the pager
        // back in the SAME segment as the gate feeding it. Before this fix,
        // this payload allowed (code 0) for exactly the reason the
        // backslash hole did: the bare newline split it into two segments,
        // neither of which contained both the gate and the `|`.
        const cmd = "bun run test |\ntail -20";
        const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
        expect(denied(r), `expected DENY for: ${JSON.stringify(cmd)}`).toBe(
            true
        );
    });

    it("still ALLOWS `bun run test &&` wrapped onto the next line — joining `&&` is a deliberate no-op for this rule", () => {
        // `&&` (and `||`) never hides a red suite as green the way `|`
        // does: if `bun run test` fails, the chain's own exit code is
        // test's failure code and `tail -20` never even runs — nothing
        // about a pager's always-0 exit is in play. The segment splitter
        // re-splits on a literal `&&` substring regardless of whether this
        // joiner glued the physical lines back together first (it looks for
        // `&&` in the joined text, not at a former newline boundary), so
        // there is no `|` in either resulting segment and §3 correctly
        // does not fire. Joining `&&` still happens (uniform rule, cheaper
        // to state than "three of the four operators"), it is simply inert
        // here — proven by asserting ALLOW, not just "did not crash".
        const cmd = "bun run test &&\ntail -20";
        const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
        expect(r.code, `expected ALLOW for: ${JSON.stringify(cmd)}`).toBe(0);
    });

    it("a benign trailing-operator wrap of a NON-gate command does not blow up", () => {
        for (const cmd of [
            "git log --oneline |\nhead -20",
            "gh issue list |\ntail -20",
            "echo one &&\necho two",
            "echo one ||\necho two",
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, issueWorktree));
            expect(r.code, `expected ALLOW for: ${JSON.stringify(cmd)}`).toBe(
                0
            );
        }
    });

    it("does NOT join a trailing `;` — it genuinely terminates a command, unlike the four operators above", () => {
        const cmd = "echo hi;\necho bye";
        const output = runJoinerAsHookWould(Buffer.from(cmd, "utf8"));
        // Identity, not merely "still two lines": proves the raw newline
        // survives untouched, the same guarantee the byte-identity corpus
        // above makes for every other non-continuation shape.
        expect(output.toString("utf8")).toBe(cmd);

        const r = runHook(
            DENY_GUARD,
            bash("bun run test;\ntail -20", issueWorktree)
        );
        expect(r.code, "`;` must not join a gate into a pager segment").toBe(0);
    });

    it("a trailing bare `&` (backgrounding) can only ever produce a false DENY, never a false ALLOW", () => {
        // Documented tradeoff (§2 review): `&` is not really a line
        // continuation in real shell semantics, but joining it can only
        // ADD matchable surface to a segment, never remove any — so a
        // benign background job ahead of an unrelated benign command still
        // allows...
        const benign = runHook(
            DENY_GUARD,
            bash("sleep 1 &\necho done", issueWorktree)
        );
        expect(benign.code, "benign background wrap must still ALLOW").toBe(0);

        // ...while a background job ahead of a genuine violation still
        // denies (merging can only strengthen a match, matching the
        // documented one-directional risk).
        const dangerous = runHook(
            DENY_GUARD,
            bash("sleep 1 &\ngit push --force origin main", mainCheckout)
        );
        expect(denied(dangerous)).toBe(true);
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

describe("deny-guard — a leading `cd` names the directory the rules judge", () => {
    it("allows a discarding op in a worktree reached by `cd`, from a session sitting in main", () => {
        // The normal shape now that every authored file belongs in a worktree.
        // Judging it by the session's cwd denied a legal stash.
        for (const cmd of [
            `cd ${linkedWorktree} && git stash`,
            `cd ${linkedWorktree} && git reset --hard origin/main`,
            `cd '${linkedWorktree}' && git checkout -- file.ts`,
        ]) {
            const r = runHook(DENY_GUARD, bash(cmd, mainCheckout));
            expect(r.code, `expected ALLOW for: ${cmd}\n${r.stderr}`).toBe(0);
        }
    });

    it("DENIES a discarding op that `cd`s INTO the main checkout from a worktree", () => {
        // The half that matters more: this used to be allowed, because the
        // payload said "worktree" while the command operated on the shared tree.
        const r = runHook(
            DENY_GUARD,
            bash(`cd ${mainCheckout} && git reset --hard`, linkedWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("resolves a RELATIVE cd against the session's cwd", () => {
        const r = runHook(
            DENY_GUARD,
            bash("cd ../repo && git stash", linkedWorktree)
        );
        expect(denied(r)).toBe(true);
    });

    it("ignores a cd to somewhere that does not exist, rather than guessing", () => {
        const r = runHook(
            DENY_GUARD,
            bash("cd /nope/nowhere && git stash", mainCheckout)
        );
        expect(denied(r), "still judged by the session cwd").toBe(true);
    });

    it("only reads a LEADING cd — a buried one is out of scope", () => {
        const r = runHook(
            DENY_GUARD,
            bash(`echo hi && cd ${linkedWorktree} && git stash`, mainCheckout)
        );
        expect(denied(r)).toBe(true);
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

    it("records EVERY issue of a batch claim, not just the first", () => {
        // A batch is claimed in one Bash call. The single-`sed` version
        // captured only the first number, so the rest never reached the ledger
        // and claim-sweep could not release them. Observed 2026-08-17: a
        // headless pass claimed #2445/#1969/#1851/#1852, died, and left all
        // four labelled in-progress with no branch, no PR and no ledger row —
        // invisible to the sweep and skipped by every later pass thereafter.
        const dir = fs.mkdtempSync(
            path.join(os.tmpdir(), "hook-ledger-batch-")
        );
        const rows = (cmd: string) => {
            runHook(CLAIM_LEDGER, bash(cmd, "/x", "sess-B"), {
                CLAUDE_PROJECT_DIR: dir,
            });
            const file = path.join(dir, ".claude", "telemetry", "claims.jsonl");
            const out = fs
                .readFileSync(file, "utf8")
                .trim()
                .split("\n")
                .map((l) => (JSON.parse(l) as { issue: number }).issue);
            fs.rmSync(file);
            return out.sort((a, b) => a - b);
        };

        // one edit, several issues
        expect(
            rows("gh issue edit 2445 1969 1851 1852 --add-label in-progress")
        ).toEqual([1851, 1852, 1969, 2445]);

        // chained edits, one per issue
        expect(
            rows(
                "gh issue edit 2445 --add-label in-progress && " +
                    "gh issue edit 1969 --add-label in-progress"
            )
        ).toEqual([1969, 2445]);

        // `#`-prefixed, and a non-claim edit in the same command must not ride along
        expect(
            rows(
                "gh issue edit #2445 --add-label in-progress; " +
                    "gh issue edit 777 --add-label needs-design"
            )
        ).toEqual([2445]);

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("never blocks — it is an observer", () => {
        const r = runHook(CLAIM_LEDGER, bash("rm -rf /", "/x"), {
            CLAUDE_PROJECT_DIR: projectDir,
        });
        expect(r.code).toBe(0);
    });
});

describe("claim-ledger — joins a claim to the plan in force (issue #2518)", () => {
    // Observed 2026-08-17: a batch ran while 43 prioritized issues sat ready,
    // and the claim rows carried nothing that could tell "planned" from
    // "hand-picked" apart. `queue-plan.ts` now writes one artefact per run to
    // `.claude/telemetry/plans/<session>-<epoch-ms>.json`; this hook is the
    // other half — every claim row must name that artefact (or its absence)
    // and flag, never block, a claimed issue the plan did not admit.
    let projectDir: string;

    const ledger = () =>
        path.join(projectDir, ".claude", "telemetry", "claims.jsonl");

    const lastRow = () => {
        const lines = fs.readFileSync(ledger(), "utf8").trim().split("\n");
        return JSON.parse(lines[lines.length - 1]);
    };

    /** Write a plan artefact in the exact shape `buildPlanRecord` produces —
     *  this hook parses it with `jq` against that contract. */
    const writePlan = (
        session: string,
        epochMs: number,
        admittedNumbers: number[]
    ) => {
        const dir = path.join(projectDir, ".claude", "telemetry", "plans");
        fs.mkdirSync(dir, { recursive: true });
        const record = {
            version: 1,
            session,
            ts: new Date(epochMs).toISOString(),
            noPriority: false,
            plan: {
                version: 1,
                batch: admittedNumbers.map((number) => ({
                    number,
                    title: `issue ${number}`,
                    type: "fix",
                    model: "sonnet",
                    hitl: false,
                    targetFiles: [],
                    blastRadius: "unknown",
                    reason: "admitted",
                })),
                deferred: [],
                skipped: [],
                staleClaims: [],
            },
        };
        fs.writeFileSync(
            path.join(dir, `${session}-${epochMs}.json`),
            JSON.stringify(record)
        );
    };

    const claim = (issueNumber: number, session: string) =>
        runHook(
            CLAIM_LEDGER,
            bash(
                `gh issue edit ${issueNumber} --add-label in-progress --add-assignee @me`,
                "/x",
                session
            ),
            { CLAUDE_PROJECT_DIR: projectDir }
        );

    beforeAll(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-plan-"));
    });

    it("names the plan and reports no mismatch when the claim was admitted", () => {
        writePlan("sess-match", 1_000, [2511]);
        const r = claim(2511, "sess-match");
        expect(r.code).toBe(0);
        expect(lastRow()).toMatchObject({
            issue: 2511,
            session: "sess-match",
            plan: "sess-match-1000.json",
            planMismatch: null,
        });
    });

    it("flags — but does not block — a claim absent from the plan's admitted batch", () => {
        writePlan("sess-mismatch", 1_000, [2511]);
        const r = claim(1852, "sess-mismatch");
        expect(r.code).toBe(0); // report, never block
        expect(lastRow()).toMatchObject({
            issue: 1852,
            session: "sess-mismatch",
            plan: "sess-mismatch-1000.json",
            planMismatch: { claimed: 1852, planned: [2511] },
        });
        // "loudly" — the flag is visible in real time, not just on disk.
        expect(r.stderr).toMatch(/mismatch/i);
        expect(r.stderr).toMatch(/#1852/);
        expect(r.stderr).toMatch(/2511/);
    });

    it("records an explicit `plan: null` marker when no plan preceded the claim", () => {
        const r = claim(700, "sess-no-plan");
        expect(r.code).toBe(0);
        expect(lastRow()).toMatchObject({
            issue: 700,
            session: "sess-no-plan",
            plan: null,
        });
        expect(r.stderr).toMatch(/no preceding plan/i);
    });

    it("joins to the LATEST plan when a session has replanned", () => {
        // A same-pass replan (TOLARIA_ALLOW_REPLAN=1, deny-guard.sh §5)
        // produces a second, newer artefact for the same session. The hook
        // must compare against that one, not the stale first pass.
        writePlan("sess-replan", 1_000, [1111]);
        writePlan("sess-replan", 2_000, [2222]);
        const r = claim(2222, "sess-replan");
        expect(r.code).toBe(0);
        expect(lastRow()).toMatchObject({
            issue: 2222,
            session: "sess-replan",
            plan: "sess-replan-2000.json",
            planMismatch: null,
        });
    });

    it("does not mistake a different session's plan for its own", () => {
        writePlan("sess-owner", 1_000, [3333]);
        const r = claim(3333, "sess-stranger");
        expect(r.code).toBe(0);
        expect(lastRow()).toMatchObject({
            issue: 3333,
            session: "sess-stranger",
            plan: null, // sess-owner's plan is not sess-stranger's plan
        });
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
