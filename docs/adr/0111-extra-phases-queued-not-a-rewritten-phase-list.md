# ADR 0111 — Extra phases are a queue consumed at a phase-exit seam, not a rewritten phase list; and a structural bot credit is for value OUTSIDE the rollout horizon, never for "extra-anything"

- **Status**: Accepted
- **Date**: 2026-08-27
- **Context issues**: #2494 (Fear of Missing Out's delirium attack trigger), #1864 (Fog-style prevention cleared early)
- **Supersedes / amends**: nothing. Extends the CR 500.7 extra-turn design already in `phases.ts`.

## Context

`convex/gre/phases.ts` walks a fixed, ordered `PHASE_ORDER` array by index
(`nextPhase`, phases.ts:174-179). Nothing lets an effect insert a phase, so
CR 500.8 — _"Some effects can add phases to a turn. They do this by adding the
phases directly after the specified phase. If multiple extra phases are created
after the same phase, the most recently created phase will occur first."_ — was
unimplemented. Fear of Missing Out (DSK) is the catalogue's only card wanting it
and has carried a stub since #691; a user filed #2494 when its delirium trigger
did nothing.

Two structural facts about this engine shape the decision:

1. **Combat is six sibling `Phase` values, not a phase containing steps.** There
   is no `"COMBAT"` value; `END_OF_COMBAT` is last in `PHASE_ORDER`, so the
   step's exit and the combat _phase's_ exit are the same instant (the reasoning
   is already recorded at phases.ts:3383-3389). CONTEXT.md's **Phase** entry
   records the same flattening.
2. **`GameState.extraTurns` (CR 500.7) is a direct precedent**: an optional
   LIFO array, popped at the turn crossing in `advanceTurn`, listed in
   `PERSISTED_OPTIONAL_KEYS`, crossing the wire on `projectPublicState`'s
   `...state` spread.

## Decision

### 1. A queue on `GameState`, consumed at a phase-exit seam

`state.extraPhases?: Array<{ kind: "combat" }>`. LIFO. Consumed at the
`END_OF_COMBAT` exit inside `advancePhase`, using the shape
`repeatCleanupStep` already established for CR 514.3a (phases.ts:3408-3412):

```ts
const next = extraCombatOwed ? "BEGINNING_OF_COMBAT" : nextPhase(state.phase);
```

Re-entry is at `BEGINNING_OF_COMBAT`, not `DECLARE_ATTACKERS`: CR 506.1 makes a
combat phase five steps, so "at the beginning of combat" triggers fire again —
correctly, and for free through the existing `firePhaseBeginTriggers` call.

`PHASE_ORDER` is **not** rewritten, and no per-turn phase list is materialised
on the state. The array stays the static description of one canonical turn; the
queue is the only mutable turn-structure state.

### 2. Queue entries are UNANCHORED

An entry records its kind, not the phase it was created after. Consumption is
hardcoded to the `END_OF_COMBAT` exit.

The CR-shaped alternative — `{ kind, after: Phase }`, consumed wherever
`after === state.phase` — was rejected _for now_. Because of fact (1) above, an
effect resolving in `DECLARE_ATTACKERS` would have to anchor to
`END_OF_COMBAT`, which needs a step → enclosing-phase-exit map: exactly the
CR 505.1a-adjacent classification #2494 scoped out. Entries are **objects, not
bare strings**, so adding `after` later is a field addition, not a reshape.

Every extra-combat effect that exists resolves during combat, so the hardcoded
seam is correct for all of them.

### 3. Unconsumed entries are discarded at the turn boundary

`advanceTurn` clears `state.extraPhases`. Unreachable with today's only
consumer (a trigger cannot resolve after its own combat — a non-empty stack
blocks phase advance), but without it the first grant that resolves after the
last combat of a turn leaks a spurious extra combat into the _opponent's_ turn.
This is the leak class `ai/blade/runner.ts:175-188` documents for `extraTurns`.

### 4. The CR 500.8 ordering clause is asserted at the queue, not through phases

With one phase kind in the vocabulary, two queued entries are indistinguishable,
so LIFO and FIFO produce identical observable phase sequences. #2494's
"most-recently-created-first, with a test" is therefore **not dischargeable
through observed phase order** and is asserted on the queue itself. Observable
ordering becomes testable when a second kind ships — not before, and the test
should not pretend otherwise.

### 5. The duration model is fixed FIRST, as its own change

`tickAllDurations` (phases.ts:2691) has four call sites, one of which is
`endCombatStep` — every `END_OF_COMBAT` exit, on every turn, even with no
attackers. Ten turn-scoped flags gate their clear on
`view.phase === "CLEANUP"`; **eight do not**, and each of the eight documents
itself as "until end of turn":
`preventAllCombatDamageThisTurn`, `combatDamageRedirectToPermanent`,
`gazeOfPainActiveThisTurn`, `damageCapShields`,
`landManaReplacedToBlueThisTurn`, `highTideThisTurn`,
`landManaRidersThisTurn`, `allCreaturesMustAttack`.

