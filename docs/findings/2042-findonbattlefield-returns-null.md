---
title: findOnBattlefield returns null while its neighbours return undefined, and nothing guards a `!== undefined` miss-test
discoveredBy: 2042
status: draft
confidence: medium
---

**What is wrong.** `findOnBattlefield` (`convex/gre/state.ts:8699`) returns
`{ card, player, idx } | null`. Almost every caller consumes it with optional
chaining (`located?.card`), which is null-safe by accident rather than by
design — so the null-ness is invisible at the call site. The first caller in
this file that needed a plain "did we find it?" boolean wrote
`located !== undefined`, which is **true for a miss**, and the resulting bug
was silent in every targeted suite: it only surfaced in the whole-`node`
run, through two Nether Shadow assertions in a card test file the diff never
touched.

**Evidence.** The slip is in this PR's own history — `git log` on
`fix/issue-2042`, commit "fix: pin the intervening-if selfView id on a null
battlefield miss". `convex/gre/state.ts:8699-8708` returns `null`;
`convex/gre/state.ts:8710`ff (`findInPublicNonBattlefieldZones`) sits directly
beside it — worth checking whether the two agree on the sentinel. Repo-wide,
`grep -n "=== undefined\|!== undefined" convex/gre/state.ts` against the set of
null-returning finders would say how many other sites are one refactor away
from the same shape. Two cheap fixes exist and neither was in this ticket's
scope: normalise the finders on `undefined`, or give `findOnBattlefield` a
`hasOnBattlefield(state, id): boolean` companion so no caller writes the
comparison by hand.

**Why it may not deserve its own issue.** Today there is exactly one site that
tests the result for presence rather than dereferencing it, and it is now
correct with a comment naming the hazard. If the sweep above finds no second
site, this is a line on a lint/convention tracker rather than a ticket — the
generic "mixed null/undefined sentinels" complaint is not defensible on its
own.
