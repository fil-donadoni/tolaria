# Companion: a single-card slot outside the game + a {3} summon special action

Status: accepted

## Context

Cube slice #701 adds **Companion** (CR 702.139) — three cards (Zirda, Lurrus,
Lutri). Companion is not an on-resolution effect; it is a subsystem:

1. A **deck-construction condition** on the maindeck (Lurrus: every permanent
   card has mana value ≤ 2; Lutri: singleton; Zirda: every permanent card has
   an activated ability).
2. The card sits **outside the game** (in the sideboard) and, when its
   condition holds, is **revealed at game start** (CR 702.139c).
3. Once per game, its controller may take a **special action** at sorcery
   timing (CR 702.139a): pay {3} to put it into their hand, from where it is
   cast normally. The special action does **not** use the stack.

The engine already has: a **Sideboard** on the Match deck copy (snapshotted at
`createGame`, but **not** into `GameState` — the library build uses the maindeck
only); a `pendingCast` mana-payment rail with a shared auto-tap solver
(`solveSmartAutoTap`); a `play-land` **special action** precedent (costless);
per-format deck validators (`convex/formats.ts`, ADR 0036); the graveyard-cast
permission seam (`grantGraveyardPlay` Op with a `maxManaValue` cap +
`oncePerTurn`); and copy-target-spell (Fork). It does **not** have a command
zone / "outside the game" zone, nor activated-ability cost reduction (the cost
seam extended by ADR 0063 covers **cast** costs only).

## Decision

**Model Companion as a single per-player slot, not a general zone; summon it via
a dedicated special action with its own lightweight mana-payment state.**

- **`companion?: { instance; used }` slot on `PlayerState`** — not a general
  `outsideGame: CardInstanceState[]` zone. Companion is one declared, once-
  summoned card; a slot models exactly that (the card, its revealed status, the
  once-per-game spent flag). A full outside-the-game zone (Wishes, Karn) would
  touch every zone-move / SBA / projection site for a zone only Companion uses,
  and is not in this slice. The slot can later be absorbed into such a zone.

- **Auto-declare at game init.** The engine scans the player's sideboard
  snapshot for a Companion-keyword card whose condition the maindeck satisfies
  and places it in the slot — no pre-game UI phase. At most one companion is
  ever legal, and the only thing an explicit declaration step adds is the
  competitive "hide my companion" bluff, irrelevant to a study/solo engine.
  Re-scanned per Bo3 game (post-sideboard).

- **Condition as a predicate closure, not a data descriptor.** Each companion's
  restriction is `(deck: CardDefinition[]) => boolean` in a `convex/gre/
companion.ts` engine module, with shared combinators (`everyPermanent(pred)`)
  factored as they repeat. The companion family's conditions are so
  heterogeneous (even/odd MV, one-card-type, shared creature types, deck-size
  +20, cost-symbol uniqueness) that a tagged-union descriptor would balloon to
  ~one variant per card — a closure in disguise. This is deckbuild logic, not an
  on-resolution effect, so **DSL-first does not govern it** (issue #701: the
  subsystem is "engine work, authored as data/engine, not as Ops"). The
  `companion` keyword is one Mechanics Registry row; the predicate is separate
  engine data.

- **Summon = a `summon-companion` special action + a dedicated
  `pendingCompanionPay` state (not `pendingCast`).** Offered at sorcery timing
  (own main phase, empty stack, priority) when the slot is present, `used` is
  false, and {3} is affordable. It collects {3} through the shared auto-tap
  **solver**, then moves the instance to hand and sets `used = true` — never
  touching the stack (CR 116, not an ability). The payment rides a small
  dedicated pending state rather than overloading `pendingCast`: companion pay
  has no targets, modes, or stack item, so forcing it through `pendingCast`
  means a special-case "no-stack, deliver-to-hand" flag threaded through every
  `pendingCast` consumer (SBA, projection, cancel, triggers). The dedicated
  state reuses the expensive shared part (the solver) without polluting the cast
  rail.

- **Public projection + serialization.** The slot is revealed to both players
  (CR 702.139c). `companion` and `pendingCompanionPay` join
  `PERSISTED_OPTIONAL_KEYS`.

- **UI: a companion slot in the pile cluster.** The revealed card renders
  alongside the library/graveyard/exile chips (`board-piles`), with a "Companion
  {3}" summon button modeled on `graveyard-flashback-button` (shown only when
  the special action is legal). Not a new command-zone-like board region — one
  revealed card + one action does not warrant it.

- **Scope: framework + Lutri + Lurrus this slice; Zirda is a stop-and-issue
  stub.** Lutri (Fork-copy + flash + singleton condition) and Lurrus (a new
  **static, permanent-sourced, permanent-cards-only, MV≤2, once-per-turn**
  variant of the existing graveyard-cast permission seam + its condition) reuse
  near-existing capabilities. Zirda's static **activated-ability cost
  reduction** ("abilities you activate cost {2} less… can't reduce below one
  mana") is a genuine new cost-system capability on a different seam (the
  ability-cost path reads `ability.cost.mana` raw) with an unusual ≥1-mana
  floor. Shipping Zirda with that clause inert is the exact Guard-A anti-pattern,
  so Zirda stays a commented stub with a tracked capability issue, to be built
  deliberately as cast-cost reduction was (ADR 0063).

## Considered options

- **General `outsideGame` zone** instead of a slot — rejected for this slice:
  touches every zone site for a Companion-only zone; deferred until a real
  "outside the game" consumer (Wishes) lands.
- **Explicit pre-game declaration phase** — rejected: adds a phase + both-player
  gate + UI + projection for a bluff a study engine does not need.
- **Data-descriptor condition vocabulary** — rejected: 1:1 with cards.
- **Overload `pendingCast` for the {3} payment** — rejected: special-case flag
  leaks into every cast-rail consumer.
- **Model summon as an activated ability** — rejected: mismodels CR 116; the
  companion is not a permanent and the action does not use the stack.
- **Build all three cards (activated-ability cost reduction now)** — deferred:
  Zirda's cost reduction is an orthogonal cost-system extension deserving its
  own slice, not a smuggle.

## Consequences

- A new non-`GameState`-zone holder (`companion` slot) exists; code that
  enumerates zones must not treat it as one. Serialization drift guard covers
  the two new optional keys.
- The bot driver's dispatch must handle `summon-companion` +
  `pendingCompanionPay` compile-time-exhaustively (`src/lib/ai/brain.ts`), or
  the bot stalls — with a simple "summon when affordable at sorcery timing"
  heuristic.
- Lurrus adds a reusable **static** graveyard-cast-permission variant to the
  existing turn-scoped seam — inheritable by future permanent-sourced grants.
- Zirda ships as a tracked stub; activated-ability cost reduction is captured as
  its own capability issue.
- The slot is a deliberate, upgradable narrowing: if a general outside-the-game
  zone is ever needed, the slot's declare + summon hooks migrate onto it.