Four are live bugs today with no extra combat involved — cast High Tide in the
precombat main phase, tap Islands in the postcombat main phase, get no extra
`{U}`. The function's own comment at phases.ts:3080-3082 states the invariant
the eight violate.

Extra combat makes all eight strictly worse and cannot be verified correct
until they are fixed, so the class fix is a **prerequisite change**, not a
slice of the extra-phase work. #1864 is re-scoped from one flag to the class;
its filed fix patched the card, not the class.

### 6. No structural bot credit for an extra combat

`selectRootMove`'s extra-turn credit (search.ts:2489-2541) exists for one
stated reason: an extra turn's value is _washed out_ of the rollout, because
ADR 0015 terminates each rollout at the start of the bot's next turn and
`extraTurns` is popped at that very crossing, so the granted turn is never
played out.

An extra combat is **inside** the horizon. `playoutRollout` breaks only on
`turnChanged && activePlayerId === botId` (search.ts:1283-1291), so an extra
combat is simulated and its value reaches the edge's mean reward by ordinary
measurement. A credit would double-count. Two further reasons it is wrong:
`extraTurnValue`'s own magnitude comment already decomposes an extra turn as
"draw (150) + untap/main tempo (50) + **combat (150)**"; and
`botExtraTurnGrantDelta` returns 0 unless `move.kind === "cast-spell"`, while
this grant arrives on a triggered ability.

**The reusable rule: a structural credit compensates for value the rollout
cannot see. The test is inside-horizon vs outside-horizon — never
"extra-anything gets a credit".**

What the bot owes instead: not stalling in the second attack step, proven by a
`must` blade entry.

## Consequences

- One optional `GameState` field, one branch in `advancePhase`, one line in
  `advanceTurn`. `PHASE_ORDER` and every phase-entry hook are untouched.
- Combat re-entry is correct largely by construction, verified rather than
  assumed: `state.combat` is only ever built fresh at `DECLARE_ATTACKERS` entry
  (phases.ts:2036) and torn down on `END_OF_COMBAT` exit (`endCombatStep`);
  `hasAttackedThisTurn` is turn-scoped and survives (state.ts:463-479);
  "until end of combat" durations already expire per combat phase; Phase Stop
  is a live per-phase lookup, so a re-entered step honours the same preference.
- The phase rail needs no reordering: it derives `isPast` from
  `PHASE_GROUPS.indexOf(phase)` (controller-phase-list.tsx:26-27), so a second
  combat resets the cursor into the combat range and postcombat phases
  correctly stop reading as past — they were never reached. Only a header
  marker (`· Combat 2`) is added, because otherwise nothing distinguishes the
  two combats: the turn counter is unchanged, the phase tab renders an
  identical `T6·COM` + `ATTACK` under a documented 7-character budget
  (controller-phase-tab.tsx:67-70), and there is no player-visible event log
  (`manual-log.tsx` is Manual Play only, ADR 0080; nothing in `src/` reads
  `game_events`).
- `extraPhases` reaches the client with no projection work —
  `projectPublicState` returns `{ ...state, … }` and `getPublicState` declares
  no `returns` validator.
- The new Op is **not** a thin skin the way `extraTurn` is (its registry note
  says so explicitly): it fronts genuinely new engine capability, so the
  primitive lands first and `SpellContext.grantExtraCombat` skins it.
- `scenarioGenerator` takes the same explicit skip as `extraTurn` ("mutates a
  turn-boundary queue, not a same-step outcome"), so the smoke sweep does not
  cover this Op and a hand-written test is owed.
- A preset scenario captures the **pre-attack** setup; `extraPhases` joins
  `scenarioBuilder`'s not-lowered list, so mid-extra-combat state is
  deliberately not capturable.

## Alternatives rejected

- **Materialise a mutable per-turn phase list on `GameState`.** Fully general
  and CR-shaped, but replaces a static, greppable, test-covered array with
  per-turn state that every phase-entry hook, the serializer, the wire
  projection and the bot would have to reason about — a large blast radius for
  one card.
- **A counter (`pendingExtraCombats?: number`).** Simpler, but does not
  generalise to a second phase kind without migrating a `number` into an array
  mid-flight, and has no order to assert at all.
- **Anchored entries now** (`{ kind, after }`). Rejected as speculative — see
  decision 2. Deliberately left one field away.
- **Fix only `preventAllCombatDamageThisTurn`, as #1864 was filed.** Patches
  the card, not the class; leaves four live bugs and seven latent ones.
- **Implement the extra-combat structural credit as #2494 specified.** Wrong
  on three independent grounds — see decision 6.
