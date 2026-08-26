---
title: ISMCTS `avail` records nothing while a node is still widening, so `ucb1`'s log term understates availability
discoveredBy: 2684
status: draft
confidence: medium
---

**What is wrong.** `Edge.avail` is documented as "times this move was AVAILABLE
during selection" and feeds `ucb1`'s exploration term as `√(ln avail / visits)`.
But it is only ever incremented in the branch that runs when EVERY legal move at
the node is already in the tree. While a node still has an untried child —
which, at a main phase with 75–90 legal moves and a 400-iteration budget, is
most of the search — the expansion branch returns before any `avail` is touched.
So an edge opened on iteration 1 and an edge opened on iteration 89 both sit at
`avail = 1` for the whole widening phase, and `ln(avail) = 0` makes the
exploration term exactly zero for every edge until the node is fully open.

**Evidence.** `convex/gre/search.ts` — `avail` is initialised to 1 where an edge
is opened, and `edge.avail += 1` appears only inside the "all legal moves are in
the tree" loop; the `if (untried.length > 0)` branch above it `return`s first.
`ucb1` is `exploit + weights.ucbC * Math.sqrt(Math.log(edge.avail) / edge.visits)`,
so `avail === 1` ⇒ explore term 0. The practical consequence is that the
historical selection rule at a wide node is not really UCB1 at all during
widening: it is "open one child uniformly at random per iteration", and the
first time exploration has any effect is iteration ~N+1 for an N-move node.
This is a plausible contributor to the 19.7% search-decided share that issue
#1893 measured and #2684 was cut from — but #2684 changes the SELECTION rule
under a variant, and deliberately does not touch the production bookkeeping.

**Why it may not deserve its own issue.** It may be intentional: no edge can be
"skipped over" during widening, since the widening branch is unconditional, so
there is an argument that no availability has been declined yet and 1 is the
honest count. Fixing it would change every production search's exploration
profile — a strength change, so it would need its own ladder verdict, which
makes it a candidate rung on map #1892 rather than a bug. It is also possible
the right fix is the one #2684's variant already makes moot at ordinary priority
nodes.
