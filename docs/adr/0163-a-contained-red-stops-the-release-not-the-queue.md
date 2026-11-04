# A Contained RED stops the release, not the queue (amends ADR 0116, ADR 0156)

## Status

accepted (2026-11-04, owner decision in a design interview; amends
[ADR 0116][adr-0116] on stacking work over a RED tip and [ADR 0156][adr-0156]
on what a RED holds; [ADR 0158][adr-0158]'s revert-first ladder is unchanged).

## Context

Every RED health verdict holds the merge queue and the AFK dispatcher until a
GREEN or AMBER. A census of the `health` commit statuses from 2026-10-28 to
2026-11-03 found 15 RED episodes that blocked the pipeline for 70.9 of 172
hours (41 %, replaying the lineage rule over every verdict write).

None of the 15 was a crash, a `tsc` failure or a broken build. Most were a Bot
preference, a pinned value, a coverage count or a scan guard, and one test that
held the queue for 6.2 hours (the Cut Experiment opinion) was retired by owner
ruling a day later. `staging` is not production: `release` gates its exact tip
whole before `main` moves, so a red test on the base reaches no player.

The queue cannot simply ignore a RED, for two reasons measured in the same
census:

1. **Sentinels spread a red.** Since issue #7651 every code lane runs the test
   files that recently went red. On 46 recent PRs, all 42 `engine` lanes planned
   five of the census's red files. Over a red base, unrelated PRs would turn
   `land-failed`, as PR #7790 did during the longest episode.
2. **Commits stack over the culprit.** Each landing makes the revert less likely
   to apply. `MAX_REVERT_SET` already bounds how far the ladder can follow.

Whether a RED is harmless also cannot be read off its failing files. The
longest episode (20.2 h, stale fitted weights) bisected to an ordinary PR, and
only the revert failing to clear it showed that committed derived state was
wrong.

## Decision

**A RED is either blocking or contained. Blocking is the default.**

### 1. A class on the RED, not a new verdict

A Contained RED stays a RED: the commit status stays `failure`, the description
carries `contained`, and `lineageOf` answers the kind `contained`, which
`lineageBlocks` lets through. The ladder, bisect, repair proof and `release`
read it exactly as today. A RED with no class blocks, so a classification bug
stops the queue instead of letting it run. `health:status` prints
`RED (contained)`. AMBER keeps its meaning, a proved repair that landed.

### 2. The bisect grants the class

A RED is written without a class and blocks. After the bisect it becomes
contained only if ALL hold:

- the failed step is `test`;
- the failure kind is `assertion`, with test names in the evidence;
- no failing test belongs to the pipeline's own tooling (`gate`, `land`, the
  lane);
- the culprit is not a generated commit (`derive:sync`, `bot-replay`);
- the lineage is not `second-red`.

A bisect that dies grants nothing, and the RED keeps blocking. A later RED on a
contained lineage with the same test names inherits the class; new names go
through the bisect.

### 3. No culprit: contained, and a P0

When every probe is green and no culprit is named, no revert exists to repair
the tip. The RED is contained, the headless fixer runs as today, and a `P0`
issue goes on the board so the dispatcher takes it first.

### 4. The lane tolerates names, never files

A lane still runs every test. It passes only if every failure is a test name in
the standing RED's evidence, and it prints `tolerated: <name>` in the job
summary. Another failure in the same file reds the PR. A file that cannot load,
or a failure with no attributable name, reds the lane. `land:ready`'s pre-queue
check applies the same rule, since it runs the same plan.

Whether vitest's `Unhandled Errors` output appears in lane runs is unmeasured.
Until measured, it reds the lane.

Accepted cost: a PR that makes an already-tolerated test worse passes unseen
until the repair lands.

### 5. Escalation is by event and landing count, never by clock

A Contained RED becomes blocking when:

- the ladder reaches its stop rung (a revert that cannot land, a RED that
  outlives its revert, fixer attempts used up);
- a revert does not apply; or
- `LANDINGS_PER_BATCH` (20) commits have landed since the episode's FIRST RED.

A quiet night consumes nothing. Only this transition notifies the owner: a
Contained RED sends no email.

### 6. Unchanged

`release` refuses a RED tip, contained or not. The ladder reverts first. Repairs
are declared and proven as today.

## Consequences

- Replayed over the census: 11 episodes (37.6 h) contained from the bisect on,
  one (20.2 h) contained until its revert failed, three (13.1 h) blocking from
  the start. The real gain is smaller than 37.6 h: about 15.5 h of it was waiting
  after a revert had landed, which issue #7657's repair proof already cut.
- The base can stand red for longer stretches, with the release held behind it.
  The landing cap bounds how much stacks.
- The queue's rule text ("never stack work on a red tip") changes in the slice
  that turns this on, not before.

[adr-0116]: 0116-base-branch-and-release-gate.md
[adr-0156]: 0156-adopt-the-github-native-pipeline-for-the-afk-workflow.md
[adr-0158]: 0158-the-bot-play-sweep-leaves-the-pr-and-a-red-is-reverted-first.md
