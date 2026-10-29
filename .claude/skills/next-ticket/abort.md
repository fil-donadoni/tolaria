# /next-ticket — Abort

Reached from `SKILL.md` when this issue cannot land in this pass.

### Abort

An abort takes ONE of two branches, then releases. A suggestion in chat
("the owner should relabel this", "suggest: block on #M") is never an abort
on either branch: the issue stays `ready-for-agent`, the next pass re-picks
it and aborts again (issue #4752, issue #5564).

1. **Missing prerequisite — WIRED, never suggested.** When the session names
   work that must land first, link the existing issue — or file it
   (`/create-ticket`, then `filing.md` for its band) — and wire this issue
   `blocked-by` it in BOTH stores: the native edge
   (`gh issue edit N --add-blocked-by <M>`, read back) AND a `- #M — why`
   line under `## Blocked by` in the body. `bun run queue:lint N` must come
   back clean (its `dependency-parity` rule compares the two). **#M's board
   band is never lower than this issue's** (`triage-labels.md` § A blocker
   never sits in a lower band than what it blocks): read both, and if #M is
   lower, detach it from the lower-band parent and run
   `bun run issue:inherit-band N M`. `queue:plan` lifts a blocker at pick time
   too, but that is the fallback; the board is the record. `queue:lint`'s
   `blocker-band` rule flags a lower blocker.
2. **Owner work — handed back as `ready-for-human`.** When no agent can land
   the issue at all — a machine-local persistent install the classifier
   denies, a host this machine cannot reach, a product decision only the
   owner makes — relabel it in one call:
   `gh issue edit N --remove-label ready-for-agent --add-label ready-for-human`,
   read the labels back (`gh issue view N --json labels --jq '[.labels[].name]'`:
   `ready-for-human` present, `ready-for-agent` absent), and post ONE comment
   (`gh issue comment N`) saying why no agent can land it and exactly what
   the owner must do. Only the relabel takes it out of the queue.

**In an `afk-pass` job the release is the label** (`job.md` § Abort).

**Release as ONE act** — when the pass claimed it (`SKILL.md` § 2. Claim +
worktree) — then read the labels back:

```bash
gh issue edit N --remove-label in-progress --remove-label pr-open --remove-assignee @me
```

A `--remove-label in-progress` alone leaves the assignee, and the planner defers an assigned
issue as "someone is working it" on every pass, forever — `deny-guard.sh`
§ 6b denies it. Then remove the worktree.

**Done when:** prerequisite branch → `queue:lint N` is clean; owner-work
branch → the labels read back show `ready-for-human` and no
`ready-for-agent`, and the one comment is posted; either branch → if claimed,
the labels read back show no `in-progress` and the worktree is gone.
