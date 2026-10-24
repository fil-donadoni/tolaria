# /next-ticket — a repair pick: the queue's lane went red

Reached from `SKILL.md` § 0 when the pick is `repair` (`queue:plan`'s
`repair[0]`, first of all picks), or from § 5 when `land:ready` refuses (its
preflight or pre-queue check red: the PR's own error, fixed in the authoring
session, never handed to the queue). The Mergify queue (the land-runner is
retired, issue #5643) rebased the PR in a draft, ran `check:lane` there, it
went red or the rebase conflicted, and the queue relabelled the PR
`ready-to-land` → `land-failed` with a comment carrying the reason. The
issue's claim still stands; `queue:claim N` takes it over.

## Read the failure first

**In an `afk-pass` job** the log is on GitHub, not on the MacBook: `job.md`
§ A repair pick (`gh run view --log-failed`).

`gh pr view <PR#> --comments --json comments --jq '.comments[-1].body'` — the
queue's comment: the failing check or the dequeue reason; the lane's log is
the check run it links.

## What each failure asks of the repair

- **A red lane.** The rebased tree fails a check. Fix it on the PR's branch
  (`wt:new N --resume` checked it out), re-run the failing tests targeted,
  commit, push.
- **A rebase conflict.** The queue could not rebase the PR onto the base.
  `git fetch origin && git rebase origin/<base>`, resolve, re-run the touched
  tests, `git push --force-with-lease`.
- **A regenerable artefact** (an oracle lockfile, a catalogue hash). Run the
  regenerator in the FOREGROUND, commit, push — never "waiting for
  `oracle:compile`": a pass never ends its turn waiting.
- **A refusal** — `land: refusing — <reason>`:
    - missing `## Preset scenario` or skin receipt → fix the PR body
      (`gh pr edit <PR#> --body-file …`);
    - base is not the base branch → `gh pr edit <PR#> --base <base>`;
    - the health gate is RED and this PR is not a declared repair → nothing
      to fix in the PR: the runner never labels this `land-failed` (it HOLDS
      the PR until AMBER/GREEN); if you see it, the lineage changed under the
      run — re-queue as below.

## Before the push: did the base move? (issue #6647)

A repair verifies for 20–60 min; 8 of them re-failed within 2 h because the
base moved under the verify. After the verification and BEFORE `git push`:
`bun run base:drift --pr <PR#>`.

- Exit 0 (base unmoved): push.
- Exit 3 (moved, nothing shared): `bun run base:drift --rebase`, then
  `git push --force-with-lease`. Re-verifying only what the base changed is
  a separate issue.
- Exit 4 (moved, an overlap or a coupled artefact): start the repair round
  again on the rebased tree — never push a tree known stale.

## Re-queue

`bun run land:ready <PR#>` — drops `land-failed`, adds `ready-to-land`, moves
the claim back to `pr-open`. On an UNCHANGED head after a Mergify dequeue the
dequeue reason is sticky and would relabel the PR `land-failed` within ~40 s,
so `land:ready` also posts `@mergifyio requeue` (no empty commit) and reads the
labels back: `land-failed` returning is a non-zero exit naming the
`.mergify.yml` rule (issue #6163). The queue retries it on its turn. That is
the end of the pass (`SKILL.md` § 5–§ 6).

## Not this pass's to fix

A failure the PR did not cause (the base tip is red, a flaky infra step):
say so in § 6, re-queue, and let health or the owner decide. Never silence a
test; "not my test" is no exemption (ADR 0116).

**Done when:** the fix is pushed and `land:ready` re-queued the PR — or § 6
reports the failure, naming the line of the runner's comment that carried it.

## `land:ready` refused: the pre-queue check (issue #5554)

`land:ready` runs the lane's seconds-cost steps on the PR's worktree before it
labels anything (`lib/pre-queue-steps.ts`: `check:lane`'s plan minus the
whole-project vitest runs and `check:pr`, plus the PR's own tests and the
structural guards a NEW file trips). Red → no `ready-to-land`, no `pr-open`
row: fix it in this session, commit, push, re-run. Only a red you KNOW is
base's: `TOLARIA_PREQUEUE_RED_OK=1 bun run land:ready <PR#>` — announced and
commented on the PR.
