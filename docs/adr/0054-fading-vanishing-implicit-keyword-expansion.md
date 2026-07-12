# Fading & Vanishing: implicit keyword expansion + counter-removed trigger

## Context

Fading (CR 702.32) and Vanishing (CR 702.63) are the engine's first
counter-clock keyword abilities. Both enter with N named counters and shed one
per upkeep, then sacrifice the permanent — but they differ in _when_ the
sacrifice fires:

- **Fading N** — at your upkeep, remove a fade counter; **if you can't**
  (none remain), sacrifice it. The sacrifice waits for the turn it finds no
  counter to remove: a single upkeep triggered ability that checks-then-acts.
- **Vanishing N** — at your upkeep, remove a time counter; and, as a
  **separate** triggered ability, when the **last** time counter is removed —
  by upkeep _or any other means_ — sacrifice it. The sacrifice keys off the
  removal that empties the permanent, so it dies one upkeep sooner than fading.

Four facts about the existing engine shape the decision:

1. **No card-definition expansion step exists.** `getDefinition`
   (`convex/cards/index.ts:440`) returns the stored `CardDefinition`
   unchanged — no keyword is parsed into abilities at load time. The only
   `staticAbilities` string handling is a runtime substring match at ETB
   (echo's `item.echoPending`, `convex/gre/state.ts:3155`); there is no parser
   for a parameterized keyword like `"fading 3"`.

2. **`entersWith.counters` is re-read live from the def each ETB**
   (`convex/gre/state.ts:3161`) — so a synthesized `entersWith` only has to be
   present on the def the seam returns.

3. **Counters emit no event.** `removeCounter` / `addCounter`
   (`convex/gre/state.ts`) mutate `card.counters` and return a count; the game
   event union has no `COUNTER_REMOVED`. A "when the last time counter is
   removed" trigger has no existing dispatch source. Counters are otherwise
   referenced only as activation _costs_.

4. **Token ETB bypasses `entersWith`.** `createToken` / `createTokenCopyOf`
   (`convex/gre/state.ts:7398,7405`) push directly to the battlefield and never
   run the `entersWith`-counters block, which lives only in the
   spell-resolution ETB funnel. A copy of a vanishing creature (Chronozoa)
   would enter with **zero** time counters and never expire.

## Decision

**1. Fully-implicit keyword expansion at the `getDefinition` seam.** A card
declares only `staticAbilities: ["fading 3"]` / `["vanishing 3"]`. A memoized
wrapper at the single `getDefinition` choke point (`convex/cards/index.ts:440`)
parses the `N`, and injects — once per definition — both the
`entersWith.counters` entry (`fade`/`time`, count N) and the synthesized upkeep
`TriggeredAbility` (built by the existing `phaseTrigger` factory). `N` lives in
exactly one place: the keyword string. The seam catches prints, tokens, and
late-registered defs alike.

**2. `COUNTER_REMOVED` as a first-class trigger event.** `removeCounter` emits a
`COUNTER_REMOVED` event carrying the instance, counter type, and remaining
count; the `triggers.ts` dispatch loop gains a matching branch. Vanishing is
then modelled CR-faithfully as **two** abilities — an upkeep remove-trigger and
a separate `COUNTER_REMOVED`-listening ability that sacrifices when a `time`
counter reaches zero — so it fires however the last counter leaves. Fading needs
no event: its single upkeep trigger checks `getCounterCount === 0` and
sacrifices inline.

**3. Shared token-ETB counter injection.** The `entersWith`-counters logic is
routed so token creation runs it too (a shared ETB helper, not a
Chronozoa-local patch), so any token copy of a fading/vanishing permanent
re-enters with fresh counters. Fix-the-class, not the single card.

A single parameterized expander module serves both keywords (they share ETB
counters + an upkeep remove-trigger; they diverge only on counter name and
sacrifice mechanism).

## Consequences

- **Authoring is one line.** `staticAbilities: ["fading 3"]` is the whole
  contract; no `entersWith`/`triggeredAbilities` boilerplate, no `N` desync.
  Fade counters remain an ordinary resource, so Parallax Wave / Parallax Tide
  spend them via a `removeCounter` activation cost with no special casing — the
  fading sacrifice then fires naturally once the pool is drained, driving the
  leaves-the-battlefield return.
- **`COUNTER_REMOVED` is reusable.** Proliferate-down, `-1/-1` clocks, and any
  future "whenever a counter is removed" card inherit the event free. Cost:
  it must be added to the serialized event surface and survive the wire
  projection.
- **The seam wrapper runs on every def read** — hence memoized by definition
  identity. A card that mutates its own printed `staticAbilities` at runtime
  (none today) would not re-expand.
- **Divergence from a shortcut is deliberate.** Folding vanishing's sacrifice
  into the upkeep step was rejected: it is correct only while nothing removes a
  time counter outside upkeep, and it forfeits the reusable event. The
  extra event + branch is the price of CR-faithfulness and generality.
