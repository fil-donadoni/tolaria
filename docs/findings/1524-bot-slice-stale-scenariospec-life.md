---
title: /bot-slice tells sessions ScenarioSpec has no life totals, but #2147 shipped `life`
discoveredBy: 1524
status: draft
confidence: high
---

**What is wrong.** `.claude/skills/bot-slice/SKILL.md` § Phase 0 step 1 lists
"`ScenarioSpec` has no life totals (issue #2147)" as a **current** limitation to
"state out loud when it bites", and tells the reader that "any life-dependent
symptom (chump-block, race, burn the face vs. the creature) cannot be pinned
faithfully until that lands". That field shipped: `life?: { me?: number; opp?: number }`
is in the spec today and blade entries already use it.

The cost is not cosmetic. The skill is read at the START of every bot slice, and
it steers the session away from exactly the position shape a burn/race blade
needs. This session built a lethal-at-3-life blade entry only after checking the
spec against the claim.

**Evidence.** `convex/debugScenarioSpec.ts:136` — `/** CR 119.1 (issue #2147) —
seed starting life totals … */ life?: { me?: number; opp?: number }`. Used by
`convex/gre/ai/blade/registry.ts` (e.g. the `graveyard-cast:` entries' `life: { me: 20, opp: 2 }`).
The stale claim is in `.claude/skills/bot-slice/SKILL.md` (Phase 0, step 1, first bullet).

A second, smaller instance of the same rot sits in the engine:
`convex/gre/scenarioBuilder.ts:275-277` says "`libraryCount` (if set) resets the
library AFTER this loop, so a scenario seeding a specific library card must leave
`libraryCount` unset". The fill runs at line 210, BEFORE the placement loop at
265, and line 208's own comment says so ("Seeding first makes `libraryCount` mean
'this many filler basics', and an entry's `position` then indexes into the
already-filled pile"). The two comments contradict each other and the later one is
the wrong one — a scenario CAN combine `libraryCount` with a positioned library
card, which is what this session's blade entries do.

**Why it may not deserve its own issue.** Both are one-line comment corrections
with no behaviour attached, so they are a natural rider on the next PR that
touches either file rather than a ticket of their own. Against that: the
`/bot-slice` line is resident guidance read before every bot change, and a stale
"you cannot do X" is more expensive than a stale "you can" — it suppresses work
silently, and nothing in `check:all` can catch prose that has drifted from the
type it describes.
