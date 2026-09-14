---
title: A `mayPay` Op inside a `forEach` body reads the FIRST iteration's answer for every later iteration
discoveredBy: 1701
status: draft
confidence: high
---

**What is wrong.** `scopedContext` (`convex/gre/effects/interpreter.ts`) scopes
only `noteChoice` / `recallChoice` / `requestChoice` to the current `forEach`
iteration; `requestMayPay` is passed through UNWRAPPED. The enqueue side is
fine — the stored key folds `resolutionStep`, which is the Op's per-iteration
pre-order position, so each iteration really does prompt its own player. The
READ is not: `readBoolBinding` → `readBinding` → the scoped `recallChoice`
misses on the scoped name and falls back to the unscoped one, and
`recallChoice` returns the FIRST key whose suffix matches. So every iteration
after the first pays (or declines) its own cost and then reads iteration one's
boolean.

Measured on HEAD during PR #3568's review, on a players-set `forEach` whose body
is `[mayPay, if($paid) -> gainLife]`: the second player DECLINES and still gains
the life.

**Evidence.** `convex/gre/effects/interpreter.ts` — `scopedContext`'s returned
object (three wrapped methods, `requestMayPay` absent); `recallChoice` in
`convex/gre/state.ts` (first-suffix-match fallback). Ten shipped card sites put
a `mayPay` inside a `forEach` body:

- `convex/cards/sets/inv/multicolor.ts`, `convex/cards/sets/inv/green.ts` (x2)
- `convex/cards/sets/ulg/blue.ts`
- `convex/cards/sets/atq/colorless.ts`
- `convex/cards/sets/lea/colorless.ts` (x3), `convex/cards/sets/lea/green.ts` (x2)

Each needs checking individually: a body whose mayPay is offered to the SAME
player every iteration is unaffected, and one whose `if` happens to be
symmetric may be unobservable. The count is the blast radius, not the bug count.

PR #3568 fixed the same defect for the NEW `payVariableMana` Op by scoping
`requestNumberChoice` the way `requestChoice` is scoped, with an interpreter
test that reds when the scoping is removed — so the one-line shape of the fix is
already demonstrated, and `requestMayPay` would take the identical line.

**Why it may not deserve its own issue.** The fix is one line and the pattern is
proven, so it could ride the next PR that touches the interpreter. The argument
for its own issue is the ten call sites: the line is trivial, deciding whether
each of those ten cards was silently relying on the broken behaviour is not, and
that is exactly the work a ticket exists to schedule. It is also a live
correctness bug on shipped cards, which is a different urgency from a
refactor — and no test reds today, which is why it survived this long.
