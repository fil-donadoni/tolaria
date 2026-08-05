---
title: indefiniteSubtypeSet is never persisted, so an indefinite subtype set becomes permanent across a DB round-trip
discoveredBy: 1705
status: draft
confidence: high
---

**What is wrong.** `CardInstanceState.indefiniteSubtypeSet` (`convex/gre/state.ts:691`)
is the restore anchor for an INDEFINITE subtype replacement — `SpellContext.setSubtypes`
(Thelonite Monk's "becomes a Forest", Figure of Destiny's "becomes a Kithkin Spirit").
It has no duration to tick it out, so its ONLY end is the permanent leaving the
battlefield: `resetBattlefieldTransientState` (`convex/gre/state.ts:9531-9534`) reads
the anchor to restore the printed line (CR 400.7, issue #1746).

That anchor is not written to the DB. `compactCard` / `expandCard`
(`convex/gre/serialize.ts`) are an explicit allowlist — every sibling record is
copied by name (`temporarySubtypeChange` at `:247`/`:624`, `grantedSubtypesAdd` at
`:306`/`:677`, `printedSubtypes` at `:309`/`:685`) — and `indefiniteSubtypeSet` is
absent from both directions. State is saved at every stable point, so the anchor is
lost on the first save after the effect resolves, while the mutated `subtypes` array
(which IS persisted) survives. The permanent then keeps the set subtypes forever: it
returns from a bounce still a Forest.

**Evidence.**

```
$ grep -n "indefiniteSubtypeSet" convex/gre/serialize.ts
(no output)
$ grep -n "temporarySubtypeChange" convex/gre/serialize.ts
247:    if (card.temporarySubtypeChange) {
624:    if (compact.temporarySubtypeChange) {
```

Writer: `convex/gre/state.ts:11250-11264` (`SpellContext.setSubtypes`).
Reader: `convex/gre/state.ts:9531-9534` (`resetBattlefieldTransientState`).

**Why it may not deserve its own issue.** It is one missing pair of lines in an
allowlist, and the same sweep would want to re-check the whole `CardInstanceState`
allowlist rather than patch one field — `serialize.test.ts`'s drift guard only covers
top-level `GameState` keys (`PERSISTED_OPTIONAL_KEYS`), so nothing catches a CARD
field being forgotten. The defensible ticket is arguably "extend the drift guard to
`CardInstanceState`", with this field as its first catch, rather than this field
alone. Not fixed here: #1705 is confined to the identity-swap replay and touching
serialization would widen its blast radius.

**Note for whoever picks it up.** #1705 added an optional `subtypes` field to the same
record (the effect value, so an identity swap can replay it). That field inherits the
same gap and needs no separate handling — persisting the record persists both.
