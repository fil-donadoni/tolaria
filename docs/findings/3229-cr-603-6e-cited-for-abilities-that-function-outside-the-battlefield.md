---
title: CR 603.6e is cited across the repo for "an ability that functions from a zone other than the battlefield", which is CR 113.6b / 113.6k
discoveredBy: 3229
status: draft
confidence: medium
---

**What is wrong.** `CR 603.6e` covers exactly one thing — an **Aura's**
leaves-the-battlefield trigger finding the new object its host became:
_"Some Auras have triggered abilities that trigger on the enchanted permanent
leaving the battlefield. These triggered abilities can find the new object that
permanent card became in the zone it moved to; they can also find the new object
the Aura card became in its owner's graveyard after state-based actions have been
checked. See rule 400.7."_

It says nothing about an ability functioning from a zone other than the
battlefield. That is `CR 113.6`: `113.6b` (_"An ability that states which zones
it functions in functions only from those zones"_) for a `zone: "graveyard"`
ability, and `113.6k` (_"A trigger condition that can't trigger from the
battlefield functions in all zones it can trigger from"_) for a "when you cast
this spell" trigger — which is precisely what the `functionsFromStack` marker
models.

**Evidence.** 42 `CR 603.6e` citations. The whole `functionsFromStack` /
`zone: "graveyard"` family is miscited:

- `convex/cards/types.ts` — `TriggeredAbility.zone`'s doc ("abilities that
  function while the card is in a zone other than the battlefield") and
  `functionsFromStack`'s own doc
- `convex/gre/state.ts:10494`, `10534` — `collectCastTriggers` /
  `collectSelfCastTriggers`
- `convex/gre/triggers.ts:458` — the graveyard sweep
- `convex/cards/abilities/triggers/spellCastTrigger.ts:165`
- `convex/gre/__tests__/self-cast-trigger.test.ts:1`, `:118`
- `convex/cards/sets/drk/blue.ts:367`, `:379` (Mana Vortex),
  `convex/cards/sets/roe/colorless.ts:151` (Emrakul)

A second sub-class uses it for a graveyard-COUNT clause
(`convex/cards/graveyardOrder.ts:12`, `convex/gre/ai/grounding.ts:69`/`:238`/`:240`,
`convex/gre/ai/cardScriptValue.ts:231`), where the rule is about a card in the
graveyard rather than an Aura's host, so `113.6b` fits those too.

New code added by issue #3229 cites `CR 113.6k` / `CR 113.6` instead; the pre-existing
sites were left alone deliberately (see below).

**A second family, same class, found by the review of that same PR** — three ids
that resolve but say something else, all of them propagated from pre-existing
sites rather than invented:

- **`CR 611.2c` for "indefinite duration"** (`convex/cards/emblems.ts:86`, and
  the `animate` Op's own doc at `convex/cards/types.ts` says `611.2b`). 611.2c is
  about the SET OF OBJECTS a resolution effect affects being fixed; 611.2b is
  "for as long as …". The rule for a stated-nothing duration is **`CR 611.2a`**:
  "If no duration is stated, it lasts until the end of the game." Corrected at
  the three sites #3229 added; the two older ones remain.
- **`CR 111.5` for the token-ness filter** — 111.5 is "the token is not created
  if a rule stops a permanent with those characteristics entering". A token
  simply BEING a token is **`CR 111.1`**.
- **`CR 707.1` for "one effect creating two tokens"** — 707.1 is the copy-effects
  preamble. Token creation is **`CR 111.1` / `111.2`**.
- Weaker, judgement calls, also corrected in that PR: `CR 601.2b` for "without
  paying their mana costs" (the rule that quotes the phrase verbatim is
  **`CR 118.9`**), and `CR 109.2` for "you control" (109.2 is about zone-less
  type descriptions; "you"/"your" is **`CR 109.5`**). `CR 109.2` is cited this
  way across many set files.

**Why this is invisible to the gate.** `bun run cr:lint` only asks whether an id
_resolves_, and its keyword cross-check is scoped to the `701`/`702` blocks. A
resolvable-but-wrong id outside those blocks is exactly the class the scan cannot
see — the same shape as
`docs/findings/1324-cr-603-3c-cited-for-no-legal-target.md`.

**Why it may not deserve its own issue.** Comments and test names only: no
runtime behaviour is wrong and no card is affected. The cost is that a future
`/mtg-rules-check` pass anchors on the wrong rule while building a cast-trigger
or graveyard-ability feature. Against a ticket: the fix is a per-site judgement
call across ~42 occurrences (Aura-host vs stack-function vs graveyard-count), so
it belongs on a docs-hygiene tracker next to #1324's finding rather than in the
`ready-for-agent` queue — or the two should be merged into one CR-citation-audit
ticket.
