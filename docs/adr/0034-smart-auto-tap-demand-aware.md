# ADR 0034 — Smart auto-tap: demand-aware mana source selection

**Status:** Accepted (2026-06-22)

## Context

When a **Player** casts a **Spell** without manually picking which mana sources
to tap, the engine auto-selects them server-side. Today's solver
(`solveAutoTap`, `convex/gre/autoTap.ts`) optimizes a single objective:
**minimum tap count** that covers the cost. Among the many minimal-tap plans it
finds, it returns the _first_ one (iterative-deepening DFS, with a thin
`helpsColoredNeed` ordering that only looks at the _current_ cost).

This strands resources. Concrete failure (the motivating bug):

> Board: **Tundra** (W/U), **Island** (U), **Tropical Island** (U/G). Hand:
> **Savannah Lions** ({W}). Cast **Time Walk** ({1}{U}).
>
> {1}{U} needs two taps. The solver may tap **Tundra** for U — leaving no white
> source — so Savannah Lions is stranded in hand, even though tapping Island (U)
>
> - Tropical Island (generic) and leaving Tundra up would have kept Lions
>   castable.

The solver is blind to everything except the cost in front of it. MTG Arena's
auto-tapper, by contrast, prefers colorless/basic sources, keeps the most colors
open, and — crucially — looks at the rest of your hand to keep future plays
live. We want that behavior, CR-neutral (auto-tap is a UX convenience; the CR
does not dictate _which_ legal sources a player taps).

Several forks needed a deliberate choice, each hard to walk back once the solver
and its tests depend on the shape:

1. **What is the objective?** Stay minimal-tap-only, or layer a second objective
   (preserve future plays) on top?
2. **What counts as a "future play" worth preserving**, and how is it scored?
3. **How is the best plan found** without the solver ballooning on dual/rock-heavy
   boards?

Out of scope and tracked separately: **sacrifice sources** (Black Lotus stays
manual by deliberate UX, issue #321) and **restricted-mana sources** (Mishra's
Workshop — builds on the already-shipped `restrictedMana` pool, ADR 0022, as its
own follow-up). The partial fallback `solveAutoTapPartial` (issue #321) is left
untouched.

## Decision

### Two-objective solver: minimal taps first, then preserve Demands

The **minimal-tap-count invariant is kept** — smart auto-tap never taps more
sources than the cost requires, and never auto-taps a source the player would
want to hold for instant-speed response. It changes only _which_ sources within
the minimal set are chosen.

Among all minimal-tap plans that cover the cost, pick the one that maximizes the
number of **Demands** (see CONTEXT.md) left satisfiable after payment — the
active player's other castable hand spells and activatable on-board abilities.
When no Demand discriminates between plans (or the hand is empty), fall back to a
**flexibility heuristic** that reproduces Arena's "spend colorless/basics first,
leave the most colors open."

### Demand scoring (per-demand, in isolation)

A **Demand** is counted toward a plan's score when, _after_ this payment, the
remaining untapped sources plus leftover floating mana can still pay that
Demand's cost **considered alone**. Demands that share a source therefore both
count even though only one could actually be played — this **isolation
over-count** is accepted: it keeps scoring O(demands × plans) and pure, and the
realistic failure mode (stranding a whole color) is exactly what isolation
catches. True set-packing (max simultaneously-castable set) was rejected as
combinatorial overkill — players rarely empty a hand in one turn.

Candidate Demands are filtered to those that are:

- **Affordable before payment** — playable from the _current_ untapped sources
  (don't preserve mana for something unreachable anyway);
- **Legal at the current timing** — sorcery-speed Demands (creatures, sorceries,
  future sorcery-speed-only activated abilities) count only when the player is at
  sorcery timing (own main, empty stack, has priority); instant-speed Demands
  (instants, flash, most activated abilities) count whenever auto-tap runs. This
  is what makes the engine preserve {U}{U} for a **Counterspell** in hand while
  auto-tapping on the opponent's turn, yet _not_ preserve mana for a creature
  there.

Two refinements:

- **X-spells are included**, not skipped, at an assumed **X = 1** (an X-spell's
  effective preserve-cost is its base cost plus one generic) — on average at
  least one X is spent, so treating X=0 would under-preserve.
- **Activated abilities count once.** A repeatable ability (firebreathing
  `{R}: +1/+0`) is one Demand — "can I still activate it at least once?" — so
  repeatables don't dominate the score.

### Tie-break order (deterministic)

1. **Primary** — higher Demand-preservation score (above).
2. **Secondary** — maximize the flexibility of the remaining untapped sources
   (sum of distinct colors each can still produce). This _is_ the
   colorless/basics-first heuristic: leaving a 2-color **Tropical Island** open
   scores higher than leaving a 1-color **Mountain** open, so the solver spends
   the Mountain first by construction — no separate "prefer basics" rule needed.
3. **Tertiary** — lexicographic by tapped `cardId` (board order), so the same
   board always yields the same plan.

### Enumeration: collect-at-minimal-k, capped

Reuse the existing iterative deepening to find the smallest k that covers the
cost, then enumerate _all_ k-tap covering plans at that depth, score each, and
keep the best by the tie-break order. A hard **cap of 512** collected plans
guards against pathological boards (many 5-option mana rocks → combinatorial); on
overflow, the best-scored plan so far is returned. The work is pure synchronous
combinatorics over a small board (~≤10 sources) inside the existing
`selectManaSourcesForPayment` mutation — sub-millisecond; the cap is a safety
backstop, effectively never hit on real boards.

### Scope

Ships **unconditionally to all seats** — solo, vs-AI, 2-player, and the AI bot's
own casts (it pays through the same mutation, reading _its own_ hand; no
hidden-information leak because auto-tap always reads the _paying_ player's hand).
The **partial fallback** (`solveAutoTapPartial`, issue #321) and **sacrifice
sources** (Black Lotus) are unchanged. **Restricted-mana sources** (Mishra's
Workshop) are a separate follow-up on the ADR 0022 pool.

## Consequences

- The motivating bug is fixed: Time Walk leaves Tundra up, Savannah Lions stays
  castable; Counterspell mana is preserved on the opponent's turn.
- The minimal-tap invariant means smart auto-tap can never make a board _worse_
  than today on tap count — it only redistributes which sources are spent.
- Determinism is preserved (tertiary `cardId` tie-break), so wire-format and GRE
  tests stay reproducible.
- The AI bot inherits less mana-screw misplay for free.
- **Isolation over-count is a known, accepted approximation** — two hand cards
  contending for one source both score as preserved. Upgrading to true
  set-packing is possible later but is not planned.
- **Deferred:** smart selection for the partial/sacrifice path (#321) and
  restricted-mana sources in auto-tap (Workshop, builds on ADR 0022) — separate
  issues. Black Lotus remains intentionally manual.
