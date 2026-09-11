---
title: The moveZone fromZones bulk sweep is worth 0 to the Bot, emits no LIBRARY_SEARCHED, and forces a find CR 701.23b makes optional
discoveredBy: 2711
status: draft
confidence: medium
---

**What is wrong.** `moveZone`'s FOURTH shape — `player` + `fromZones` +
`filter` + `to`, issue #1104 — carries three holes that only bite once a card
uses it over a LIBRARY. Lobotomy (`convex/cards/sets/tmp/multicolor.ts`) sweeps
only the graveyard and hand and routes its library leg through an explicit
`choice(kind: "search-library")`, so it dodges all three. Haunting Echoes
(issue #2711) cannot: it searches for the name of every card it exiled, and
CR 701.23h makes that ONE search, which needs a candidate filter over a SET of
names — `EffectCardFilter.name` holds one literal or one ref.

1. **Bot valuation is zero, and the resulting state scores zero too.** The
   `moveZone` valuer returns `{ points: 0, tags: ["tempo"] }` for any shape
   carrying no `target` — written for the whole-zone `player`/`from`/`to`
   shape, which has no victim to price, and catching `fromZones` by accident.
   The search does not make up for it against an ordinary opponent:
   `EvalTerms.library` is exactly zero above `deckingHorizon`,
   `EvalTerms.graveyard` is exactly zero with no graveyard engine on the
   battlefield, and `EvalTerms.graveyardReach` is exactly zero for a graveyard
   with no reachable payoff — which is every ordinary one. So against a
   creature deck with no recursion and 40 cards left, casting a five-mana
   sorcery produces a score delta of 0 while spending the mana, and the Bot
   ranks it BELOW passing. It does light up against a graveyard-payoff
   opponent, the card's real matchup, so this is a ranking hole rather than a
   freeze.

2. **No `LIBRARY_SEARCHED` event.** CR 701.23f: "Any abilities that trigger on
   a library being searched will trigger." The only emission site is
   `emitLibrarySearchedEvent`, called when a `search-library` PendingChoice
   commits — which is exactly why Lobotomy's library leg emits one and a
   `fromZones` sweep does not. A card whose Oracle text says "search that
   player's library" searches no library as far as the engine is concerned.

3. **The find is forced where CR 701.23b makes it optional.** The rule's own
   worked example is Splinter, Haunting Echoes' near twin: the caster "must
   find the Howling Mine in the graveyard, but may choose to find zero, one, or
   two of the Howling Mines in the library." Declining is not a dead option —
   exiling a card the opponent no longer wants THINS their deck and improves
   every draw they make afterwards.

**Evidence.** `convex/gre/ai/opValuers.ts:758` (the `!("target" in op)`
branch) and `:2314` (`OP_BENEFICENCE.moveZone: "neutral"`, pre-existing with a
written reason — that seam is fine); `convex/gre/evaluate.ts:288-308` for the
three exactly-zero eval terms; `convex/gre/effects/interpreter.ts`'s
`"fromZones" in op` branch, which calls `ctx.moveCardById` per match and
nothing else; `convex/gre/state.ts:11377` `emitLibrarySearchedEvent` with its
single caller `convex/gre/pendingChoiceSubmit.ts:1277`. `SpellContext` exposes
no search-emission primitive, so (2) needs one added alongside the interpreter
change.

**Why it may not deserve its own issue.** (2) is currently unobservable in
play: the only card reading `LIBRARY_SEARCHED` is Wan Shi Tong, Librarian, a
commented-out stub in `convex/cards/sets/tla/blue.ts` blocked on an unrelated
draw-primitive gap. (3) cannot be fixed at the card at all — it needs the
set-of-names search capability above, which is a DSL slice someone has to
charter. (1) is one branch condition wide, but fixing it is a bot-path diff and
`.claude/rules/bot-development.md` requires a `must` blade entry in the same
PR, so it is not a drive-by. All three would be worth ONE ticket together —
"make a `fromZones` library sweep a real search" — and that ticket gets
materially stronger with each further card in the family (Splinter, Jester's
Cap, Jester's Mask), since each adds a card promising a search the engine does
not perform.

---

**Adjacent, found in the same pass, unrelated to the sweep:**

- **`boundMatchesFilter` is the last `excludeSupertype` fail-open.** Issue
  #2711 threaded `supertypes` into every reader-backed `matchesCardFilter` call
  site, but `convex/gre/effects/interpreter.ts:495-504` hand-builds
  `{ name, types, subtypes, manaValue }` out of the `SNAP_*` array, which has
  no supertypes slot — so `filter.excludeSupertype` still matches everything
  and `filter.supertype` matches nothing against a CR 608.2h snapshot. Needs a
  new `SNAP_SUPERTYPES` slot; no shipped card reaches it today.
- **The `forEach` frozen-set rule is cited as CR 608.2i repo-wide; it is
  608.2h.** 608.2h is "the answer is determined only once, when the effect is
  applied" — the claim every one of these comments makes, quoted almost
  verbatim at `convex/cards/types.ts:12663`. 608.2i is the look-back-in-time
  EXCEPTION to it. Sites: `convex/gre/effects/interpreter.ts:62`, `:5873`,
  `:5926`, `:6011`; `convex/cards/types.ts:12663`, `:12723`, `:16026`; and the
  structured `cr: "608.2i"` field at
  `convex/cards/mechanicsRegistry.ts:3040`. `cr:lint` cannot catch it — the
  scan only asks whether an id resolves, and 608.2i does. (The unrelated
  `603.3b / 608.2i` citations around simultaneous-event batching are a
  different claim and were not assessed.)
