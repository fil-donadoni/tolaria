---
title: A pre-commit lint-staged stash can make check:lane classify (and gate) a tree that is not on disk
discoveredBy: 2727
status: draft
confidence: medium
---

**What is wrong.** `bun run check:lane` refuses to run on a dirty tree so that
"the HEAD SHA in the receipt describes exactly what was classified"
(`scripts/check-lane.ts`). That guard covers the tree being dirty when the run
STARTS. It does not cover the tree being rewritten UNDER the run — which is
exactly what husky's `lint-staged` does on every commit: it stashes the working
state (`Backing up original state... git stash <sha>`), runs prettier, then
restores. A `git commit && bun run check:lane` pair issued back to back can
therefore have the lane read files while the stash is still applied.

**Evidence.** On this branch, `git add -A && git commit -q -m … && bun run
check:lane` produced a lane run that (a) fell back to `check:pr` instead of
classifying `skin` — i.e. it did not see a diff it could place — and (b) failed
`design-tokens.test.ts`'s Beleren ratchet with `expected 75 to be 76`, while
the constant on disk was `63` and the real site count was `63`. `75` is
`main`'s `76` minus one file: a partially-restored tree. Re-running
`bun run check:lane` on the identical, now-quiet tree passed in 190.6s and
classified `skin` correctly. The tell is the lint-staged banner appearing
INSIDE the lane's own log (`[STARTED] Backing up original state...` above
`$ bun scripts/check-lane.ts`).

Two costs, both silent: a `skin` diff gated as `check:pr` pays ~440s instead of
~190s, and — the one that matters — a green lane run could in principle have
gated a tree nobody ever had, which is precisely the property the dirty-tree
guard exists to give.

**Why it may not deserve its own issue.** It needs an agent to chain `commit`
and `check:lane` in one shell invocation, which a human at a prompt rarely
does, and it is self-correcting on a re-run. A one-line fix probably exists —
have `check:lane` re-assert `git status --porcelain` is empty AND that
`.git/lint-staged*` / a stash-in-progress marker is absent before it starts
reading, or simply re-check cleanliness after classification — but if that is
the whole fix it is a line on an existing gate-hardening ticket rather than a
ticket of its own. The alternative reading is that this is really "agents
should not chain commit and gate", which is a prompt fix, not a code fix.
