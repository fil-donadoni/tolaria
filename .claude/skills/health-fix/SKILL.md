---
name: health-fix
description: Repair a RED base tip — reproduce the failing step in a detached worktree at that tip, fix it forward with a test that closes the CLASS of the failure, land through `bun run land`, and record the verdict the spawner reads back. Use when `bun run release` refuses on RED, when `bun run health:status` shows a standing RED marker, when `bun run health:fix` spawns a session, or when invoked as /health-fix <sha>.
argument-hint: "<base-tip-sha>"
---

# /health-fix — turn a RED verdict into a landed repair

`$1` is the base tip that went red. `bun run health:fix` passes it (PRD issue
#3197); typed by hand without it, read it from `bun run health:status` and
confirm it is the sha the RED marker names — never guess.

You were spawned because the full offline gate (ADR 0116) failed on that tip
and everything downstream is blocked: `release` refuses, `land` warns,
`loop-drain.sh` stops. Your deliverable is a landed fix **plus a test that
closes the class of the failure**, and a verdict file saying which.

## The four prohibitions — contract, not advice

1. **Never revert.** RED means fix-forward. No `git revert`, no re-opening a
   merged PR, in any mode. If the repair is not clear the outcome is `stuck`
   and the marker stays standing.
2. **Never invoke `bun run release`.** The loop belongs to the caller. A fixer
   that re-entered release would escape the bound on rounds.
3. **Grill on ambiguity, one question per turn.** You are interactive by
   construction — `health:fix` refuses to spawn without a TTY precisely so you
   can ask. Not being able to formulate the class guard is itself such an
   ambiguity.
4. **A green suite is not the deliverable.** The fix plus the class guard is.
   A red you made disappear without understanding is a `stuck`.

## 0. Read the verdict, not the whole log

The record `health-main.ts` left, in the **primary checkout**:

```bash
H=".claude/telemetry/health"
cat "$H/last.json"            # { sha, status:"red", failedStep, log, … }
```

`failedStep` is one of `worktree:init`, `check:all`, `test` — the gate stops at
the first one that fails. The log is appended per step and is large: read it
surgically, never `cat`.

```bash
L=$(jq -r .log "$H/last.json")
grep -nE '^===== |FAIL|✗|Error|error TS|failed' "$L" | head -40
```

Then `sed -n 'A,Bp' "$L"` around the hits. The log is where the failure was
observed once; it is **not** a diagnosis.

## 1. Reproduce — only the failing step, at that tip

A diagnosis rests on an observed red. Take a **detached** worktree at the tip,
exactly as the health gate does, and run **only the step that failed** — never
the whole gate (a full gate to diagnose one suite is the cost this skill
exists to remove).

```bash
W="../tolaria-health-repro-${1:0:8}"
git worktree add --detach "$W" "$1"
(cd "$W" && bun run worktree:init)      # `216 files failed, 0 tests failed` = you skipped this
```

Scrub any inherited gate hold before running the step —
`unset TOLARIA_GATE_HELD TOLARIA_ALLOW_FULL_SUITE` — so the step queues on the
machine mutex like any other, and narrow before you run:

| `failedStep`    | Run in the repro worktree                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worktree:init` | `bun run worktree:init` — bootstrap itself; usually a missing generated artifact or a dependency change                                                                       |
| `check:all`     | the **inner** script the log names (`lint`, `check:ts`, `check:index`, `check:stubs`, `check:oracle`, `check:bundle`, `check:convex-bundle`, `format:check`), not `check:all` |
| `test`          | the failing **file** first (`bunx vitest run <path>`, light tier), then its suite (`test:app` / `test:bot` / `test:blade`) only to confirm                                    |

Tear the worktree down when the diagnosis is done:
`git worktree remove --force "$W"`.

**The step passes at the tip?** Then the red was not in the tree — a flake,
machine state, a stale artifact. Do not invent a fix for something you never
saw fail: grill the maintainer with what you observed. That is an ambiguity,
and its likely outcome is `stuck`.

## 2. Diagnose, then ask or proceed

State the cause in one sentence and check it against the observed red. Grill
whenever the cause or the repair is genuinely ambiguous — two plausible causes,
a fix that trades one invariant for another, or a class you cannot yet name.
One question per turn, no previews.

## 3. Open a GitHub issue, take a worktree

Open a GitHub issue for the repair — the fix is traceable in the tracker like
every other change — with the standing sections: what to build, acceptance
criteria, and a **`Target files`** section, one path per line. Parent it to the
health PRD when the failure is about the gate itself; otherwise leave it
parentless. Do **not** label it `ready-for-agent` — you are implementing it in
this session, and the queue is drained, never filled.

```bash
gh issue create --title '…' --body '…' --label bug
cd "$(bun run --silent wt:new <N> --fix)"
```

The shared checkout is read-only (`deny-guard.sh` § 0); the repro worktree is
for reading, not for authoring.

## 4. The fix and the class guard — both proven

Two deliverables, and the second is the one nobody writes under the pressure of
an unblocked release:

- **the fix** — the instance that went red;
- **the class guard** — a test that fails for the _next_ instance of the same
  mistake, not merely for this one.

The worked example is issue #3187, the failure this whole feature came from.
`scripts/__tests__/preset-deck-seed.test.ts` read a **git-tracked** file
through `primaryCheckout()`, so its verdict depended on which branch a
_different directory_ had checked out: PR #3171 landed green at 00:42 with the
primary on `staging`; the primary moved to `main` at 13:17; the next gate went
red on the same untouched tip, five ENOENT failures. The instance fix was two
lines — resolve the root from the test's own location. The class guard is what
this skill makes non-optional: _nothing stops the next script making the same
call_, so a sweep asserting that no test resolves a git-tracked path through
`primaryCheckout()` is the deliverable, and it never shipped.

If you cannot formulate a class guard, that is prohibition 3: ask. A guard that
restates the instance is not a class guard.

**COMMIT BEFORE YOU BREAK ANYTHING.** Proof-of-failure means editing the
subject and reverting it, and `git checkout <file>` on a file with uncommitted
changes discards your implementation, not your break.

Prove **each** guard, the fix's and the class's:

1. commit the work;
2. break the subject — and **assert the patch applied** (`grep -c` the broken
   text) before believing either a red or a green: a substitution that matched
   nothing gives a vacuous pass;
3. run the targeted test, watch it go red;
4. revert, re-run, watch it go green;
5. **state what you broke**, in the PR body.

Re-run every proof after ALL edits are in: two fixes proven red in isolation
can defeat each other.

## 5. Land — through `land`, never by hand

```bash
G="$SCRATCHPAD/check-lane.log"
bun run check:lane >"$G" 2>&1; echo "exit=$?"; grep -E 'Tests|FAIL|✗' "$G"
gh pr create …            # base must be the base branch; `land` refuses otherwise
bun run land <PR#>
```

The PR body names: the step you reproduced and how, the cause, the fix, the
class guard, and what you broke to prove each. `land` rebases, re-gates under
the machine mutex and merges — a hand-typed `gh pr merge` is denied
(`deny-guard.sh` § 1).

**Never remove the `RED` marker by hand.** Only a green health run clears it,
and clearing it yourself is exactly the promotion-of-an-unfixed-tip this
protocol is fail-closed against.

## 6. The verdict — your last act, always

An interactive `claude` exits 0 whatever happened inside it, so the return
channel is a file. Write it in the **primary checkout** (the telemetry
directory is gitignored, so it is writable there), about the sha you were
**asked** about — `$1`, the red tip — never the new tip your landing created:

```bash
jq -n --arg sha "$1" --argjson pr <PR#> --arg note '<one line>' \
  '{sha:$sha, outcome:"landed", pr:$pr, note:$note}' \
  > /path/to/primary/.claude/telemetry/health/fix-verdict.json
```

`outcome` is `landed` or `stuck`, and nothing else — `parseVerdict` in
`scripts/health-fix.ts` is fail-closed: an absent file, unparsable JSON, an
unknown outcome or another sha all read as `stuck`.

- **`landed`** — the PR merged into the base branch. Only then.
- **`stuck`** — anything else: no reproduction, no class guard you believe in,
  a repair you would not defend, a grill the maintainer ended. Put the analysis
  in the issue (or print it if none was opened) and a one-line summary in
  `note`. The RED marker stays standing, which is the point: the durable signal
  keeps reflecting reality.

Then stop. One tip per invocation — the caller decides whether there is another
round.
