---
title: A PR's bare-compile verdict rebased over a bot-replay commit is recorded under a Bot hash that never played it
discoveredBy: 6463
status: draft
confidence: medium
---

**What is wrong.** A session's bare `oracle:compile` plays the cards its rule
graduated under the SESSION tree's Bot and keeps the committed header hash
(issue #6463, the `--replay-card` honesty rule). When that PR is rebased over a
`bot-replay` commit (header moved to the new Bot's hash), the merge driver's
overlay (`scripts/lib/oracle-verdict-overlay.ts`, issue #5814) keeps the PR's
new rows and OURS' header — so the landed lockfile says every verdict was played
under the new Bot while those rows were played under the old one. From then on
header == tree, and `derive:sync --replay-bot` never re-plays them.

**Evidence.** `scripts/__tests__/oracle-verdict-overlay.test.ts`, "a rebase
over the Bot replay's commit keeps the verdicts the PR played": `newcard`
played under `sha256:old-bot`, result header `sha256:new-bot`.

**Why it may not deserve its own issue.** The window is one Bot change landing
between a grammar PR's branch point and its merge; the mixed rows are the
handful the PR graduated, and the next Bot change replays everything. The
session path itself already accepts the same mixed state (verdicts played under
the tree's Bot, header on the committed one). A per-row Bot hash would close it
exactly, at ~70 bytes × 6,500 rows in the lockfile.
