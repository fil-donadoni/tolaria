---
title: The lockfile's per-format `pool` counts go stale on every card-shipping PR, and only the corpus-dependent tier notices
discoveredBy: 3049
status: draft
confidence: high
---

**What is wrong.** `data/oracle-compiled.json`'s per-format `pool` metric counts
the cards covered by a hand-written definition, and it is computed from
`data/card-index.json` (`poolOracleIdsFromIndex`). That file is **not** among
the inputs `header.compilerHash` covers, so shipping a card leaves the lockfile
stale with every offline tier of `bun run check:oracle` green. Only tier 3, the
full regenerate-and-diff, sees it — and tier 3 needs the 24 MB corpus cache,
which is gitignored and absent on a clean checkout. So the drift merges, and
the next person to run the gate on a machine that happens to have the corpus
pays for it as a conflict in a generated file.

**Evidence.** Observed three times in one session, all pre-existing on `main`:

- PR #3059 (DSK Enduring cycle, 4 cards) left `pool` at 620/1991/2009/2022
  against a regenerated 624/1995/2013/2026. PR #3058 later fixed it as a
  rebase-only change.
- PR #3064 and PR #3066 (Tidehollow Sculler, Deep-Cavern Bat) left it at
  624/1995/2013/2026 against 626/1997/2015/2028 — rediscovered while rebasing
  this branch, and regenerated here.

`scripts/lib/oracle-lockfile.ts` § `DATA_INPUT_FILES` is where a committed
non-source input goes; `data/card-index.json` is deliberately not there.

**Why it may not deserve its own issue.** The obvious fix — hash
`data/card-index.json` too — makes every card PR red until the author
regenerates, and regenerating needs the corpus, which a clean checkout does not
have. That trades a silent stale metric for a gate a contributor cannot
satisfy offline, which the compiler's own tiering exists to avoid (ADR 0105).
The real options are narrower: recompute `pool` from the card index at READ
time (`oracle:report`) so the lockfile stops carrying a derived number at all,
or have `check:index` — which already reads the card index and runs offline —
own the `pool` comparison. Both are small; neither is this issue's business.
