---
title: the tap planner keeps one option per colour, so a "two mana in any combination" source pays {U}{U} but not {B}{B} or {U}{B}
discoveredBy: 3027
status: draft
confidence: high
---

**What is wrong.** `planManaPayment` (`convex/gre/moves.ts`) stores **one
realisation per colour** per permanent — the FIRST detailed option producing
that colour:

```ts
for (const c of MANA_COLORS) {
    if ((opt.mana[c] ?? 0) > 0 && !options.has(c)) options.set(c, realisation);
}
```

Issue #3027 taught the planner a source's yield, but not that a source has
several yields to choose between. Black Lotus is unaffected because each of its
five choices is single-colour, so the first option producing a colour is also
the best one. A source whose choices MIX colours is not.

**Evidence.** Relic of Sauron, "{T}: Add two mana in any combination of {U},
{B}, and {R}" — six detailed options, measured on this branch:

```
opt {U:2}      choiceIndex 0
opt {U:1,B:1}  choiceIndex 1
opt {U:1,R:1}  choiceIndex 2
opt {B:2}      choiceIndex 3
opt {B:1,R:1}  choiceIndex 4
opt {R:2}      choiceIndex 5

{U}{U} -> [{ relic, manaChoiceIndex: 0 }]     ✓
{B}{B} -> null      ← {B:2} exists at index 3
{R}{R} -> null      ← {R:2} exists at index 5
{U}{B} -> null      ← {U:1,B:1} exists at index 1
```

`{B}` resolves to index 1 (`{U:1,B:1}`, the first option containing B), which
credits one B and one floating U; the second B then has no source left.

Both halves also predate issue #3027 (all four were `null` on `98ed936f4`), so
this is an unfixed sibling, not a regression.

**Two different fixes, worth separating.** `{B}{B}` and `{R}{R}` need only a
better per-colour choice: keep the option producing the MOST of a colour rather
than the first, at equal `planOptionRank`. That is small and local. `{U}{B}`
does not yield to any per-colour heuristic — the right option depends on the
WHOLE cost, so it needs the greedy to look ahead, which is a different piece of
work.

**Why it may not deserve its own issue.** It is invisible on almost every
board: it needs a single source whose one activation makes 2+ mana across
DIFFERENT colours, and the cube has very few. Against that, it makes the
planner look arbitrary on one card — `{U}{U}` works and `{B}{B}` does not, off
the same permanent, for no reason a player can see — and the cheap half is
genuinely cheap. If it is ticketed, ticket the per-colour half alone; the
lookahead half is a solver, and this planner is deliberately greedy.
