# Sweeping dead claims

`bun run queue:sweep --release --pretty`, SKILL.md §1a. One `gh` list call plus
one edit per orphan. There is no cadence to tune and no pass where skipping it
is correct.

## Why it is not the planner's job

It used to be. The planner walked every `ready-for-agent` issue while building a
batch, and a stale `in-progress` one came back under `staleClaims` for the
orchestrator to release. That coupled _release dead claims_ to _build a batch_,
and the coupling has two holes. Both were measured on 2026-08-20:

1. **A pass that skips the planner sweeps nothing.** An armed AFK conf can carry
   a SCOPE OVERRIDE prompt telling the pass to assemble the batch itself — see
   SKILL.md §1's no-planner fallback, and the `--prompt` recorded in
   `.claude/telemetry/afk.conf`. Eight claims, four of them `P0`, sat orphaned
   for 25–36 hours while a driver ran continuously past them, because that
   driver's own prompt had opted out of the only code path that could free them.

2. **The planner only ever sees `ready-for-agent` issues.** A claim stripped of
   that label after it was taken is invisible to the planner's query at any
   cadence. `queue:sweep` queries `in-progress` instead — exactly the set of
   claims that exist.

**A stuck claim is worse than a lost one.** The issue reads as taken, so no pass
reselects it and nothing revisits the decision: it removes itself from the queue
permanently and silently, while the board still shows it as being worked. The
eight above were found only because a human noticed `in-progress` issues nobody
was touching.

## What `--release` removes

The `in-progress` label **and the assignee**. Both, always.

Dropping only the label would be a no-op wearing a success message: `planBatch`
defers an assigned issue on its own branch ("assigned — someone is working it"),
so the issue would stay exactly as unreselectable as before while the sweep
reported it freed. The logins come off the issue payload rather than `@me` — a
sweep may run from a different session than the one that crashed.

Without `--release` it reports and writes nothing. That is the mode for checking
whether the threshold is behaving, and reporting is the default deliberately:
the destructive direction is the one you type on purpose.

## What it does NOT touch

**Work left behind in an orphan's worktree.** The sweep frees the claim, never
the disk — an orphan routinely holds real uncommitted work (the crashed pass was
mid-edit, which is usually why it is an orphan at all). Salvaging or discarding
that is a human call, and SKILL.md § Release is where the worktree rules live.

If you are freeing claims by hand rather than through the script, commit the WIP
on its local branch first (`--no-verify`, no push). Loose changes in a worktree
are volatile: `lint-staged` stashes them on every commit anywhere in the repo,
and a killed pass can leave that stash half-restored.

## The rule itself

`isStaleClaim` in `scripts/lib/queue-plan.ts` — shared with the planner, so the
two can never disagree about what "dead" means:

- no open PR whose head branch is `feat/issue-N` / `fix/issue-N` (an open PR is
  the liveness signal: a pass can legitimately hold a claim for days while its
  PR waits at the merge-train), **and**
- `updatedAt` older than `STALE_CLAIM_HOURS` (24).

Breaking either half reds tests in both `queue-plan.test.ts` and
`queue-sweep.test.ts` — which is the point of the shared predicate, and the
proof that it is genuinely shared rather than copied.
