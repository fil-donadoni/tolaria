---
title: playLandForPlayer silently refuses a cross-player exile land play
discoveredBy: 1980
status: draft
confidence: high
---

**What is wrong.** `SpellContext.playLandForPlayer` resolves the card with
`player[sourceZone].find(...)` — the ACTING player's own zone. A play-from-exile
grant whose card sits in a DIFFERENT player's exile (CR 400.7 / 601.3e, the
Dauthi Voidwalker shape from #1156) therefore misses, and the function returns
`false` with no error. `applyPlayLandFromExile` itself handles the case
correctly (it searches every player's exile); its caller narrows it back away.

**Evidence.** `convex/gre/state.ts:13815-13819` (`const card =
player[sourceZone].find(...)`; `if (!card …) return false`) versus
`convex/gre/playLand.ts` `applyPlayLandFromExile`, which does
`state.players.find((p) => p.exile.some(...))`. The `castDuringResolution`
`includesLand` branch (`convex/gre/effects/interpreter.ts:2271`) reads the
boolean and reports "pass", so the whole play disappears without a trace.
`convex/gre/search.ts:646-655` documents the same narrowing on the ISMCTS leaf,
explicitly ("has never been reachable in this coarse leaf").

**Why it may not deserve its own issue.** Nothing shipped reaches it: no card
combines a cross-player exile grant with a `play`-worded (`includesLand`)
permission — Dauthi Voidwalker's grant is cast-only, and hideaway exiles from
your own library. It is a fail-closed narrowing (a refused play, not a wrong
one), so it is a latent trap for the next such card rather than a live bug, and
may be better as a line on whatever ticket ships that card.
