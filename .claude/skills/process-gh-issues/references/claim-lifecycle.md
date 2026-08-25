# The life of a claim

An issue is **claimed** by putting `in-progress` on it, and the claim must come
off on every exit path. This file is the single description of how that happens,
because it did not have one: five mechanisms were built at different times, each
inventing its own answer to "is this claim still alive?", and the disagreement
between them is what stranded eight claims — four of them `P0` — for 25–36 hours
on 2026-08-20 while a driver ran continuously past them.

## Who takes a claim off, and when

| Mechanism                             | Runs                                                    | Scope                        | Releases                                      |
| ------------------------------------- | ------------------------------------------------------- | ---------------------------- | --------------------------------------------- |
| SKILL.md § Release                    | end of every pass                                       | that pass's own batch        | everything it claimed, on every exit path     |
| `.claude/hooks/claim-sweep.sh`        | `SessionEnd`                                            | what the ledger says WE took | what this session claimed and did not release |
| **`bun run loop:doctor --release`**   | **SKILL.md §1a**, and `loop-drain.sh` before every pass | **every claim on the board** | **any claim nothing is going to release**     |
| `staleClaims` in `bun run queue:plan` | batch planning                                          | `ready-for-agent` only       | nothing — it only reports                     |

The first two are **best-effort and cannot be relied on**, which is the whole
reason the third exists:

- § Release only runs on a path that executes. A pass killed mid-flight never
  reaches it — and being killed mid-flight is exactly when it matters.
- `claim-sweep.sh` fires on `SessionEnd`, which a killed process does not
  reach either, and it can only ever release what its own ledger recorded.

`loop:doctor` is therefore the **authority**, and §1a runs it on every pass:
unconditionally, before selection, whether or not the planner is used. Everything
else is a safety net under it.

**Under the AFK driver it is not left to the pass to remember (#2627).**
`scripts/loop-drain.sh` runs the sweep itself at the top of each iteration,
before it counts the queue and before it spawns the pass. Ordering is
load-bearing in both directions: after the count, a reclaimed issue would not be
selectable until the NEXT pass, and worse, a driver whose queue reads empty stops
the whole run — which is the 2026-08-19 incident, where two orphaned roots froze
nine children and the driver quit with `queue-empty` on a queue the sweep would
have refilled. The driver contains no claim rule of its own: it invokes
`loop-doctor.ts --release` and reports what came back.

## Why it is NOT part of the planner

It used to be, as a by-product: `planBatch` walked the queue and reported stale
claims under `staleClaims`. That coupled _release dead claims_ to _build a
batch_, and both holes were measured the same day:

1. **A pass that skips the planner sweeps nothing.** An armed AFK conf can carry
   a SCOPE OVERRIDE prompt telling the pass to assemble the batch itself (see
   §1's no-planner fallback, and the `--prompt` in `.claude/telemetry/afk.conf`).
   Those eight claims sat there because the driver's own prompt had opted out of
   the only code path that could free them.
2. **The planner only queries `ready-for-agent`.** A claim stripped of that label
   after it was taken is invisible to it at any cadence.

`staleClaims` survives as a second opinion, and a **weaker** one: it has no
branch scan, so it can call dead a claim whose branch was pushed. Where the two
disagree, `loop:doctor` wins.

## What "alive" means

`classifyClaim` in `scripts/loop-doctor.ts`, in order:

| Fact                             | Verdict | Why                                                        |
| -------------------------------- | ------- | ---------------------------------------------------------- |
| open PR for `feat\|fix/issue-N`  | live    | something downstream may still be holding it               |
| branch **on the remote**         | live    | the work left this machine                                 |
| **owning process still running** | live    | the claim's own pass is demonstrably still working (#2627) |
| branch **local only**, < 24h     | live    | a pass may legitimately implement for hours before pushing |
| branch **local only**, ≥ 24h     | orphan  | nothing here stays unpushed for a day                      |
| no branch at all, < 2h           | suspect | what a healthy pass looks like before `git worktree add`   |
| no branch at all, ≥ 2h           | orphan  | —                                                          |

**The local/remote split is the correction, and the reason this file exists.**
The rule used to be "any branch anywhere ⇒ live", which sounds conservative and
is not: a local branch outlives the process that made it, so a pass killed
mid-edit leaves its worktree and branch on disk **forever** and its claim reads
as live for as long as anyone cares to look. That is the shape of all eight.
`computeStage` in `scripts/lib/loop-status.ts` carried the same conflation and
reported dead work as "branch pushed"; it now reads `hasRemoteBranch` too.

The two thresholds are not interchangeable. A claim with no branch is either
seconds old or dead, and two hours separates them cleanly. A claim with a local
branch belongs to a pass that got as far as its worktree, so releasing it at two
hours would unclaim live work.

**Owner liveness is a veto, never a clock (#2627).** A claim journal row
(`.claude/telemetry/claims.jsonl`) now carries `owner: {pid, startedAt}`,
stamped by `claim-ledger.sh` at the moment of the claim — the session UUID is in
no argv and Claude Code holds no open descriptor on its own transcript, so the
join cannot be made after the fact and has to be recorded. `startedAt` exists to
defeat PID reuse: a recycled number is a different process. A POSITIVE liveness
reading holds a claim at any age; "dead" and "could not tell" both do nothing at
all, leaving the two thresholds above exactly as they were. No third threshold
was added, and none may be: this fact can only ever move a verdict towards
`live`, because the failure mode of the whole sweep is unclaiming a healthy
concurrent pass.

## What nobody may do

**Never release by assignee.** Every session runs under the same GitHub account,
so `--assignee @me` matches every session's claims equally and tells you nothing
about which one owns this issue. Ownership comes from the ledger (this session
recorded the claim) or from the branch/PR facts above — never from assignment.
This is also why a collision leaves the other session's label alone entirely
(`references/collisions.md`).

**Never release the label without the assignee.** `planBatch` defers an assigned
issue on its own branch ("assigned — someone is working it"), so dropping only
the label leaves the issue exactly as unreselectable as before while looking
like it worked. `loop:doctor --release` drops both, passing `--remove-assignee
@me` — correct here precisely BECAUSE every session shares one account, which
makes `@me` and "whoever claimed it" the same login. The residual edge: an issue
a human assigned to a DIFFERENT login keeps that assignment through a release
and stays deferred by the planner. Rare, visible on the board, and not worth
a second `gh` round-trip per claim to pre-empt.

## What a release does NOT touch

The **worktree and its uncommitted work.** Freeing a claim frees the board, never
the disk — and an orphan routinely holds real uncommitted work, since the pass
was mid-edit, which is usually why it is an orphan at all. Salvage or discard is
a human call; `bun run wt:gc` is the separate tool, and § Release is where the
worktree rules live.

Releasing a batch of orphans by hand: commit each worktree's WIP on its local
branch first (`--no-verify`, no push). Loose changes are volatile — `lint-staged`
stashes them on every commit anywhere in the repo, and a killed pass can leave
that stash half-restored, which is how one worktree ended up with unmerged index
entries and no merge in progress.
