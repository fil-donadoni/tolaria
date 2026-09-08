---
title: Aura Shards flips compiled-but-red in the behavioural harness, unrelated to issue #3060
discoveredBy: 3060
status: draft
confidence: medium
---

**What is wrong.** `bun run oracle:behavioural` reports Aura Shards
(`convex/cards/sets/inv/multicolor.ts`) as `compiled-but-red` —
`AssertionError: expected true to be false // Object.is equality` — where the
issue that filed #3060 recorded 0 red. This predates the #3060 changes: it
reproduces identically on `5a12f1c` (the tip #3060 branched from, before any
of this PR's edits) and is unaffected by them — Aura Shards carries exactly
one `triggeredAbilities` entry, which the new gap-3 pairing logic in
`graftAbilityIds` handles through its single-ability fast path, unchanged
from the old position-based graft.

**Evidence.** `bun run oracle:behavioural` on `5a12f1c` (checked out over the
worktree, working tree otherwise clean) already prints the same
`compiled-but-red` verdict and assertion message for Aura Shards; #3060's
commit does not touch it.

**Why it may not deserve its own issue yet.** Not diagnosed further here —
#3060's acceptance criteria only required the harness's _own_ verdicts to be
unchanged BY that change, which they are (compiled-and-green count, harness-
error count and untested count all match; only this pre-existing red carried
forward). Whoever last touched Aura Shards' compiler path or the ETB-target
compilation should look at whether this is a real compiler/card divergence
worth a `compiler-gap` marker, or a harness assertion that needs adjusting.
