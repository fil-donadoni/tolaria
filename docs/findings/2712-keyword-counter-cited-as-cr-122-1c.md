---
title: Keyword counters are cited as CR 122.1c throughout gre/state.ts, but 122.1c is shield counters
discoveredBy: 2712
status: draft
confidence: high
---

**What is wrong.** `bun run cr 122.1b` prints "A keyword counter on a permanent
… causes that object to gain that keyword"; `bun run cr 122.1c` prints "One or
more shield counters on a permanent create a single replacement effect and a
single prevention effect". Every keyword-counter-grant comment in the engine
cites **122.1c**. The claim is about keyword counters, so the id is wrong — and
it is the one defect `bun run cr:lint` structurally cannot catch, because the
scan asks only whether an id RESOLVES and this one does (the keyword-vs-section
cross-check runs on the 701/702 blocks only).

**Evidence.** All from issue #1194's keyword-counter grant, plus its callers:

- `convex/gre/state.ts:7424` — "the CR 122.1c / 613.4d keyword-counter grant"
- `convex/gre/state.ts:7484` — same phrase at the ETB site
- `convex/gre/state.ts:8607` — `applyKeywordCounterGrant`'s own body comment,
  "CR 122.1c — one entry per (permanent, counter type) … a second 'flying'
  counter grants no second occurrence of flying"
- `convex/gre/state.ts:11964`, `:15978`, `:16027`, `:21991`, `:23085` — the
  COUNTER_ADDED emitter, the two grant/ungrant sites, the token-spec path, and
  `payRemoveCounterCost`
- `convex/gre/state.ts:23113` — "CR 118 / 122.1c" on the counter-cost
  affordability predicate (moved to `convex/gre/constants.ts` by issue #2712;
  its citation is now `CR 118.3 / 122.1b`)

Note the same file gets it RIGHT one line below `payRemoveCounterCost`'s grant
call, where the layer-6 recompose is cited as `CR 122.1b` — so the two ids are
already used interchangeably for the same clause inside one function.

**Why it may not deserve its own issue.** Nothing behaves differently: this is
a comment sweep over ~9 lines in one file, and no reader is misled about what
the code does, only about which subrule licenses it. It is plausibly a line on
whatever tracks CR-citation hygiene rather than a ticket — except that the
pattern is copy-propagating (this slice copied it into `convex/game.ts` before
review caught it, and 122.1c appears in enough places that the next
counter-granting card will copy it again), and `cr:lint` will never flag it. If
a sweep happens, the honest fix is one pass over `122.1c` repo-wide asking per
site whether the claim is about keyword counters (122.1b) or shield counters
(122.1c), not a blind replace.
