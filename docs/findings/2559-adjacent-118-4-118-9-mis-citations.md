---
title: Adjacent CR 118.4/118.9 mis-citations left out of the #2559 life-payment sweep
discoveredBy: 2559
status: draft
confidence: medium
---

**What is wrong.** Issue #2559 scoped strictly to the literal substring
`CR 118.4` (100 sites, matching the issue's own count exactly). Auditing that
set surfaced two adjacent, genuinely different mis-citation shapes that were
deliberately left untouched because fixing them would have overreached the
issue's stated scope ("a general resolvable-but-wrong scanner beyond CR
701/702 and this narrow life-payment case — much larger work").

**1. Two `CR 118.4` sites that are not about life payment at all**, so
rewriting them to CR 119.4 would have been equally wrong. (A third,
`convex/cards/types.ts:2710`, made the same "unpayable cost isn't paid" claim
in an ENERGY-counter context and has since been corrected to CR 601.2h —
printed, CR 601.2h ends "Unpayable costs can't be paid," verbatim the claim
that line makes.)

- `convex/cards/sets/drk/green.ts:599` — Spitting Slug's "you may pay `{1}{G}`"
  optional MANA payment cites `CR 118.4`; printed, CR 118.4 is the {X}-cost
  rule and says nothing about optional payment. The shape "may [do something].
  If [that player] does, [effect]" is governed by CR 118.12, printed: "Some
  spells, activated abilities, and triggered abilities read, '[Do something].
  If [a player] [does, doesn't, or can't], [effect].' Or '[A player] may [do
  something]. If [that player] [does, doesn't, or can't], [effect].'" —
  118.12, not 117.3a (117.3a, printed, is "The active player receives
  priority at the beginning of most steps and phases…" — unrelated). This
  needs a per-line read against Spitting Slug's actual oracle text before
  rewriting, so it stays in this drawer rather than being fixed here.
- `convex/cards/sets/lea/white.ts:575` — a deferred capability note (floating
  repeatable special action, Reprisal-shaped) cites `CR 118.4 / 116.2b` for a
  MANA-based special action, not life.

**2. A much larger family of bare slash-list citations of the shape
`NNN.Nx / 118.4`** (no `CR ` immediately before `118.4`, so outside this
issue's literal-substring count) that mirror the SAME underlying "118.4 cited
for a may-pay/Kicker/tap-mana-ability life or mana leg" pattern — e.g.
`convex/game.ts:1072,1885,1973,6462,6472,6748,7283,7297,7839,14197`,
`convex/gre/kicker.ts:248`, `convex/gre/legalActions.ts:112,267`,
`convex/gre/pendingChoiceSubmit.ts:122,144`, `convex/gre/state.ts:2091,2582,
20509,21031`, `convex/gre/moves.ts:132`, `convex/gre/effects/validate.ts:2067,
4127`, `convex/gre/effects/interpreter.ts:4451`, plus their test-file
`describe`/`it` mirrors. Several of these ARE about a life leg
("`CR 702.33a / 118.4` — the LIFE leg of every paid Kicker") and are the same
bug in a different citation shape; others (`CR 117.3a / 118.4` for the
generic yes/no may-pay DECISION) are plausibly about the OPTIONAL-payment
mechanic rather than life at all, and need a card-by-card read to classify,
not a blind rewrite. Note that `117.3a` itself is ALSO the wrong id for that
decision — printed, it is "The active player receives priority at the
beginning of most steps and phases…", not the may/if-you-do rule (that's
118.12) — so a future pass on this group should not assume `117.3a` is
correct just because it currently sits next to `118.4`; it needs the same
print-and-check treatment `#2559` gave every `118.4` site.

**Evidence.** `grep -rn "118\.4" --include="*.ts" --include="*.tsx" convex src | grep -v "CR 118\.4"` returns ~45 sites, mostly this `NNN.Nx / 118.4`
slash-list shape.

**Why it may not deserve its own issue yet.** The `#1` group (2 remaining
sites; a third was corrected during review of this draft) is tiny and easy to
fold into any future citation-hygiene pass — arguably a one-line fix each, not
worth a standalone ticket. The `#2` group is bigger and requires
the same per-line judgment call #2559 exercised (which of these are genuinely
about a life leg vs. the may-pay yes/no decision vs. Kicker's total-owed
bookkeeping) — closer to "a general resolvable-but-wrong scanner", which
#2559 explicitly called out of scope as much larger work. A future issue
should scope it explicitly as "may-pay / Kicker / tap-mana-ability 118.4
slash-list citations", not reopen #2559.
