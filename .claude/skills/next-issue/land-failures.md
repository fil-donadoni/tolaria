# /next-issue — `land`'s failure, retry and post-merge modes

Reached from `SKILL.md` § 5 when `land` returns anything but a merge, or
prints a warning. The command is always the identical
`TOLARIA_GATE_RUN_KEY=land-<PR#> bun run gate:run land <PR#>`, with the tool's
`timeout` at 600000ms; the run key is what lets it re-attach from any
directory after `land` has deleted the worktree.

## Exit codes

- **75 — still running.** Issue the identical command again, as many times
  as it takes, until an exit code comes back. Never end the turn on a 75.
- **77 — the MACHINE stayed saturated** past `machine.waitMaxS` (issue
  #4966): the gate held the mutex, waited, and ran NOTHING — not a gate
  failure, the PR is untouched. `bun run machine` names what is over;
  re-issue the identical command once it reads calm, and report it in § 6 as
  machine-saturated, never as a red lane.

## A red lane on a regenerable artefact

An oracle lockfile or catalogue hash that reds after the rebase is fixed in
THIS turn — run the regenerator in the foreground, commit, push, re-issue
`land` through `gate:run` — or reported as a failure in § 6. Never "waiting
for `oracle:compile`": a pass never ends its turn waiting.

## Retries do not pay the lane twice

`land`'s log says `lane: ran`, or `lane: skipped (gated <sha> against <base>)`
when that exact rebased tip was already gated green against that exact base —
so a `land` retried after a merge refusal re-uses the verdict. If only the
MERGE failed, retry `bun scripts/pr-merge.ts <PR#>`, then re-run `land`: on a
MERGED PR it only does housekeeping.

## Refusals and warnings

- **Health RED marker.** Read `bun run health:status` first: fixing the base
  tip comes before landing new work. Under RED `land` refuses a PR that is not
  a declared repair unless run with `--red-ok` — a session already mid-issue
  finishes as a stated, counted act (issue #4964).
- **Base is not the base branch.** `gh pr edit <PR#> --base <base>`, then
  re-issue.
- **`could not fast-forward local <base>`.** That line is the whole handover:
  say so in § 6. Never do the catch-up by hand — `land` owns pulling a
  checked-out local base branch and deleting the local branch.
- **`gaps:sync gets no --band (…)`.** `land` normally files the computed Gap
  issues under the band of the issue you closed (issue #4158); this line means
  the band could not be read. Say so in § 6 and move the new gaps yourself
  (`gh issue edit <gap> --parent <P0 umbrella>`; umbrellas in
  `docs/agents/issue-tracker.md`).

**Done when:** `land` exited 0 with the PR merged — or § 6 reports the
failure, naming the exit code and the line that carried it.
