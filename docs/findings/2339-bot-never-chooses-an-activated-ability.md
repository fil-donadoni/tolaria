---
title: The search applies an activation's COSTS but never its payoff, so the bot enumerates activated abilities and then never chooses one
discoveredBy: 2339
status: draft
confidence: high
---

**What is wrong.** The bot can now _see_ and _realise_ a graveyard-source
activation (issue #2339 made `enumerateMoves` scan the player's own graveyard,
and the executor drives it end to end), but it never **picks** one. Both search
leaves apply only the COSTS of an `activate-ability` move — the ability never
reaches the stack, so nothing ever resolves it and no depth or iteration budget
lets the search observe its payoff. Every activation therefore evaluates at best
equal to `pass`, and `pass` wins the tie.

This is distinct from the sibling finding
`2339-canactivate-abilities-invisible-to-bot.md`, which is about
**enumeration** (a `canActivate` closure the Move enumerator skips). This one is
about **valuation**: the move is enumerated, legal, and executable, and the
search still declines it.

**Evidence.** `convex/gre/search.ts:709` carries the gap in its own comment
("KNOWN GAP — tracked by issue #1920 … this applies the COSTS only: the ability
never reaches the stack"); `convex/gre/applyMove.ts:401` says the same for the
greedy 1-ply sandbox ("Costs only (see file header)").

Reproduction (run on this branch, then again with this PR's own new search leg
no-op'd):

- Deterministic board: Fanatic of Rhonas in `p1`'s graveyard, four untapped
  Forests, `PRECOMBAT_MAIN`, empty stack, empty hand — the eternalize activation
  is the only non-`pass` move `enumerateMoves` offers.
- `search(state, "p1", { iterations: 3000 }, seed)` returns `pass` for
  `seed = 1..6` — **6/6**.
- Control, same harness, one castable Grizzly Bears added to hand:
  `cast-spell` for `seed = 1..3` — **3/3**. The probe is not degenerate; the
  search does pick a material move when the simulator models one.
- Replacing this PR's new `exileThis` leg in `applyMoveInSearch`
  (`convex/gre/search.ts:722-741`) with a no-op changes nothing: still `pass`
  6/6. **The gap is pre-existing and catalogue-wide, not introduced by #2339.**

Consequence for issue #2339 specifically: its acceptance criterion "Bot can see,
choose and realise the activation (deterministic scenario)" is met for _see_ and
_realise_ but **not for _choose_**.

**Why it may not deserve its own issue.** It already has one, still open:
**#1920 — "[bot] search cannot see an activated ability's payoff —
`applyMoveInSearch` applies costs only"**, which `convex/gre/search.ts:709`
names in its own comment. #1890 item 3 (the board-side flexibility term) is
documented as blocked on the same fix. So this finding is a _datapoint_ on
#1920 — a deterministic, seed-stable reproduction with a control — rather than
a new ticket. It is worth writing down anyway because the gap is
invisible from any single feature's tests: every activated-ability card ships
with green enumeration tests, green execution tests, and a bot that will never
play it, and nothing in the per-card workflow surfaces that.

The one thing that _might_ deserve separate treatment: there is no
catalogue-wide guard asserting "for a board where an activation is the only
material move, the search does not return `pass`". Such a guard would have made
this loud once, instead of rediscovered per card.
