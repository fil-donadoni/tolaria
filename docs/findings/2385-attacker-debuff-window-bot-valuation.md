---
title: Tamiyo, Seasoned Scholar's +2 lost its dedicated bot valuation when grantAttackerDebuffWindow was removed
discoveredBy: 2385
status: draft
confidence: low
---

**What is wrong.** Review round 2 on PR #2487 removed the card-shaped
`grantAttackerDebuffWindow` Op and re-expressed the +2 ("Until your next
turn, whenever a creature attacks you or a planeswalker you control, it
gets -1/-0 until end of turn") as `delayedTrigger` with a new
`until-next-turn-creature-attacks-you` timing, whose inline body is a plain
`pump -1/-0` (`convex/cards/sets/mh3/blue.ts`). The dedicated bot valuer
(`ATTACKER_DEBUFF_WINDOW_VALUE = 15`, `convex/gre/ai/opValuers.ts`) was
removed along with the Op — the ability is now valued through the generic
`delayedTrigger` valuer, which recurses into the nested script
(`valueEffectScript(op.effects, ctx)`) and prices the inline `pump -1/-0` at
its face magnitude (`Math.abs(-1) * PUMP_PER_STAT`), the same way Battle
Cry's `this-turn-creature-blocks` body is valued.

**Why this might be a real regression.** The removed valuer's own comment
explained the old flat `15` as a deliberate over-the-single-hit price: the
window can debuff MULTIPLE attackers across a whole turn cycle (this turn
AND the opponent's entire next turn), and the static valuer has no way to
see the opponent's future attacks, so it priced "one guaranteed hit"
conservatively high relative to a single `pump`. The generic
`delayedTrigger` recursion has no such repetition-aware adjustment — it
prices the body as if it fires exactly once, which likely undervalues this
ability (and, by the same mechanism, Battle Cry's own repeating
`this-turn-creature-blocks` pump) relative to how often it actually
resolves in a real game.

**Why it may not deserve its own issue.** (1) Battle Cry already ships
with this exact undervaluation shape and nobody has flagged it as a bot
strength bug — so this may be an accepted, pre-existing simplification
for every repeating delayed-trigger body, not something specific to
Tamiyo. (2) Fixing it properly would mean teaching `valueEffectScript` (or
a `delayedTrigger`-specific wrapper) to scale by an ESTIMATED fire count
for a repeating timing, which is exactly the kind of "genuinely context-only"
valuation problem `PUMP_PER_STAT`-style static scoring is not built to
solve well — a scaling heuristic here could easily overcorrect. (3) No
self-play or scenario evidence was gathered for this PR that the bot
actually misvalues Tamiyo's +2 in practice; this is a code-reading
observation, not a measured regression. `confidence: low` reflects both (2)
and (3).
