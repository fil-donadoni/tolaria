# The base branch takes landings under the lane gate; the full gate runs once, at release, and branch names are configuration

## Status

accepted (reshapes ADR 0110's post-merge health gate; issue #3124)

## Context

Under ADR 0110 every landing on `main` paid two things on the machine-wide
heavy mutex: `check:lane` (175-305 s measured) and a detached `health:main`
(the full offline gate: `check:all` plus the three test suites, ~13 min with
7 vitest workers). `main` was also the production deploy branch
(`vercel.json` deploys `main` only), so every PR was a release.

Measured over the 14 days to 2026-09-07 (`git log --first-parent`,
`.claude/telemetry/health/`, `gate-lock.jsonl`):

| Metric                                         | Value                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Landings per day                               | 16.4                                                                           |
| Mutex spent on health per day                  | ~213 min                                                                       |
| Health runs / RED                              | 122 / 23 (19%)                                                                 |
| RED from timeouts alone (contention, not code) | ≥10 of 23 → ~1.4 false REDs a day                                              |
| Longest observed wait for the heavy mutex      | 55 min                                                                         |
| Heavy gate footprint                           | 7 workers × ~0.9 GB + tsc ~2 GB ≈ 8 GB on a 16 GB machine (5.5 GB swap in use) |

A false RED costs a 13-minute rerun, a fix-forward session, and every landing
queued behind it. The health gate's own contention was manufacturing the
REDs it existed to catch (the 2026-09-07 10:36 RED: two 5 s timeouts on
tree-scanning tests at load 21 on 8 cores; GREEN on the same sha at load 3).

Separately, the branch name was a literal in 57 places in `scripts/land.ts`
alone, 25 in `deny-guard.sh`, and more in every script that fetches, rebases,
diffs or fast-forwards — moving the integration branch meant finding each by
hand.

## Decision

1. **Two branches, named in `tolaria.config.json`.** `branches.base`
   (`staging`) is the integration branch: every issue PR targets it and
   `bun run land` merges into it. `branches.release` (`main`) is production.
   `scripts/lib/branches.ts` is the single reader for TypeScript;
   `.claude/hooks/deny-guard.sh` reads the same file with `jq`.
   `scripts/__tests__/branches.test.ts` reds on an `origin/<name>` literal in
   any script or hook outside that module.
2. **`land` pays the lane gate only.** It rebases onto `origin/<base>`, runs
   `check:lane`, pushes, merges into the base branch, verifies the tip
   advanced by exactly its squash, and does the housekeeping. It no longer
   detaches the health gate and no longer writes `green-sha`. It refuses a PR
   whose base is not the base branch — the API merge lands wherever the PR
   points, and a PR against the release branch would ship unreleased.
3. **`bun run release` is the one place the full gate runs.** Under the heavy
   mutex it gates the `origin/<base>` tip with `health-main.ts`
   (`bun run health` by hand), and only a GREEN record about exactly that sha
   lets the release branch move — by a plain-refspec push, never a force. RED
   leaves the marker; `land` warns on it; the fix-forward lands on the base
   branch like any PR.
4. **Green-at-release replaces green-main.** The release branch only ever
   moves to a health-proven tip. The base branch may be red between releases
   and is bisected at release time; a release with N landings behind it costs
   at most ⌈log₂ N⌉ health runs to attribute a RED.
5. **Worktrees branch from `origin/<base>`.** `bun run wt:new <N>` fetches
   the base tip and branches there; the primary checkout keeps the release
   branch checked out, so branching from its HEAD would start every issue
   behind the base by a release's worth of landings.

## Consequences

- Per landing, the mutex hold drops from ~17 min to the lane's 3-5 min; the
  ~213 min/day of health time becomes one or two runs a day. The heavy gate's
  8 GB footprint leaves the machine for all but the release.
- False REDs from contention stop landing on the integration path; the
  release run happens on a machine that is not also gating four lanes.
- A RED at release blocks the release, not development. The cost moved from
  "every PR waits behind a 13-minute gate" to "a release bisects its batch".
- No staging environment in this slice: `vercel.json` deploys only the
  release branch, so the base branch never reaches production by
  construction; `check:ui` uses the local Convex deployment.
- Cutover: `staging` created from the `main` tip; GitHub's default branch set
  to `staging` so `gh pr create` needs no `--base`; open PRs retargeted.

## Alternatives considered

- **A two-slot heavy mutex.** Two concurrent 8 GB gates on a 16 GB machine
  with 5.5 GB of swap already in use; two 4-worker gates are CPU-neutral and
  gain only the non-CPU phases (~25%). Rejected: the cost was the health run's
  existence per landing, not its serialisation.
- **Health by hand every N hours, per-landing detach kept.** The special case
  of this decision without the branch split; still ships every PR to
  production and keeps `main` as a literal everywhere.
