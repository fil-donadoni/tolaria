# A RED release verdict starts a bounded fix loop; the fixer's return channel is a file, fail-closed, and only with a TTY

## Status

accepted (extends ADR 0116's release gate; PRD issue #3197, slices #3199,
#3200, #3201)

## Context

ADR 0116 made `bun run release` the one place the full offline gate runs, and
a RED verdict on the base tip refuses the promotion. That refusal is correct —
a red tip must never reach the release branch — but it was where the workflow
ended: the maintainer got a log path and did the same five steps by hand every
time (read the log, reproduce the failing step, diagnose, fix forward with a
guard, land, re-run `release`). Issue #3187 is the worked example: five ENOENT
failures in one test, ~40 minutes of a session, a two-line fix.

The cost is not the fixing. It is that the release stalls at the moment the
maintainer has already decided to ship, and the RED marker is durable —
everything downstream (`land` warns, `loop-drain.sh` stops) stays blocked until
a human sits down with the log.

Automating the repair means spawning an agent from a script, and that raises
three questions a script cannot answer by convention:

- **How does the spawner learn what happened?** An interactive `claude` exits
  0 whatever happened inside it — a completed repair, an abandoned one, a
  session the maintainer closed with `Ctrl-D`. The process exit status carries
  no verdict.
- **When must it refuse to spawn at all?** The session that discovered issue
  #3187 ran `release` from inside another Claude session. A fixer spawned there
  would have grilled into a pipe and hung the run — an observed hole, not a
  hypothetical one.
- **How many rounds?** The health gate stops at its FIRST failing step and
  `bun run test` runs its three suites in series, so a tip can be legitimately
  red at `test:app` and then again at `test:bot` with no error by the fixer.
  One round is too few. Unbounded, a fixer oscillating between two repairs
  burns 13-minute gates all night.

## Decision

1. **A RED verdict starts a repair, not a report.** Per round, `release`
   gates the `origin/<base>` tip, and when it refuses _specifically_ because
   the verdict is RED — with a terminal, and rounds remaining — it hands the
   tip to `bun run health:fix`, which spawns an interactive session on the
   `/health-fix` skill. On a `landed` verdict the base branch has moved, so the
   tip is re-read from the remote before the next round; the sha is new, so
   `health-main.ts`'s own sha-dedup does not short-circuit the next gate.
   `bun run health:fix` is also the manual entry point: it clears a RED marker
   with no release in sight.

2. **The return channel is a FILE, not an exit code.** `/health-fix` writes
   `.claude/telemetry/health/fix-verdict.json` (`{ sha, outcome, pr?, note? }`)
   in the **primary checkout** as its last act, beside `last.json` and the
   `RED` marker — `land` deletes the worktree the fixer was standing in, and
   the telemetry directory is gitignored, so authoring there is not the
   shared-checkout write `deny-guard.sh` § 0 refuses. The spawner deletes any
   verdict from an earlier round before spawning, so a stale file cannot be
   read as this round's answer.

3. **Verdict parsing is fail-closed.** Anything that is not an unambiguous
   `landed` about the sha we asked about reads as `stuck`: no file, unparsable
   JSON, a non-object, a missing sha, an unknown `outcome`, or a verdict about
   a different sha. The alternative fails open — it promotes a tip nobody
   fixed — and a crashed fixer is exactly the case that produces no file. A
   `stuck` verdict leaves the RED marker standing, because the durable signal
   must keep reflecting reality.

4. **No TTY, no spawn.** `health:fix` refuses when `stdin` is not a terminal
   and prints the command to run by hand instead. `/health-fix` is required to
   grill on ambiguity, one question per turn; without a human to answer, the
   first question hangs the run. The refusal order puts the TTY check LAST, so
   a tree with nothing red answers "nothing to fix" and exits 0 even
   unattended — telling a cron job to open a terminal for a green tree would
   be noise. The other four refusals: no `RED` marker (exit 0, and decided from
   a local file with no fetch), a marker with no health record behind it, a
   record about another sha, and a record that is `running` (another gate owns
   that sha and must not be raced) or `green` (the marker is stale).

5. **The bound is three rounds, and `--no-fix` restores the old behaviour.**
   One round is one gate plus at most one fix. Three, because consecutive
   legitimate reds are normal — the gate stops at its first failing step.
   Bounded, because oscillation is not. `--max-fix-attempts=N` moves the bound
   and refuses anything below 2: a bound of 1 leaves no round to re-gate a fix,
   which is `--no-fix` wearing a number. When the loop gives up it prints what
   every round attempted, then today's refusal line verbatim.

6. **`loop-drain.sh` keeps stopping on RED.** Authorising an _unattended_
   fixer is a separate decision with a different risk profile — an overnight
   run would start spawning sessions nobody authorised, on a budget nobody
   sized for them (ADR 0109) — and the TTY rule of §4 would refuse it anyway.
   The AFK driver's behaviour is unchanged: RED stops the drain, and a human
   runs `bun run health:fix`.

7. **The loop's decision is a pure function.** `spawnDecision` in
   `scripts/health-fix.ts` and `loopDecision` in `scripts/release.ts` take
   their inputs as data, so every branch — refuse, fix, retry, stop — is
   enumerable in a test rather than reachable only by running a real gate.

This extends ADR 0116 rather than replacing its invariant: the release branch
still moves only to a health-proven base tip, by fast-forward, and only a GREEN
record about exactly that sha promotes it.

## Consequences

- From the maintainer's seat the RED path becomes: run `bun run release`,
  answer questions if asked, watch it land and promote. From an unattended
  seat, nothing changes — no TTY means no spawn.
- A `stuck` outcome is a first-class result, not a failure of the mechanism:
  the fixer is required to declare it rather than land a repair it does not
  believe in, and the marker survives for the human.
- The worst case is three health gates plus three fixer sessions before the
  handover, which is the price of not stalling on the common case; `--no-fix`
  buys the cheap refusal when only the state is wanted.
- Every fix ships a test that closes the CLASS of the failure and lands
  through `bun run land` like any other PR — the fixer has no privileged path
  onto the base branch, and never reverts.
