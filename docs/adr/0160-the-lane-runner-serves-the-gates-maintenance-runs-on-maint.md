# The `lane` runner serves the gates only: one, on the MacBook, one queue check at a time; every maintenance duty runs on a `maint` runner per machine; no third lane runner

## Status

**accepted** — owner's decisions of 2026-10-26 (issue #6653, comment of
2026-10-26). Amends ADR 0156 §3 (`max_parallel_checks: 2`, one speculative
check per machine → 1) and §7 (runner roles: `pass`, `lane`, `seed` →
`pass`, `lane`, `maint`, `seed`; one `lane` runner per machine → one, on the
MacBook). Keeps ADR 0159 § 2 (`bot-replay` pinned to the fast host) and
issue #5873's "no job requires one host" for every other duty. The Bot-play
replay's own diet is already shipped: sharded over worker threads (issue
#6686), the base plays only the misses after each merge (issue #6687),
health decoupled from it (issue #6990, ADR 0159); incremental replay stays
ruled out (ADR 0158 § 4).

## Context

Measured 2026-10-21 → 10-24 (issue #6653): the two `lane` runners
(`macbook-lane-1`, `huawei-lane-1`) served the merge queue, health, the RED
ladder, the Bot-play replay, housekeeping, `pr-refresh`, nightly, the weekly
report and the corpus re-pin. Both were busy at once 33 % of the time;
`queue-lane` waited for a runner > 60 s in 65 of 169 runs (p90 727 s, max
54 min); RED-ladder jobs waited 34 and 43 min (issue #6553). Since
2026-10-23 the replay (`derive:sync --replay-bot`, ~40 min, 8× in 24 h)
held the MacBook's lane runner most of the day.

Measured 2026-10-25 (owner): `huawei-lane-1` is 4–5× the MacBook on the
same lane — prettier 140 s vs 48, `tsc -b` 3 min vs 1:22, a scoped lane
14–40 min vs 3–8, `full` 49–58 vs 14. With `max_parallel_checks: 2` the
second draft CONTAINS the first: it cannot merge before it, so a slow
second runner sets the queue's pace instead of doubling it. Serial on the
MacBook at ~8 min per merge is ~7.5 merges/h, against the 2.9/h observed.

## Decision

1. **`lane` = the gates a merge or a verdict waits on, nothing else**:
   `queue-lane`, `health`'s `gate`, `release` — `LANE_JOBS` of the
   structure guard (`scripts/ci/workflow-structure.ts`). Rule `lane-role`
   refuses any other self-hosted job whose `runs-on` may reach a `lane`
   runner: it names the role, a runner group or a whole-label expression
   the guard cannot read, and no literal other role (a runner carries one
   role and `runs-on` needs every label, so a literal `pass`/`maint`/`seed`
   rules the lane runner out). The RED ladder already runs on `pass`
   (issue #6553).
2. **One `lane` runner, the MacBook's** (`defaultCounts`: `lane` 1 on
   darwin, 0 on linux). No `host:` literal in `queue-lane.yml`: the role
   alone reaches only that runner, so the guard's `host-pinned` rule stands
   unwaived. The cost, accepted: the MacBook offline or asleep stops the
   queue and health until it is back.
3. **`max_parallel_checks: 1`** (`queue-shape` pins it): one runner, one
   draft at a time; a second speculative draft would only wait.
4. **`maint`, one runner per machine**, for every other duty: post-merge's
   `sync`, `sweep`, `housekeeping`, `nightly` and `bot-replay`,
   `pr-refresh`, `pr-fixup`, `weekly-report`, `corpus-repin`,
   `lane-timing`. One per machine keeps post-merge's invariant (a
   machine's `sync` legs never race on its primary checkout).
   `bot-replay` keeps its `host:macbook` pin (ADR 0159 § 2), now on
   `macbook-maint-1`: it holds the heavy mutex as before, so a health gate
   on the same machine still queues behind a running replay — but no
   longer the queue's runner. Shared duties name no host and run on either
   machine's `maint`.
5. **No third `lane` runner.** A second MacBook lane slot would run beside
   up to two passes and the sessions on 8 cores / 16 GiB: on 2026-10-26 the
   machine already refused a claim at three sessions (kernel memory
   pressure level 2, load 14.7 on 8 cores), and two concurrent lanes there
   compete for the same cores the first one needs. Revisit only on a
   measured `queue-lane` runner wait p90 > 120 s over 24 h AFTER this
   change, or a landing rate above what one serial lane serves; a hosted or
   rented VM (~€100–140/month for 8 dedicated cores) is the owner's call
   if the lane diet (issue #6989) leaves the lane too slow.

## Rollout (runner side, by the owner)

The workflows' labels are in the repo; the runners' are on the machines.
Order matters: a `maint` job queues until a `maint` runner exists, and
`queue-lane` reaches the Huawei until its `lane` runner is gone.

1. Before merging: on each machine `bun run runner install --maint 1` (an
   old `machine.json` declares no `maint` and keeps its other counts).
2. Merge (`.github/` and `.mergify.yml`: the owner merges).
3. After merging: on the Huawei, `bun run runner install --lane 0`, then
   `bun run runner remove huawei-lane-1` when it is idle. Not before the
   merge: until then every maintenance job still asks for `lane`, and the
   MacBook's would carry all of it.

## Measurement owed

The acceptance's p90 < 120 s over the first 24 h after rollout:

```bash
gh run list --workflow queue-lane.yml --limit 200 --json databaseId --jq '.[].databaseId' |
  xargs -I{} gh api repos/fil-donadoni/tolaria/actions/runs/{}/jobs \
    --jq '.jobs[] | select(.name=="queue-lane" and .started_at) |
          ((.started_at|fromdate) - (.created_at|fromdate))'
```

## Consequences

- The queue and health never wait behind maintenance; they still wait
  behind each other (one runner), and health's heavy gate behind a running
  replay's heavy mutex on the MacBook.
- The Huawei serves passes and maintenance only; its slowness costs
  maintenance latency, never a merge.
- A third machine adds a `maint` runner (and a matrix entry); a `lane`
  runner there only on a measured case under § 5.
