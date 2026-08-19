---
title: compactCard/expandCard's per-field allowlist has no drift guard, unlike PERSISTED_OPTIONAL_KEYS
discoveredBy: 2361
status: draft
confidence: medium
---

**What is wrong.** Every optional field on `GameState` is protected by a drift
guard: it must appear in `PERSISTED_OPTIONAL_KEYS` or `TRANSIENT_KEYS` or
`serialize.test.ts` fails (the rule is in `.claude/rules/gre-development.md`
§ Serialization requirement). Every optional field on `CardInstanceState` has the
SAME persistence requirement — `compactCard` writes it, `expandCard` reads it
back — and NO equivalent guard. A new instance field whose author forgets one of
the two hand-written branches serializes as absent, and the symptom only appears
after a save/load round trip, i.e. never in a unit test that resolves in memory.

**Evidence.** The allowlist is a run of hand-written `if` branches in each
direction — `convex/gre/serialize.ts:226-233` and `:244-245` and `:293-297` and
`:321-322` (compact), mirrored at `:612-630`, `:647-649`, `:696-702`, `:727-729`
(expand) — with no `satisfies Record<keyof …, true>` construction and no test
comparing the two sets against `CardInstanceState`'s optional keys. Contrast
`PERSISTED_OPTIONAL_KEYS` at `convex/gre/serialize.ts:1442`, whose drift guard is
`serialize.test.ts` S2 (`:1313-1327`). This issue's two new Ops happened to need
no new field (they reuse `abilitiesSuppressedBy` / `removedKeywords` /
`grantedTypes` / `suppressedTypes`, all already in the allowlist), which is how
the gap was noticed rather than hit.

**Why it may not deserve its own issue.** The guard is only worth writing if the
symmetry can be expressed cheaply — a `keyof CardInstanceState` sweep would trip
over every deliberately-transient field and need its own exclusion list, which is
a second thing to keep in sync. If the exclusion list would be long, a comment
pointing at the two functions may be the better fix, and that is a doc line, not
a ticket.
