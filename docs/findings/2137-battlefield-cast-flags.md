---
title: evoked/dashed/escaped never get cleared on a CR 400.7 permanent-side zone change — same leak shape as buybackPaid, different chokepoint
discoveredBy: 2137
status: draft
confidence: medium
---

**What is wrong.** Issue #2137 fixed `buybackPaid` (and audited-in
`dynamicCantBeCountered`) leaking through the STACK-side exit chokepoint
(`resetStackTransientState` in `convex/gre/state.ts`) into a recastable zone.
Three sibling `CardInstanceState` fields — `evoked`, `dashed`, `escaped` — have
the exact same one-shot-cast-fact shape (CR 702.130/702.121/702.138: "was this
permanent evoked/dashed/did this spell escape") but live on the PERMANENT side
and are never cleared by `resetBattlefieldTransientState`
(`convex/gre/state.ts:9633`), the CR 400.7 gate for a permanent leaving the
battlefield.

**Evidence.**

- `convex/gre/state.ts:1235-1246` — `evoked?: boolean` / `dashed?: boolean`
  declared on `CardInstanceState` itself, not `StackItem`, precisely because
  they must survive resolution onto the permanent (cleanup needs to read
  them). `escaped?: boolean` at `convex/gre/state.ts:1200`, same shape.
- `convex/gre/state.ts:9633-9742` (`resetBattlefieldTransientState`) has no
  `delete card.evoked`, `delete card.dashed`, or `delete card.escaped` line —
  confirmed by grep across the whole function body. Contrast with the
  adjacent, already-fixed `wasKicked`/`kickerPayments`/`chosenXOnCast` deletes
  at `convex/gre/state.ts:9700-9713`, each with its own CR-referenced
  docstring explaining exactly this leak shape for a different field.
- `convex/game.ts:3299` / `:3304` — `...(state.pendingCast.evoked ? { evoked:
true } : {})` / `...(state.pendingCast.dashed ? { dashed: true } : {})` —
  the same vulnerable conditional-spread idiom the buyback bug used, on the
  activated-permanent-recast path.
- `convex/gre/serialize.ts:446-453` / `:809-814` — both fields are
  round-tripped through compact/expand, so they persist to the DB exactly
  like `buybackPaid` did.

**Reproduction shape (untested, not yet confirmed with a shipped card).** A
creature with Evoke is cast paying its evoke alt-cost (`evoked: true` set),
resolves, is bounced to hand WITHOUT going through
`resetBattlefieldTransientState` clearing `evoked` (it currently doesn't), and
is recast normally (full cost, not evoked). If `evoked: true` still reads
`true` on the new permanent, its ETB-sacrifice-if-evoked clause (CR 702.130c)
would incorrectly fire a second time on a creature nobody evoked.

**Why it may not deserve its own issue yet.** No shipped card was found with
Evoke/Dash/Escape _and_ a "return this permanent to hand, then recast it"
combo verified in this pass — the leak is real by code inspection but its
reachability with the current card pool wasn't confirmed (unlike #2137's
buyback bug, which was reproduced end-to-end). It is also a DIFFERENT
chokepoint (`resetBattlefieldTransientState`, not `resetStackTransientState`)
with its own call sites and test surface (`convex/gre/__tests__/` files for
evoke/dash/escape specifically) — out of scope for issue #2137's stack-exit
fix, which only concerns `StackItem`-only cast-time fields. Worth a
`bun run findings`-triaged look before the first Evoke/Dash/Escape card that
also has a "return to hand" interaction ships.
