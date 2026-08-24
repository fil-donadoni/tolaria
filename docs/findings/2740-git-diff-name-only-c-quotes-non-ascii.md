---
title: git diff --name-only C-quotes the two non-ASCII paths in this repo
discoveredBy: 2740
status: draft
confidence: medium
---

**What is wrong.** Two tracked files carry non-ASCII names
(`public/img/symbols/½.svg` and `…/∞.svg`). `git diff --name-only` returns them
**C-quoted** — literally `"public/img/symbols/\302\275.svg"`, with the quotes as
data — unless `-z` is passed or `core.quotePath` is turned off. Any script that
matches such a path against a prefix or extension sees a string starting with a
double quote and matches nothing.

**Evidence.** `git ls-files | grep '^"'` returns both paths quoted.
`scripts/docs-lane.ts:305` reads
`git(["diff","--name-only","origin/main...HEAD"], cwd).split("\n")` with no
`-z`, and feeds the result to `isDocPath()`. `scripts/check-lane.ts` (this PR)
uses `git diff -z --name-only … .split("\0")` for exactly this reason.

**Why it may not deserve its own issue.** For `docs-lane` the failure is in the
SAFE direction: a quoted path is not recognised as a doc path, so the docs lane
refuses the changeset instead of waving a non-doc file through. The two affected
files are static mana symbols that essentially never change, and no other script
diffs paths this way today. It is a one-character fix (`-z` + `split("\0")`) if
someone is in the file anyway, and a latent trap for the next script that
diffs paths — worth recording, probably not worth a ticket on its own.
