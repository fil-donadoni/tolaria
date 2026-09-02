---
title: health:main leaves a false RED marker when it races another session's heavy gate — the liveness test it fails is the one that measures CPU
discoveredBy: 2982
status: draft
confidence: high
---

**What is wrong.** `bun run health:main` left `RED @ 5f008081 — failed at test`
on 2026-09-02, on a tip that is not broken. The single failing test was
`scripts/__tests__/gate.test.ts > gate.ts — liveness (issue #2999) > never
reclaims a holder that IS making progress (issue #1924)` — the assertion that a
mutex holder still burning CPU is never reclaimed.

That test decides "is the holder making progress?" by sampling subtree CPU. It
was running while a **different** session's `bun run check:lane` had the machine
saturated (the `full` lane, ~14 minutes of vitest at `ncpu - 1` workers). Under
that contention the sampled holder can miss its progress window and be judged
dead, which is exactly the branch the test asserts never happens.

So the green-main invariant (ADR 0110) gets a durable RED marker from machine
load rather than from a defect, and the next session to run `land` is told
"fixing main comes before landing unrelated work" about a tip that is fine.

**Evidence.** The failure does not reproduce:

- `bunx vitest run scripts/__tests__/gate.test.ts` at the RED tip `5f008081`
  itself, in the primary checkout — **18 passed**.
- the same file in an issue worktree off `b9ca4b3b4` — **18 passed**.
- `bun run land 3061`'s own `check:pr`, on the merged tree minutes later —
  **1221 files, 19591 tests, all passed**, `gate.test.ts` included.

Timing: `health:main` started `2026-09-02T20:21:05Z`; the competing
`check:lane` ran 20:09–20:22Z on the same machine. The health gate takes the
heavy mutex, but `check:lane` is heavy too — the log shows the health run began
while `gate:who` reported a _dead_ holder in `tolaria-issue-2703` reclaimable
for another 44 minutes, so the two overlapped rather than serialised.

**Why it may not deserve its own issue.** It is one test, and the underlying
mechanism it guards (issue #2999's liveness reclaim) is doing its job in
production — only the _test's_ fixture is load-sensitive. If a false RED is
rare, the cost is one confused session per occurrence and the marker clears on
the next health cycle. It becomes a ticket if it recurs, and the fix is
probably in the fixture (drive the clock or the CPU sample explicitly instead of
sampling a real subtree), not in `gate.ts`.

Worth pairing with the second observation: the dead-holder reclaim window
(`44m31s` remaining, holder pid GONE, subtree CPU `0.00s`) means a crashed
session can let two heavy gates run concurrently for the better part of an
hour — which is the condition that produced this flake in the first place.
