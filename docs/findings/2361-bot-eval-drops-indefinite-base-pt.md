---
title: Bot evaluation drops INDEFINITE layer-7b base-P/T sets, not just temporary ones
discoveredBy: 2361
status: draft
confidence: medium
---

**What is wrong.** `computeEffectivePT`'s `includeTemporary: false` mode — used
only by the bot's board evaluation, so a combat trick is not scored as permanent
material (ADR 0020 §2) — discards the WHOLE `temporaryPTSet` array, including
entries that carry no `duration`. A `duration`-less entry is not temporary at
all: it is the INDEFINITE layer-7b set of CR 613.4b (`SpellContext.setBasePT`
with the `"indefinite"` sentinel, issue #1746), which lasts until the permanent
leaves the battlefield. The bot therefore evaluates an elk-ified permanent at its
PRINTED power and toughness rather than 3/3, and a Wall of Tombstones at its
printed toughness rather than its set one.

**Evidence.** `convex/gre/layers.ts:453` —
`const set = includeTemporary ? getSetPT(target) : {};` — is an all-or-nothing
gate, while the entries it reads (`convex/gre/state.ts:762-767`,
`temporaryPTSet?: { power?; toughness?; duration? }[]`) are explicitly documented
as indefinite when `duration` is undefined, and `tickAllDurations` only ever
splices out the ones that HAVE a duration. The narrow fix is to filter by
`entry.duration !== undefined` inside `getSetPT` when `includeTemporary` is
false, rather than skipping the layer.

**Why it may not deserve its own issue.** It is a bot-evaluation accuracy bug,
not a rules bug — no game state is wrong, only the search's estimate of it — and
the fix moves the evaluation of several shipped cards (Figure of Destiny, Wall of
Tombstones, Sorceress Queen, now Oko's `+1` victims) at once, so it wants a
deliberate blade-scenario pass rather than a drive-by. If the Bot is not being
tuned right now, this is a line on the bot-accuracy tracker rather than a ticket.
