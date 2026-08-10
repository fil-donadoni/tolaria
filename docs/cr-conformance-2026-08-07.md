# CR conformance audit — 2026-08-07 revision

Issue #2432. Produced against `main` @ `1d57eb14`.

## Baseline

The audit is written against the vendored Comprehensive Rules (ADR 0098). The
next revision diffs against exactly this document:

```json
{
    "effectiveDate": "2026-08-07",
    "fileName": "MagicCompRules 20260807.txt",
    "txtUrl": "https://media.wizards.com/2026/downloads/MagicCompRules%2020260807.txt",
    "pdfUrl": "https://media.wizards.com/2026/downloads/MagicCompRules%2020260807.pdf",
    "indexUrl": "https://magic.wizards.com/en/rules",
    "sha256": "2ed5f1bbb4f8771c84a6f2944a218428c6c5ccba21110a5d101b9a51a4c062b3",
    "vendoredAt": "2026-08-10"
}
```

## Scope and caveats

**This audit's floor is the 2025-09-19 revision, and a floor is not a
guarantee.** The item list came from diffing 2025-09-19 → 2026-08-07, because
2025-09-19 is the most recent revision any past session is recorded as having
read. The engine has been written against revisions going back to 2022 —
twelve distinct versions appear in past transcripts — so a rule that changed
before 2025-09-19 and has been stable since is **outside this audit** and
remains unverified. Nothing here says the engine matches the CR; it says the
engine was checked against the 74 changed and 69 added core rules of this one
revision boundary.

**Only the new text is vendored.** `data/cr/comprehensive-rules.txt` holds the
2026-08-07 document and nothing else — there is no offline copy of the
2025-09-19 text. Every verdict below is therefore reached by reading the
**printed new rule** against the engine's **actual behaviour at the mapped
site**, never by trusting a code comment: a comment above a line is evidence
about the revision it was written against, not about the code. Where the issue
body quotes old text, it is marked as quoted, not printed.

**Compare by content, never by id.** The 603.2, 500.4/500.5, 506.3, 508.4 and
601.5–601.8 letter shifts produce two symmetrical traps: a rule whose id moved
but whose text is unchanged reads as DIVERGENT (it is CITATION-ONLY), and a
rule whose text changed under a stable id reads as COMPLIANT (it is DIVERGENT).
Both were checked for on every item.

### Verdict legend

| Verdict           | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| **COMPLIANT**     | The engine already matches the new text. The verdict names the code or test that does. |
| **DIVERGENT**     | The engine does not match. The verdict names `file:line` and sketches a fix.           |
| **N/A**           | No card in the catalogue reaches the rule. The verdict names the reason.               |
| **CITATION-ONLY** | The behaviour is right; only the cited rule id is now wrong. Hand to #2429.            |

"The engine implements nothing for this rule" is **not** N/A on its own. N/A
was asserted only after checking the catalogue — see §H for the reachability
sweep those verdicts rest on.

### Overlap with other tickets

- **#2430 — CR 605.1a / Chromatic Sphere.** Already diagnosed and ticketed.
  Recorded here as **DIVERGENT** without re-derivation; see §G.8.
- **#2429 — unresolvable and drifted citations.** 42 rule ids cited in this
  repo resolve to nothing (`bun run cr:lint`). This audit adds a second class
  to that ticket: ids that _do_ resolve but now point at different text because
  of the letter shifts. Every such site found here is listed under
  CITATION-ONLY and is **#2429's work, not a behaviour fix** — the two tickets
  must not both edit the same comment. The collected list is in §I.

---

## A — Triggered abilities

### A.1 — CR 603.2 (parent) and the `d`–`h` letter shift

Printed:

> **603.2.** Whenever a game event or game state matches a triggered ability's
> trigger event, that ability automatically triggers. The ability doesn't do
> anything at this point.

> **603.2d** An ability may state that a triggered ability triggers additional
> times. In this case, rather than simply determining that such an ability has
> triggered, determine how many times it should trigger, then that ability
> triggers that many times. […] An effect that states a triggered ability of an
> object triggers additional times refers only to triggered abilities that
> object has, not to any delayed or reflexive triggered abilities (see rule
> 603.7 and rule 603.12) that may be created by abilities the object has.

**Verdict: COMPLIANT (parent), and no citation drift.**

The clause the issue asks after — old `603.2e`'s "effects that refer to a
triggered ability of an object … not delayed triggered abilities" — has not
been dropped. It is now the **second half of new 603.2d**, merged into the
"triggers additional times" rule, which is what shifted every later letter up
one.

The drift trap does not bite here because **no non-test source cites any of the
shifted letters.** Every `603.2` citation under `convex/` and `src/` is either
to the bare parent rule or to `603.2b`, which did not move:

| Cited                                                                                                                                                             | Site                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/game.ts:2976`, `convex/game.ts:6056`, `convex/gre/pendingTargetOrigin.ts:270`                                                                             | `603.2b` — targets locked at announcement. Unchanged text ("When a phase or step begins…" is 603.2b's neighbour; the cited claim is the targets-locked one and is carried by 603.3d, which also did not move). |
| `convex/game.ts:2980`, `:13669`, `:13727`, `:13944`, `convex/gre/state.ts:807`, `:3388`, `:4357`, `:4422`, `:5267`, `:5931`, `convex/gre/triggers.ts:279`, `:292` | bare `603.2` — parent unchanged                                                                                                                                                                                |

`triggerCapReached` / `noteTriggerFired`
(`convex/gre/triggers.ts:283-304`) implement `TriggeredAbility.maxTriggersPerTurn`,
the "this ability triggers only twice each turn" cap, tallied per permanent
instance on `CardInstanceState.triggersThisTurn`
(`convex/gre/state.ts:807-817`) and cleared at the turn boundary inside
`advanceTurn` (`convex/gre/phases.ts:2983-2990`), alongside the activation
tally. That is a legitimate reading of the parent rule and is not affected by
the shift.

### A.2 — CR 603.2h (new): "Do this only once each turn."

Printed:

> **603.2h** A triggered ability may have an instruction followed by "Do this
> only once each turn." This ability triggers only if its source's controller
> has not yet taken the indicated action that turn.

**Verdict: N/A — no card in the catalogue carries the templating.**

A catalogue sweep for `"only once each turn"` / `"Do this only once"` finds
exactly one hit, and it is a **commented-out stub**: Ancient Cornucopia,
`convex/cards/sets/big/green.ts:234` (tracked-by #1841). Nothing shipped.

**Do not conflate this with `maxTriggersPerTurn`.** 603.2h is
_action_-conditioned — the ability does not trigger if the controller has
already taken the indicated action, whatever caused it. `maxTriggersPerTurn`
(`convex/gre/triggers.ts:283-290`) is a _trigger-count_ cap on one ability of
one instance. They coincide only when the ability is the sole way to take the
action. Shipping a 603.2h card needs a new per-turn _action_ tally keyed on the
instruction's verb, not a bigger `triggersThisTurn`.

The frequently-shipped phrase **"Activate only once each turn"**
(e.g. `convex/cards/sets/drk/red.ts:325`, `convex/cards/sets/lea/green.ts:560`)
is CR 602.5's activated-ability restriction — a different rule, served by
`ActivatedAbility.oncePerTurn` (`convex/cards/types.ts:1304`) and
`CardInstanceState.activationsThisTurn` (`convex/gre/state.ts:802-806`).

### A.3 — CR 603.1b (new): multi-condition triggers and "all"

Printed:

> **603.1b** A triggered ability may have more than one trigger condition, and
> an instruction that refers to whether "all" of those conditions have happened
> during a particular period. This refers to whether or not all of those
> conditions have occurred during that period, regardless of whether that
> ability has triggered based on those conditions.

**Verdict: N/A — the multi-condition _shape_ is supported; no shipped card
carries the "all" instruction.**

The structural prerequisite exists and is the repo's mandated standard: one
Oracle line = one `TriggeredAbility` with `event: GameEventType | GameEventType[]`
(`convex/cards/types.ts:8196`), matched by `triggerHandlesEventType`
(`convex/gre/triggers.ts:269-276`).

What is absent is the **predicate**: the engine has no notion of "were all of
this ability's conditions met during period P". A sweep of shipped oracle text
for `all of (those|these)` / `if all` / `each of those` returns only
single-`event` abilities where the phrase refers to a set of chosen objects
(`convex/cards/sets/drk/colorless.ts:877`, `ice/black.ts:633`,
`ice/white.ts:1075`, `leg/green.ts:80`, `:567`), not to trigger conditions.

Shipping such a card requires a per-turn (or per-period) record of _which_
conditions have fired, independent of whether the ability itself triggered —
603.1b's "regardless of whether that ability has triggered" is the load-bearing
half, and it cannot be derived from `triggersThisTurn`. It also runs into a
second known limit: an array-`event` ability cannot read `$event` in an Effect
Script (`.claude/rules/gre-development.md` § Card definition checklist), so the
discriminating logic would have to be native.

### A.4 — CR 603.10a: the "look back in time" list

Printed:

> **603.10a** Some zone-change triggers look back in time. These are
> leaves-the-battlefield abilities, abilities that trigger when a player
> sacrifices a permanent, abilities that trigger when a card leaves a
> graveyard, and abilities that trigger when an object that all players can see
> is put into a hand or library.

**Verdict: COMPLIANT for the categories the catalogue reaches.**

`collectTriggers` (`convex/gre/triggers.ts:318`) explicitly re-scans sources
that have already left, using two batch-local maps built at
`convex/gre/triggers.ts:330-365`:

- `recentlyDead` — ids carried on `CREATURE_DIED`, looked up in the relevant
  player's graveyard (`triggers.ts:341`, `:350-354`);
- `recentlyLeft` — `instanceId → toZone` from `PERMANENT_LEFT`, which the
  comment at `triggers.ts:476-482` records as emitted for **dies AND exile**,
  looked up in the recorded destination zone (`triggers.ts:342-343`,
  `:355-365`).

The doc comment at `triggers.ts:309-317` states the intent in CR 603.10 terms
and names the canonical case (Fungusaur's "is dealt damage" trigger firing
after the Fungusaur has died). The same maps also arm the indefinite
instance-leave-watch for delayed triggers (`triggers.ts:483-490`).

Note on the shrinkage the issue flags: because the old text is not vendored, I
cannot verify _which_ entries were trimmed, only that the engine's implemented
look-back — leaves-the-battlefield, including sacrifice and exile, both of
which route through `PERMANENT_LEFT` — is a **subset** of the four categories
the new rule lists. Implementing a subset of a shrunken list cannot be a
too-much-look-back divergence. The two categories the engine has no look-back
for, "a card leaves a graveyard" and "an object all players can see is put into
a hand or library", are unreached: no shipped card triggers on either.

### A.5 — CR 603.12 / 603.12a: reflexive triggers

Printed:

> **603.12.** A resolving spell or ability may allow or instruct a player to
> take an action and create a triggered ability that triggers "when [a player]
> [does or doesn't]" take that action or "when [something happens] this way."
> These reflexive triggered abilities follow the rules for delayed triggered
> abilities (see rule 603.7), except that they're checked immediately after
> being created and trigger based on whether the trigger event or events
> occurred earlier during the resolution of the spell or ability that created
> them.

> **603.12a** Normally, if the trigger event or events occur multiple times
> during the resolution of the spell or ability that created it, the reflexive
> triggered ability will trigger once for each of those times. However, if a
> resolving spell or ability includes a choice to pay a cost multiple times and
> creates a triggered ability that triggers when that payment is made, paying
> that cost one or more times causes the reflexive triggered ability to trigger
> only once.

**Verdict: COMPLIANT on 603.12; N/A on 603.12a's new repeat-payment carve-out.**

Reflexive triggers are built and checked immediately after creation, and are
excluded from the APNAP ordering prompt because they are not plain triggers:
`buildMadnessReflexiveTrigger` (`convex/gre/triggers.ts:154`, Madness — CR
702.35a), `buildReboundReflexiveTrigger` (`convex/gre/triggers.ts:184`, CR
702.88a), and
`isPlainTrigger` (`convex/gre/triggers.ts:682`), with the reflexive semantics
documented at `convex/gre/triggers.ts:678-712`.

The **carve-out** — "a choice to pay a cost multiple times … triggers only
once" — has no shipped card. No card in the catalogue creates a reflexive
trigger off a repeatable cost payment, so the engine's default (once per
occurrence, which 603.12a's first sentence still mandates) is never wrong
today. Anyone shipping such a card must add an explicit
one-fire-per-resolution latch; the current builders have no such gate.

---

## B — Turn structure and the mana pool

### B.1 — CR 500.4 (new meaning): effects expire as a step or phase _begins_

Printed:

> **500.4.** As a step or phase begins, if there are effects that last until
> that step or phase, those effects expire.

**Verdict: COMPLIANT.**

This is exactly what `performPhaseEntry` does. `tickAllDurations(state)` runs
on phase **entry** for the two boundaries the engine models this way:

- `convex/gre/phases.ts:1904` — `UNTAP`, before `untapStep`, so a permanent is
  back to its printed characteristics for the rest of the step;
- `convex/gre/phases.ts:1913` — `UPKEEP`, before the next-upkeep delayed
  triggers fire.

The tick is keyed to the boundary **and** the effect's controller by
`tickDuration` (`convex/gre/state.ts:234-258`), which maps
`Duration.phase ∈ {"untap","upkeep","end-of-combat","end-of-turn"}` to a `Phase`
and returns the duration unchanged on a non-matching boundary — so an
end-of-turn effect is untouched by an upkeep tick.

The comments at those two sites cite `CR 502.1` and `CR 500.2`, which in the
2026-08-07 text are, respectively, the phasing turn-based action and the
"a phase or step in which players receive priority ends when…" rule — neither
says anything about effects expiring on entry. New **500.4** is now the right
citation for both. Behaviour is correct; the citations are not. → §I.

### B.2 — CR 500.5 (new): effects expire, _then_ mana empties, as a step ends

Printed:

> **500.5.** As a step or phase ends, if there are effects that last until the
> end of that step or phase, those effects expire. **Then** any unspent mana
> left in a player's mana pool empties. This is a turn-based action that
> doesn't use the stack (see rule 703.4q).

> **703.4q** As each step or phase ends, any unspent mana left in a player's
> mana pool empties. See rule 500.5.

**Verdict: DIVERGENT (ordering) — `convex/gre/phases.ts:3117` vs `:3120`.**

`advancePhase` runs the two halves in the wrong order:

```
convex/gre/phases.ts:3116   // CR 500.4: mana pools empty when a step or phase ends
convex/gre/phases.ts:3117   emptyManaPools(state);
convex/gre/phases.ts:3120   if (state.phase === "END_OF_COMBAT") endCombatStep(state);
                              └─ convex/gre/phases.ts:3110  tickAllDurations(state);
```

Mana is emptied **first**, and only then do the end-of-combat duration effects
expire. New 500.5 fixes the opposite order explicitly ("…those effects expire.
Then any unspent mana … empties").

**Fix sketch.** Move the `emptyManaPools(state)` call in `advancePhase` from
before the `endCombatStep` branch to after it, so the sequence at every step
boundary is _expire, then empty_. That single move covers the combat-phase
boundary; the other boundaries already have no expiry-at-end work, so their
behaviour is unchanged. The ordering is only observable through an effect that
alters mana emptying and lasts until end of combat — new **CR 702.189a**
firebending is exactly that shape ("Until end of combat, you don't lose this
mana as steps and phases end"), and no such card ships today, so this is a
correctness fix with no current behavioural symptom. Scope it together with the
citation retarget in §I rather than as its own PR: the same lines are involved.
Add a `phases.ts` unit test asserting that an end-of-combat-scoped
mana-retention marker is still live when `emptyManaPools` reads the pool.

### B.3 — CR 500.5a (new): "until end of combat" expires at the end of the phase

Printed:

> **500.5a** Effects that last "until end of combat" expire at the end of the
> combat phase, not at the beginning of the end of combat step.

**Verdict: COMPLIANT.**

`tickAllDurations` for `end-of-combat` durations is called from
`endCombatStep` (`convex/gre/phases.ts:3110`), and `endCombatStep` is invoked
from `advancePhase` at `convex/gre/phases.ts:3120` **only when
`state.phase === "END_OF_COMBAT"`, i.e. as that step exits** — which, since
END_OF_COMBAT is the last step of the combat phase, is the end of the combat
phase. The doc comment at `convex/gre/phases.ts:3084-3088` states this is
deliberate and names the reason ("must happen on phase EXIT, not entry, so that
abilities targeting an attacking creature (e.g. Desert) remain legal throughout
the step"). `tickDuration`'s boundary map (`convex/gre/state.ts:238-246`) sends
`"end-of-combat"` to the `END_OF_COMBAT` phase and nowhere else.

### B.4 — CR 500.5b (new): "until end of turn" defers to 514.2

Printed:

> **500.5b** Effects that last "until end of turn" are subject to special
> rules; see rule 514.2.

> **514.2.** Second, the following actions happen simultaneously: all damage
> marked on permanents (including phased-out permanents) is removed and all
> "until end of turn" and "this turn" effects end. This turn-based action
> doesn't use the stack.

**Verdict: COMPLIANT.**

`finalizeCleanup` (`convex/gre/phases.ts:2267`) runs `tickAllDurations` at
`convex/gre/phases.ts:2269` and clears `damageMarked` in the same function —
the two halves of 514.2, in the cleanup step, not at the end of the ending
phase. `tickDuration` maps `"end-of-turn"` to `CLEANUP`
(`convex/gre/state.ts:239-240`), so an end-of-turn duration cannot expire at any
earlier boundary.

---

## C — Combat

### C.1 — CR 506.3d (new content at a shifted letter) and CR 506.3g (new)

Printed:

> **506.3d** If an effect puts a creature onto the battlefield attacking during
> the declare blockers step, combat damage step, or end of combat step, that
> creature enters the battlefield unblocked. See rule 508.4d.

> **506.3g** If a resolving spell or ability would cause a battle to become an
> attacking or blocking creature, that part of the effect does nothing.

**Verdict: 506.3d COMPLIANT (by construction). 506.3g N/A.**

**506.3d.** The token-creation path takes the attacking branch at
`convex/gre/state.ts:16715-16717`:

```ts
if (spec.entersAttacking && state.combat) {
    markAttacking(state, token);
}
```

`markAttacking` (`convex/gre/combat.ts:53`) adds the id to
`combat.attackerIds` and sets `isAttacking`; it never writes
`blockerAssignments`. Blocked-ness in this engine is **derived**, not stored —
there is no `isBlocked` field on `CardInstanceState`; `getBlockersPerAttacker`
(`convex/gre/phases.ts:915`) reads
`getEffectiveBlockGraph(state).blockersByAttacker[attackerId]`. A token added to
`attackerIds` after blockers were declared is therefore never a key in that map
and is unblocked by construction, which is what 506.3d and 508.4d require. The
comment at `convex/gre/state.ts:16708-16714` records the deliberate decision not
to emit `ATTACKERS_DECLARED` for it (CR 508.4's "never attacked").

The rule's window is genuinely reachable: `state.combat` is set on entry to
`DECLARE_ATTACKERS` (`convex/gre/phases.ts:1933`) and cleared only inside
`endCombatStep` (`convex/gre/phases.ts:3102`), which runs as END*OF_COMBAT
\_exits* — so it is live through declare blockers, combat damage and end of
combat, and the `entersAttacking` branch does fire in those steps. Three shipped
cards use it: `convex/cards/sets/mid/white.ts:156`,
`convex/cards/sets/m3c/multicolor.ts:142`, `convex/cards/sets/clb/red.ts:141`.

**506.3g.** No Battle card exists. `"Battle"` appears only as a `CardType` enum
value (`convex/cards/types.ts:236`, `:247`, `:264`;
`convex/gre/constants.ts:124`) consumed by generic type-matching, e.g. Atraxa
(`convex/cards/sets/one/multicolor.ts:31`). No Siege subtype, no defence
counters, no protector concept. Nothing can reach the rule.

### C.2 — CR 508.4 / 508.4a / 508.4d

Printed:

> **508.4.** If a creature is put onto the battlefield attacking, **its
> controller chooses which defending player, planeswalker a defending player
> controls, or battle a defending player protects it's attacking as it enters
> the battlefield** (unless the effect that put it onto the battlefield
> specifies what it's attacking). […] Such creatures are "attacking" but, for
> the purposes of trigger events and effects, they never "attacked." They remain
> attacking creatures until they're removed from combat or the combat phase
> ends, whichever comes first.

> **508.4a** If a creature would be put onto the battlefield attacking a
> certain player, and that player is no longer in the game, the creature is put
> onto the battlefield but is never considered an attacking creature. […]

> **508.4d** A creature that's put onto the battlefield attacking during the
> declare blockers step, combat damage step, or end of combat step enters the
> battlefield as an unblocked creature. It remains unblocked until it is
> removed from combat, an effect says it becomes blocked, or the combat phase
> ends, whichever comes first.

**Verdict: 508.4d COMPLIANT. 508.4's "never attacked" clause COMPLIANT.
508.4's attack-target choice DIVERGENT. 508.4a N/A.**

**508.4d** — same evidence as §C.1. The "remains unblocked until … an effect
says it becomes blocked" half is also satisfied: with blocked-ness derived from
the block graph and no effect in the catalogue writing `blockerAssignments`
mid-step, nothing can retroactively block such a token.

**"Never attacked"** — `markAttacking` (`convex/gre/combat.ts:53`) is separate
from `recordAttackerDeclared` (`convex/gre/combat.ts:93`), which is the only
writer of `hasAttackedThisTurn` / `creatureAttackedThisTurn`. The
`entersAttacking` path calls only the former, so an entering attacker is
`isAttacking` without ever having "attacked" — exactly 508.4/508.4c.

**DIVERGENT — the attack-target choice is not offered.**
`convex/gre/state.ts:16715-16717` calls `markAttacking(state, token)` with no
attack-target argument, and `markAttacking` (`convex/gre/combat.ts:53`) writes
only `combat.attackerIds` + `isAttacking`. It never writes
`combat.attackTargets`, so `attackTargetExcessSink`
(`convex/gre/phases.ts:974`, read at `:1013` and `:1074`) finds no entry and
the token is treated as attacking the defending **player**. CR 508.4 requires
the controller to choose among the defending player, a planeswalker that player
controls, and a battle they protect, unless the creating effect specifies.

**Fix sketch.** Give the `entersAttacking` token spec an optional attack-target
field for the "unless the effect specifies" case, and — when it is absent and
the defending player controls at least one planeswalker — raise a pending
choice from the token-creation path before `markAttacking`, writing the pick
into `combat.attackTargets[tokenId]`. The choice must auto-resolve when the
only legal option is the player (per the repo's auto-resolve-when-no-real-option
convention), which is the case in every board the three shipped consumers reach
today, so the observable change is confined to boards with a defending
planeswalker. Costs: one new `PendingChoice` kind, its `expectedInput` entry,
the wire projection of the prompt, a Bot `Move` + valuation, and a serialization
key — the full new-choice-kind checklist.

**508.4a** — N/A in a 2-player game with no battles. "That player is no longer
in the game" cannot occur: a player leaving the game ends it
(2-player/solo only, per CLAUDE.md § Out of Scope). The planeswalker half of the
clause is only reachable once the attack-target choice above exists.

### C.3 — CR 506.4: removed from combat when its _protector_ changes

Printed:

> **506.4.** A permanent is removed from combat if it leaves the battlefield,
> if its controller **or protector** changes, if it phases out, if an effect
> specifically removes it from combat, if it's a planeswalker that's being
> attacked and stops being a planeswalker, **if it's a battle that's being
> attacked and stops being a battle**, or if it's an attacking or blocking
> creature that regenerates (see rule 701.19), stops being a creature, **or
> becomes a battle**. […]

**Verdict: N/A for the protector/battle clauses; the rest is pre-existing
behaviour outside this revision boundary.**

"Protector" is a battle-only concept (CR 310.9d–e), and no Battle card exists —
same evidence as §C.1's 506.3g. The clauses added by this revision are
unreachable.

The clauses the engine does implement are at
`removePermanentFromCombat` (`convex/gre/state.ts:7317-7340`, control change),
`convex/gre/state.ts:7959` / `:8031` (regeneration), and
`convex/gre/banding.ts:217` (CR 701.20 + 506.4). The doc comment at
`convex/gre/state.ts:7301-7316` records one accepted simplification — "CR 506.4d's
cascading un-block of a removed attacker's blockers is rare and out of scope" —
which is not part of this revision's delta and is therefore not this audit's
verdict to give.

### C.4 — CR 702.2c: deathtouch and lethal damage, redefined

Printed:

> **702.2c** Any nonzero amount of combat damage assigned to a creature by a
> source with deathtouch is considered to be lethal damage **for the purposes
> of determining if excess damage is being dealt**.

> **702.19b** The controller of an attacking creature with trample first
> assigns damage to the creature(s) blocking it. Once all those blocking
> creatures are assigned lethal damage, any excess damage is assigned as its
> controller chooses among those blocking creatures and the player,
> planeswalker, or battle the creature is attacking. **When checking for
> assigned lethal damage, take into account damage already marked on the
> creature and damage from other creatures that's being assigned during the
> same combat damage step**, but not any abilities or effects that might change
> the amount of damage that's actually dealt. The attacking creature's
> controller need not assign lethal damage to all those blocking creatures but
> in that case can't assign any damage to the player or planeswalker it's
> attacking.

> **510.1c** A blocked creature assigns its combat damage to the creatures
> blocking it. […] If two or more creatures are blocking it, it assigns its
> combat damage to those creatures divided as its controller chooses among
> them.

**Verdict: DIVERGENT — `convex/gre/phases.ts:1026`, `:1086`, `:1111`, and
`convex/game.ts:11436-11471`.**

Read the three rules together and the reference behaviour is: 510.1c/d let the
attacker divide freely among blockers with **no** lethal-damage ordering
constraint; the only ordering constraint is 702.19b's, and it applies solely to
the trample-over threshold; and 702.2c makes 1 damage from a deathtouch source
count as lethal for that threshold (the "excess damage" 702.19b assigns onward).
The rewording generalises 702.2c to also serve CR 120.4a's excess-damage
redirection; it does **not** take deathtouch out of the trample computation.

The engine diverges in three places, all in the same computation:

1. **Deathtouch is not consulted.** `lethal` is computed as
   `getCardToughness(state, blocker)` at `convex/gre/phases.ts:1026`
   (`buildAutoDamageAssignments`, 1 blocker), `:1086`
   (`buildDefaultDamageAssignments`, 1 blocker) and `:1111` (2+ blockers).
   There is no deathtouch-conditioned `lethal = 1` branch anywhere in
   `phases.ts:990-1150`. Deathtouch is read only post-hoc, at death-marking
   (`convex/gre/sba.ts:821`, `convex/gre/phases.ts:1400`, `:1676`), via
   `describeDamageSource`.
2. **Damage already marked is ignored.** 702.19b says the threshold must "take
   into account damage already marked on the creature and damage from other
   creatures that's being assigned during the same combat damage step". The
   three `lethal` computations read raw effective toughness only.
3. **The threshold is not enforced at all on manual assignment.**
   `setDamageAssignment` (`convex/game.ts:11371`) validates exactly two things:
   `total <= getEffectivePower(source)` (`convex/game.ts:11436-11442`) and that
   every recipient is a legal target — a blocker, or the defending player when
   the source has trample (`convex/game.ts:11457-11471`). Nothing enforces
   702.19b's "need not assign lethal damage to all those blocking creatures but
   in that case can't assign any damage to the player". A trampler can today be
   assigned 0 to its blocker and its full power to the defending player.

Divergences 2 and 3 are **reachable today** — any shipped trampler exercises
them. Divergence 1 is currently unreachable: no shipped card has both trample
and deathtouch, and no shipped effect grants deathtouch, so nothing today has a
deathtouch source assigning combat damage with trample. It is listed anyway
because it is the same computation and the same fix.

**Fix sketch.** Extract a single `lethalDamageForAssignment(state, blocker,
source, alreadyAssignedThisStep)` helper into `convex/gre/combat.ts` and route
all four call sites through it: `1` when `source` has deathtouch (CR 702.2c),
otherwise `max(0, effectiveToughness − damageMarked − alreadyAssignedThisStep)`
(CR 702.19b). Then make `setDamageAssignment` enforce the threshold as a
**validation**, not just a seed: if any amount is assigned to the defending
player (or to an attacked planeswalker), every blocker must have been assigned
at least its `lethalDamageForAssignment` value. Because the mutation is the
authority, `buildAutoDamageAssignments` /
`buildDefaultDamageAssignments` only need to seed a value the new validation
accepts. Consumers that must move with it: the client's damage-assignment panel
(`src/components/board/damage-assignment-panel.tsx:92`, `:134`) so the UI does
not offer an assignment the server will reject, and the Bot's damage folding
(`src/hooks/useVsAiDriver.ts:64`, `:641`, `src/lib/ai/realise.ts:89`,
`src/lib/ai/executor.ts:120`). Tests: a trampler blocked by a damaged blocker
(divergence 2), a trampler assigning 0-to-blocker being rejected (divergence 3),
and a deathtouch trampler assigning 1-and-trample-over (divergence 1) — the last
needs a scenario granting deathtouch, since no card supplies both.

---

## D — Casting

### D.1 — CR 601.5 (shifted): options available only via later choices

Printed:

> **601.5.** While announcing the choices of any targets and/or the division or
> distribution of any effects as described in rules 601.2c–d, some options may
> be available to a player only if other choices are made later in spellcasting
> process. In that case, the spell's controller may consider any other choices
> to be made during that process, including the choice of any objects that may
> be used to pay costs for that spell.

**Verdict: N/A — permissive rule, no shipped card reaches it.**

601.5 grants a permission, not an obligation: it lets a caster pick a target
that only becomes legal given a cost-payment choice made later. No shipped card
has a target whose legality depends on which objects pay its cost. The nearest
shipped shape — `castCondition` (`convex/cards/sets/ice/green.ts:121`, Blizzard,
#2102) — is a _card-level_ cast restriction evaluated before announcement, not
a target legality that a later choice unlocks.

There are **zero `601.5` citations** anywhere under `convex/` or `src/`, so the
letter shift creates no drift here.

### D.2 — CR 601.6 / 601.6a (new): continuing to cast after the condition lapses

Printed:

> **601.6.** If a player is no longer allowed to cast a spell after completing
> its proposal (see rules 601.2a–d), the casting of the spell is illegal and the
> game returns to the moment before the casting of that spell was proposed (see
> rule 733, "Handling Illegal Actions"). **It doesn't matter if a rule or effect
> would make the casting of the spell illegal while determining and paying that
> spell's costs (see rules 601.2f–h) or any time after the spell has been cast.**

> **601.6a** Once a player has begun casting a spell that had flash because
> certain conditions were met or that could be cast as though it had flash
> because certain conditions were met (see 601.3d), they may continue to cast
> that spell as though it had flash even if those conditions stop being met.

**Verdict: COMPLIANT — and compliant for the right reason, not by accident.**

Cast timing is validated **exactly once**, at `assertLegalAction(state, player,
cardInHand, "cast")` inside `announceCast` (`convex/game.ts:6872`, entry point
`convex/game.ts:6785`), which reads `isSorceryTiming` / `isSorceryTimingFor`
(`convex/gre/phases.ts:3450`, `:3473`). Between that check and the stack commit
(`tryAutoCommitPendingCast`, `convex/game.ts:3100`; push at `:3392`) nothing
re-validates timing. The only other `isSorceryTiming` call, at
`convex/game.ts:8627`, sits inside `autoTapForPayment`'s auto-tap heuristic and
is not a re-validation.

That is precisely what 601.6's second sentence and 601.6a require: cost
determination and payment (601.2f–h) cannot retroactively make the cast illegal,
and a lapsed flash condition cannot either.

601.6's _first_ sentence — an illegality arising during the proposal itself
(601.2a–d) rewinds the game — is unreachable: no player receives priority
during a cast, and every write site of `state.pendingTarget`
(`convex/game.ts:7150-7151`, `:12725`) names the caster, with
`assertExpectedInput` (`convex/game.ts:9936`) refusing any other actor, so no
state change can intervene between announcement and target selection. The rewind
machinery of CR 733 does not exist in the engine and is not needed.

The only conditional cast-timing permission shipped is player-scoped:
`state.castTimingFlashGrants`, gated by `hasCastTimingFlashGrant`
(`convex/cards/castRestrictions.ts:147-160`) and consumed in `castTimingBaseLegal`
(`convex/gre/rules.ts:388-403`), powering Teferi, Time Raveler
(`convex/cards/sets/war/multicolor.ts`). Its condition is a _duration_ ("until
your next turn"), cleared in `advanceTurn`, so it cannot lapse mid-cast — but
the engine would handle it correctly if it could. Every _self_-granted
conditional-flash card in the pool is commented out for an unrelated missing
primitive: Breaking Wave (`convex/cards/sets/inv/blue.ts:784`), Saproling
Symbiosis (`convex/cards/sets/inv/green.ts:1078`), Necromancy
(`convex/cards/sets/vis/black.ts:92`), all tracked-by #1975 / #2146.

### D.3 — CR 601.7 / 601.7a / 601.7b (new): an opponent choosing during a cast

Printed:

> **601.7.** Some spells specify that one of their controller's opponents does
> something the controller would normally do while it's being cast, such as
> choose a mode or choose targets. In these cases, the opponent does so when
> the spell's controller normally would do so.

> **601.7a** If there is more than one opponent who could make such a choice,
> the spell's controller decides which of those opponents will make the choice.

> **601.7b** If the spell instructs its controller and another player to do
> something at the same time as the spell is being cast, the spell's controller
> goes first, then the other player. This is an exception to rule 101.4.

**Verdict: N/A — no shipped card has an opponent choose during casting.**

Every cast-time choice in the engine is the caster's:
`pendingTarget.playerId` is the caster at both write sites
(`convex/game.ts:7150-7151`, `:12725`), `selectTarget` / `selectTargets` gate on
`assertExpectedInput(state, { playerId: args.playerId, expect: "target" })`
(`convex/game.ts:9936`), and `chosenModeId` is a caster-supplied `announceCast`
argument (`convex/game.ts:6810`). The Effect Script DSL's `chooser` field
(`convex/gre/effects/interpreter.ts:2982`) governs choices during **resolution**
of an already-stacked effect — a different moment.

A catalogue sweep for opponent-made choices finds only resolution-time ones:
Forgotten Lore (`convex/cards/sets/ice/green.ts:566`, "Target opponent chooses a
card in your graveyard…") and Preacher (`convex/cards/sets/drk/white.ts:246`,
whose own comment records "on resolution that opponent chooses which of their
creatures is taken"). Both are correct as resolution-time.

601.7a is additionally out of scope structurally: this is a 2-player /
solo engine, so "which opponent" is never a choice.

Shipping a 601.7 card needs `pendingTarget` / the mode choice to carry a
`chooserId` distinct from the caster, and the cast-commit gate to wait on it.
There are **zero `601.7` citations** in source, so no drift.

### D.4 — CR 601.8 (new): cost-altering spells do not reach the stack

Printed:

> **601.8.** Casting a spell that alters costs won't affect spells and
> abilities that are already on the stack.

**Verdict: COMPLIANT — structurally, the engine cannot violate it.**

Costs are computed once, during the cast, into a `CostModifiers` accumulator
(`convex/gre/state.ts:18293-18303`) that is derived inside the cast path and
consumed at payment time. No `StackItem` stores a cost, and nothing re-reads or
recomputes the cost of an item already on the stack — the stack item's
cast-time snapshot (`chosenX`, `kickerPayments`, `buybackPaid`, `targetAmounts`;
see `convex/gre/state.ts:5312`, `:5339`) records the _outcome_ of the payment,
not a live cost. A cost-altering permanent entering the battlefield therefore
cannot reach back into the stack.

There are **zero `601.8` citations** in source.

---

## E — Last known information

### E.1 — CR 702.2e / 702.15c / 702.90d: LKI for deathtouch, lifelink, infect

Printed:

> **702.2e** If an object is no longer in the zone it's expected to be in as an
> effect causes it to deal damage, its last known information is used to
> determine whether it had deathtouch.

> **702.15c** If an object is no longer in the zone it's expected to be in as an
> effect causes it to deal damage, its last known information is used to
> determine whether it had lifelink.

> **702.90d** If an object is no longer in the zone it's expected to be in as an
> effect causes it to deal damage, its last known information is used to
> determine whether it had infect.

**Verdict: DIVERGENT (structural) — `convex/gre/replacements.ts:753-791`.
Currently unreached by the catalogue for these three keywords specifically.**

All three rules funnel through one resolver. `describeDamageSource(state,
sourceInstanceId)` (`convex/gre/replacements.ts:753`) searches, in order, every
player's battlefield (`:762-777`) and then the stack (`:778-789`), reading the
live `card.staticAbilities`. If the source is in neither, it returns

```ts
{ colors: [], types: [], subtypes: [], staticAbilities: [] }   // replacements.ts:790
```

— an empty default, not last known information. Every consumer of the three
keywords reads that call: lifelink at `applyLifelinkLifeGain`
(`convex/gre/state.ts:7873-7880`) and `convex/gre/phases.ts:1318`, `:1391`;
deathtouch at `convex/gre/sba.ts:821` (`// CR 704.5h / 702.2b`) and
`convex/gre/phases.ts:1400`, `:1676`. Infect shares the chokepoint. So a source
that has left its expected zone as the damage is dealt is treated as having
**no** deathtouch, lifelink or infect — the opposite of what the rules require.

There is no LKI store: **ADR 0086 (`docs/adr/0086-last-known-copiable-values-store.md`)
is still status `proposed`**. The one place the engine does read last-known
values is an explicit opt-in on a different path,
`createTokenCopyOf`'s `opts.lastKnownFromGraveyardOrExile`
(`convex/gre/state.ts:13258-13269`, CR 608.2b / 702.129a, #2339).

**Reachability, stated explicitly.** A catalogue sweep finds no shipped card
that has deathtouch, lifelink or infect _and_ deals damage while its source has
left its expected zone: nothing deals damage from a graveyard or exile, and no
card pairs one of those keywords with a self-sacrificing damage ability. (The
near misses — Phlage, `convex/cards/sets/mh3/multicolor.ts:168`, and Grim
Lavamancer, `convex/cards/sets/tor/red.ts:19` — exile cards as a _cost_; the
source stays put.) So the three rules are, today, not reached.

It is recorded as DIVERGENT rather than N/A because the divergence is in the
**shared resolver**, and that resolver's fail-empty behaviour is reachable
right now through a different characteristic: destroy a damage-dealing source in
response to its own activated ability and `describeDamageSource` returns empty
`colors`, so a target with protection from that colour is not protected. That is
CR 608.2b / 609 territory rather than one of the three rules above, but it is the
same line of code and the same fix, and a ticket that fixes only the keyword
half would leave the bug in place.

**Fix sketch.** Implement ADR 0086's store — a pruned `GameState` map from
instance id to a copiable-values snapshot, written when a permanent leaves the
battlefield or the stack and pruned when nothing can still reference it — and
give `describeDamageSource` a final lookup into it before the empty default,
so the empty object becomes genuinely unreachable rather than a silent
fail-open. Promote ADR 0086 from `proposed` to `accepted` in the same change and
update its index row. Serialization must add the new optional key to
`PERSISTED_OPTIONAL_KEYS` or `TRANSIENT_KEYS` (`convex/gre/serialize.ts`) or the
drift guard fails. Tests: a scenario where a deathtouch source is destroyed in
response to its own damage ability and the damaged creature must still die, and
the protection-colour case above.

---

## F — Sagas

### F.1 — CR 714.3a (model change): the first lore counter is an intrinsic ability

Printed:

> **714.3a** Each Saga without read ahead has the intrinsic ability "This Saga
> enters with a lore counter on it." This ability creates a replacement effect
> (see rule 614.1c).

> **614.1c** Effects that read "[This permanent] enters with . . . ," "As [this
>
> > permanent] enters . . . ," or "[This permanent] enters as . . . " are
> > replacement effects.

**Verdict: COMPLIANT — and compliant in the exact shape the rule change moved
to, including the part that makes the change matter.**

The engine has never used a turn-based action for the first counter.
`expandChapterAbilities` (`convex/cards/abilities/sagas.ts:78-101`) injects the
clause into the _definition_ at expansion time:

```ts
entersWith: { ...def.entersWith,
    counters: [...existingCounters, { type: LORE_COUNTER, count: 1 }] }
```

— guarded so a Saga that already declares a lore entry-counter is not doubled
(`convex/cards/abilities/sagas.ts:86-90`) and idempotent under re-expansion
(`:84`), which matters because token copies re-enter the same seam.

The rules change is about whether this is a genuine **replacement effect**, and
here it is. Every permanent-entry site routes through the single applier
`applyEntersWithCounters` (`convex/gre/state.ts:5194`), whose module —
`convex/cards/entersWith.ts` — documents the CR 614.1c consequences it honours:
the counters are on the permanent the first instant it is observable with no
zero-counter window; nothing goes on the stack and nobody gets priority; the
clause is not an ability that renders on the stack; and SBAs and the layer
system see the counters on their first look.

The decisive evidence that this is modelled as an _ability_-generated
replacement rather than a post-ETB counter add is the CR 613.1f ability-loss
gate at `convex/gre/state.ts:5226-5242`: under a "loses all abilities" effect
(Humility, Blood Moon on a nonbasic land) the permanent enters with **no**
counters, and the comment records the consequence — "a Saga entering under Blood
Moon gets zero lore counters and never fires chapter I". A post-ETB add could
not produce that.

Shipped Sagas: `convex/cards/sets/dom/white.ts:17-28`,
`convex/cards/sets/mh2/colorless.ts:84-188`.

**CITATION-ONLY rider.** `convex/cards/entersWith.ts` (module header) and
`convex/gre/state.ts:5204` cite **CR 121.6** for "enters the battlefield with
counters". In the 2026-08-07 text, 121.6 is _"Some effects replace card
draws."_ The counters rule is **122.6** ("…also to an object that's given
counters as it enters the battlefield") with **122.6a** for who places them.
→ §I.

### F.2 — CR 714.3c (restated): the precombat-main lore counter

Printed:

> **714.3c** As a player's precombat main phase begins, that player puts a lore
> counter on each Saga they control with one or more chapter abilities. This
> turn-based action doesn't use the stack.

**Verdict: COMPLIANT.**

`advanceSagasAtPrecombatMain` (`convex/gre/sagas.ts:112-123`) filters the active
player's battlefield to `isSaga(c) && effectiveChapterAbilities(c).length > 0`
— the rule's "with one or more chapter abilities" qualifier, read through the
_effective_ abilities so an ability-stripped Saga is skipped — and calls
`addCounterToCard` on each. It is invoked from `performPhaseEntry`'s
`PRECOMBAT_MAIN` case (`convex/gre/phases.ts:2004-2019`), before priority, and
puts nothing on the stack.

### F.3 — CR 702.155b: read ahead becomes intrinsic abilities

Printed:

> **702.155b** Each Saga with read ahead has the intrinsic abilities "As this
> Saga enters, choose a number between one and this Saga's final chapter
> number" and "This Saga enters with the chosen number of lore counters on it."
> See rule 714.3b.

**Verdict: N/A — no Saga with read ahead in the catalogue.**

Read ahead has a registry row with `status: "planned"`
(`convex/cards/mechanicsRegistry.ts:2086-2093`) and zero references anywhere
under `convex/cards/sets/**`. Neither shipped Saga uses it.

Worth recording for whoever ships it: because §F.1 already models the entry
counter as a genuine 614.1c replacement through `entersWith`, read ahead is a
comparatively small addition — an "as it enters, choose a number" prompt whose
result feeds the existing `entersWith.counters` count (the count vocabulary in
`convex/cards/entersWith.ts` already supports non-literal counts), plus 702.155a's
chapter-trigger suppression on the turn it entered. It does **not** need a new
entry model.

---

## G — Assorted semantics

### G.1 — CR 107.3e: X "used by" the other object

Printed:

> **107.3e** If a spell or ability refers to the {X} or X in the mana cost,
> alternative cost, additional cost, or activation cost of another object, any
> X in that spell or ability's text uses the value of X used by the other
> object.

**Verdict: N/A — no shipped card refers to the X of another object.**

A sweep of shipped oracle text for cross-object X references
(`where X is`, `X in its mana cost`, "equal to that spell's converted mana
cost") finds one hit and it is a commented-out card
(`convex/cards/sets/ice/blue.ts:623`), whose X is defined by an amount of mana
paid during its own resolution — CR 107.3f, not 107.3e.

The engine's X plumbing serves a **different** rule and must not be mistaken for
this one. `StackItem.chosenX` (`convex/gre/state.ts:1639`) is snapshotted onto
the entering permanent as `chosenXOnCast` (`convex/gre/state.ts:1327-1355`,
written at `:5687-5696`) so the permanent's own enters-the-battlefield ability
can read the value of X of the spell it was — that is **CR 107.3m**, explicitly
an exception, and the same object, not another one.

### G.2 — CR 115.7e: only the final target set is evaluated

Printed:

> **115.7e** When changing targets or choosing new targets for a spell or
> ability, only the final set of targets is evaluated to determine whether the
> change is legal.
> _Example: Arc Trail […] You can change the first target to Llanowar Elves and
> change the second target to Runeclaw Bear._

**Verdict: COMPLIANT.**

Both retarget paths write the **whole** `targets` array in one assignment, after
the pending-target flow has collected every pick — there is no intermediate set
for the engine to evaluate:

- `copy-retarget` (CR 707.10b, Fork): `convex/gre/pendingTargetOrigin.ts:236-243`
  — `copy.targets = targets`;
- `retarget` (Reflecting Mirror, CR 115.7a): `convex/gre/pendingTargetOrigin.ts:250-257`
  — `spell.targets = targets`.

`targets` is assembled across the flow and only spliced onto the stack item at
finalize (`convex/gre/pendingTargetOrigin.ts:225-229`), so the Arc Trail swap in
the rule's example cannot be rejected by a partial evaluation. The raise site is
`requestRetarget` (`convex/gre/state.ts:14501`).

No `115.7` citation exists in source (the `115.x` hits are all `115.4`, "any
target"). Adding one at `pendingTargetOrigin.ts:245` would be an improvement but
is a comment change and out of this issue's scope.

### G.3 — CR 118.7e: cost reduction by a hybrid mana symbol

Printed:

> **118.7e** If a cost is reduced by an amount of mana represented by a hybrid
> mana symbol, the player paying that cost chooses one half of that symbol at
> the time the cost reduction is applied (see rule 601.2f). If a colored or
> colorless half is chosen, the cost is reduced by one mana of that type. If a
> generic half is chosen, the cost is reduced by an amount of generic mana equal
> to that half's number.

**Verdict: N/A — no shipped card reduces a cost by a hybrid symbol.**

Every shipped "costs {N} less to cast" reduces by pure generic mana — Urza's
Filter (`convex/cards/sets/inv/colorless.ts:535`), Stone Calendar
(`convex/cards/sets/drk/colorless.ts:451`), the affinity variants, the
colour-restricted reducers (`convex/cards/sets/pls/red.ts:793`).

The engine could not express the rule if a card needed it. `CostModifiers`
(`convex/gre/state.ts:18293-18303`) carries a single scalar `reductionGeneric`
plus a `minTotalMana` floor; there is no per-symbol reduction and no
half-choice. Hybrid mana is modelled for **payment** only
(`convex/gre/manaColors.ts`, `convex/gre/constants.ts:161-265`). Shipping a
hybrid reducer means widening `CostModifiers.reduction` from a scalar to a
`ManaCost`-shaped record and raising a half-choice at 601.2f time — a real
slice, not a tweak.

### G.4 — CR 712.16: turning a double-faced permanent face down

Printed:

> **712.16.** Melded permanents and other double-faced permanents can't be
> turned face down. If a spell or ability tries to turn a double-faced permanent
> face down, nothing happens and that effect doesn't change any of its
> characteristics or their copiable values.

> **708.2b** A face-down permanent can't be turned face down. If a spell or
> ability attempts to turn a face-down permanent face down, nothing happens and
> that effect doesn't change any of its characteristics or their copiable
> values.

**Verdict: N/A — nothing in the engine turns a battlefield permanent face down.**

`turnFaceDown` (`convex/gre/faceDown.ts:20-35`) has exactly three callers, none
of which is an effect acting on a permanent:

- `convex/gre/state.ts:15873` — a throwaway shallow copy used as a _probe_, so
  the cast-face-down legality gate reads the face-down characteristics
  (CR 708.2) without touching the real card;
- `convex/gre/state.ts:15881` — the card being cast face down, in the **hand →
  stack** transition;
- `convex/gre/scenarioBuilder.ts:326` — the debug scenario builder placing a
  permanent already face down.

No spell or ability in the catalogue turns a permanent on the battlefield face
down, so neither 712.16 nor the DFC carve-out is reachable. The one shipped
double-faced card lives in `convex/cards/sets/ori/blue.ts`.

The _sibling_ rule 708.2b **is** already satisfied: `turnFaceDown` opens with
`if (card.faceDown) return;` (`convex/gre/faceDown.ts:21`), a genuine no-op that
touches no characteristic. When a face-down-ing effect ships, the same guard
needs a `backFace`/melded arm added to it — one line, at the same place — plus
a test that the DFC's copiable values are untouched.

### G.5 — CR 610.5 (new): static abilities granting a spell an ability as it is cast

Printed:

> **610.5.** Some static abilities create one-shot effects that cause spells a
> player casts to gain an ability as that player casts them. These effects begin
> to apply to appropriate spells at the time the player puts such a spell on the
> stack. See rule 601.2a.

**Verdict: N/A — no shipped card has such a static ability.**

Sweeps of shipped oracle text for `spells you cast (have|gain)`,
`creature spells you cast (have|gain)` and `spells you control have` return
nothing. The engine has no cast-announcement hook that grants an ability to the
entering `StackItem`; the closest existing machinery,
`state.castTimingFlashGrants` (§D.2), grants a _permission to a player_, not an
ability to a spell.

There are **zero `610.x` citations** anywhere under `convex/` or `src/`.

### G.6 — CR 707.12a (new): "may cast" over multiple copies is per copy

Printed:

> **707.12a** An effect that creates multiple copies and says a player "may
> cast" those objects allows that player to choose individually, for each of
> those objects, whether or not to cast it.

**Verdict: N/A — no shipped card creates multiple copies with a "may cast".**

A sweep for `"may cast"` near `"copies"` in `convex/cards/sets/**` returns
nothing. The engine's cast-a-copy machinery is single-copy throughout: the
shared clone-onto-stack helper (`convex/gre/state.ts:10350`, cited CR 707.10 /
707.12), the copy's controller (`:10410`) and the copy's new-targets offer
(`:10433`, `:10505`, cited CR 707.10b) all operate on one copy. There is no
per-copy may-cast loop to get wrong.

### G.7 — CR 205.3h: the enchantment type list grew

Printed:

> **205.3h** Enchantments have their own unique set of subtypes; these subtypes
> are called enchantment types. The enchantment types are Aura (see rule 303.4),
> Background, Cartouche, Case (see rule 719), Class (see rule 716), Curse, Plan,
> Role (see rule 303.7), Room, Rune, Saga (see rule 714), Shard, and Shrine.

**Verdict: N/A — the engine keeps no enchantment-type registry that can drift.**

There is no `ENCHANTMENT_SUBTYPES` constant anywhere in `convex/gre/constants.ts`
or `convex/cards/types.ts`; subtypes are declared ad hoc per card. Exactly two
enchantment types are read by engine code, and both are in the new list:
`SAGA_SUBTYPE` (`convex/cards/abilities/sagas.ts:42`) and `isAura`
(`convex/gre/constants.ts:458-465`). The enchantment types actually shipped are
**Aura, Saga and Shrine** (the other subtypes appearing on enchantment cards —
Avatar, Centaur, Horror, Nightmare, Island, Plains, Urza's — are creature or
land types on enchantment creatures / enchantment lands, governed by 205.3m/205.3i,
not by 205.3h).

Because there is no list, a grown list cannot fall out of sync. The absence is
worth knowing rather than fixing: a future Room or Class card needs its rules
section (CR 719 / CR 716) built, not a constant added.

### G.8 — CR 605.1a / Chromatic Sphere

**Verdict: DIVERGENT — see #2430.**

Already diagnosed and ticketed. Not re-derived here, per this issue's out-of-scope
list. Recorded so that the audit's item set is complete and #2430 is discoverable
from it.

---

## H — Explicit N/A block (verified by catalogue presence)

Each entry records the reason, so the next set rollout inherits the answer
instead of re-deriving it.

| Rule(s)                                                                                    | Verdict | Reason (catalogue evidence)                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `310.9`, `310.12`, `704.5v` — battles, Sieges                                              | **N/A** | No Battle card. `"Battle"` exists only as a `CardType` enum value (`convex/cards/types.ts:236`, `:247`, `:264`; `convex/gre/constants.ts:124`) used by generic type-matching (Atraxa, `convex/cards/sets/one/multicolor.ts:31`). No Siege subtype, no defence counters, no protector. |
| `704.5aa` — speed / start your engines                                                     | **N/A** | Registry row `status: "out-of-scope"`, `convex/cards/mechanicsRegistry.ts:2288-2295`. No card.                                                                                                                                                                                        |
| `702.124` — Commander partner variants                                                     | **N/A** | Registry row `status: "planned"`, `convex/cards/mechanicsRegistry.ts:1815-1820`. No card. Commander is not a supported format.                                                                                                                                                        |
| `704.5z` — the Role SBA                                                                    | **N/A** | No Role token and no Role subtype anywhere in `convex/cards/`.                                                                                                                                                                                                                        |
| `111.10v` — Mutagen token                                                                  | **N/A** | No card creates one.                                                                                                                                                                                                                                                                  |
| `111.10w` — Vibranium token                                                                | **N/A** | No card creates one.                                                                                                                                                                                                                                                                  |
| `122.1j` — hone counters                                                                   | **N/A** | No hits in `convex/cards/`.                                                                                                                                                                                                                                                           |
| `701.65` — airbend                                                                         | **N/A** | No card, no registry row.                                                                                                                                                                                                                                                             |
| `701.68` — blight                                                                          | **N/A** | No card, no registry row.                                                                                                                                                                                                                                                             |
| `701.69` — heal                                                                            | **N/A** | No card, no registry row. (Note for whoever ships it: the engine already removes marked damage at `finalizeCleanup`, but has no targeted heal primitive.)                                                                                                                             |
| `701.70` — recruit                                                                         | **N/A** | No card, no registry row.                                                                                                                                                                                                                                                             |
| `702.189`–`702.195` — firebending, sneak, increment, paradigm, power-up, teamwork, storied | **N/A** | None appear in `SET_KEYWORDS` (`convex/cards/mechanicsRegistry.ts:2433-2454`) nor anywhere in `convex/cards/`.                                                                                                                                                                        |

### H.1 — Two entries in the "N/A unless the catalogue says otherwise" block are **not** N/A

The issue's N/A block lists all six new keyword actions together. Two of them
have shipped cards, and both diverge from the rule text this revision printed
for the first time.

#### CR 701.66 — earthbend: **DIVERGENT**

Printed:

> **701.66a** "Earthbend N" means "Target land you control becomes a 0/0 land
> creature with haste in addition to its other types. Put N +1/+1 counters on
> it. When that land dies or is put into exile, return it to the battlefield
> tapped **under your control**."

Shipped: Badgermole Cub, `convex/cards/sets/tla/green.ts:59-111`; registry row
`convex/cards/mechanicsRegistry.ts:2443-2453` (`status: "implemented"`). Two
content divergences, both invisible until this revision gave the mechanic a rule
number:

1. **A creature subtype the rule does not grant.** The `animate` Op at
   `convex/cards/sets/tla/green.ts:74-80` sets `subtype: "Elemental"`. 701.66a
   says "becomes a 0/0 **land creature** … in addition to its other types" — no
   creature subtype — and the card's own printed reminder text agrees ("becomes
   a 0/0 creature with haste that's still a land"). The engine is adding a
   creature type nothing granted, visible to any Elemental-typed effect.
2. **Returns under the wrong player's control.** The delayed trigger's two
   `moveZone` Ops (`convex/cards/sets/tla/green.ts:96-109`) carry no controller
   override, so the land returns under its **owner's** control; the registry
   note at `convex/cards/mechanicsRegistry.ts:2452` records this deliberately
   ("under the land's OWNER's control (earthbend has no controller-override
   clause)"). 701.66a says "under **your** control" — the earthbending player's.
   The two differ whenever you control a land you do not own.

**Fix sketch.** Drop `subtype: "Elemental"` from the `animate` Op. Add a
controller override to the two `moveZone` Ops so the land returns under the
ability's controller — `moveZone` needs a `controller: "you"` field if it does
not already have one, which makes this a `/new-op`-adjacent slice rather than a
pure card edit. Both changes are catalogue-wide by construction: earthbend is
uniform across the 28 TLA earthbend cards per the registry note, so whatever
shape lands must live in the shared expansion, not on Badgermole Cub. Also
correct the registry row's `cr` field, which asserts "not a CR 701/702 entry" —
true against the previous revision, false now that 701.66 exists.

#### CR 701.67 — waterbend: **DIVERGENT**

Printed:

> **701.67a** "Waterbend [cost]" means "Pay [cost]. For each generic mana in
> that cost, you may tap an untapped artifact or creature you control rather
> than pay that mana."

> **701.67b** If a waterbend cost is part of the total cost to cast a spell or
> activate an ability […] the alternate method to pay for mana described in rule
> 701.67a may be used only to pay for the amount of generic mana in the waterbend
> cost, even if the total cost […] includes other generic mana components.

Shipped: **Aang's Iceberg**, `convex/cards/sets/tla/white.ts:28-47`, whose oracle
text reads "Waterbend {3}: Sacrifice this enchantment. If you do, scry 2." The
ability is implemented as a **plain {3} generic activation cost**; the
tap-an-artifact-or-creature alternative is not modelled at all. The divergence is
already flagged in the card's own comment
(`convex/cards/sets/tla/white.ts:28-33`: "no such cost-payment primitive exists
yet"), and waterbend has **no registry row** — it is not in `SET_KEYWORDS`
(`convex/cards/mechanicsRegistry.ts:2433-2454`), so Guard A never fired on it,
because the mechanic lives in the ability's cost rather than in
`staticAbilities[]`.

This is the "a card reaches the rule and the engine implements nothing" case,
which is DIVERGENT, not N/A.

**Fix sketch.** The missing primitive is a **per-generic-pip alternative
payment**: a cost shape that lets each generic mana in a _designated portion_ of
the cost be paid by tapping an untapped artifact or creature the player controls.
The engine already has an adjacent picker — the Vehicle crew cost's
`cost.tapOtherFilter` / `PendingActivation.tapOtherChoice` / `gre/tapOtherCost.ts`
triple (see the crew registry note at
`convex/cards/mechanicsRegistry.ts:1803`) — which taps other permanents as a
cost and is consulted identically by the server, the Brain's move enumerator and
the client affordability hint. Waterbend is that picker with two changes:
the tapped permanents substitute for _mana_ rather than being an independent
cost, and 701.67b scopes the substitution to the waterbend portion only, so the
cost must carry a marked generic sub-amount rather than a flat number. Ship it
whole per the mechanic-is-implemented-whole rule: registry row, cost shape,
server gate, Brain enumeration, client affordability, serialization, debug
scenario — then re-point Aang's Iceberg at it and delete the simplification
comment.

---

## I — Citation drift found by this audit (hand to #2429)

Behaviour at each of these sites is **correct**; only the cited rule id is now
wrong. They are listed here so #2429 has them and so no ticket cut from this
audit edits the same comment.

| Site(s)                                                                                                                                                                                | Cites                      | Should cite        | Why                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `convex/gre/phases.ts:3054`, `:3060`, `:3116`; `convex/gre/state.ts:1507`, `:2381`; `convex/gre/types.ts:256`; `convex/cards/types.ts:2969`; `convex/cards/sets/atq/colorless.ts:1383` | `500.4`                    | `500.5` (`703.4q`) | Mana emptying moved from 500.4 to 500.5. New 500.4 is about effects expiring as a step _begins_ — a different rule. |
| `convex/gre/phases.ts:1898` (UNTAP entry tick)                                                                                                                                         | `502.1`                    | `500.4`            | 502.1 is the phasing turn-based action. The entry-expiry rule is new 500.4.                                         |
| `convex/gre/phases.ts:1908` (UPKEEP entry tick)                                                                                                                                        | `500.2`                    | `500.4`            | 500.2 is "a phase or step in which players receive priority ends when…". The entry-expiry rule is new 500.4.        |
| `convex/cards/entersWith.ts` (module header); `convex/gre/state.ts:5204`                                                                                                               | `121.6`                    | `122.6` / `122.6a` | 121.6 is _"Some effects replace card draws."_ The enters-with-counters rule is 122.6.                               |
| `convex/cards/mechanicsRegistry.ts:2447` (earthbend row's `cr` field)                                                                                                                  | _"not a CR 701/702 entry"_ | `701.66`           | Earthbend now has a rule number. (The row also needs the §H.1 behaviour fix — coordinate.)                          |

Two further observations for #2429, not drift but gaps: **`115.7` has no citation
anywhere in source** despite the retarget code implementing 115.7e correctly
(`convex/gre/pendingTargetOrigin.ts:245-257`), and **`601.5`–`601.8`, `610.x` and
`702.2e` have zero citations** — in each case the engine's behaviour was judged
above on its own merits, not on a comment.

---

## Summary

| Section | Item                                                                                                 | Verdict                         |
| ------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| A.1     | 603.2 parent + `d`–`h` shift                                                                         | COMPLIANT (no drift)            |
| A.2     | 603.2h "Do this only once each turn"                                                                 | N/A                             |
| A.3     | 603.1b multi-condition "all"                                                                         | N/A                             |
| A.4     | 603.10a look-back list                                                                               | COMPLIANT                       |
| A.5     | 603.12 / 603.12a reflexive triggers                                                                  | COMPLIANT / N/A (new carve-out) |
| B.1     | 500.4 expire as a step begins                                                                        | COMPLIANT (+ citation drift)    |
| B.2     | 500.5 expire then empty mana                                                                         | **DIVERGENT** (ordering)        |
| B.3     | 500.5a until end of combat                                                                           | COMPLIANT                       |
| B.4     | 500.5b until end of turn                                                                             | COMPLIANT                       |
| C.1     | 506.3d enters unblocked / 506.3g battles                                                             | COMPLIANT / N/A                 |
| C.2     | 508.4 attack-target choice                                                                           | **DIVERGENT**                   |
| C.2     | 508.4 "never attacked", 508.4d                                                                       | COMPLIANT                       |
| C.2     | 508.4a player left the game                                                                          | N/A                             |
| C.3     | 506.4 protector / battle clauses                                                                     | N/A                             |
| C.4     | 702.2c deathtouch + 702.19b lethal threshold                                                         | **DIVERGENT**                   |
| D.1     | 601.5 later-choice options                                                                           | N/A                             |
| D.2     | 601.6 / 601.6a continue casting                                                                      | COMPLIANT                       |
| D.3     | 601.7 / 601.7a / 601.7b opponent chooses                                                             | N/A                             |
| D.4     | 601.8 cost-alterers vs the stack                                                                     | COMPLIANT                       |
| E.1     | 702.2e / 702.15c / 702.90d LKI                                                                       | **DIVERGENT** (structural)      |
| F.1     | 714.3a intrinsic entry counter                                                                       | COMPLIANT (+ citation drift)    |
| F.2     | 714.3c precombat-main counter                                                                        | COMPLIANT                       |
| F.3     | 702.155b read ahead                                                                                  | N/A                             |
| G.1     | 107.3e X of another object                                                                           | N/A                             |
| G.2     | 115.7e final target set                                                                              | COMPLIANT                       |
| G.3     | 118.7e hybrid cost reduction                                                                         | N/A                             |
| G.4     | 712.16 DFC face down                                                                                 | N/A                             |
| G.5     | 610.5 ability granted as cast                                                                        | N/A                             |
| G.6     | 707.12a per-copy may cast                                                                            | N/A                             |
| G.7     | 205.3h enchantment types                                                                             | N/A                             |
| G.8     | 605.1a / Chromatic Sphere                                                                            | **DIVERGENT** → #2430           |
| H       | battles, speed, partner, Roles, tokens, hone, airbend, blight, heal, recruit, the seven new keywords | N/A                             |
| H.1     | 701.66 earthbend                                                                                     | **DIVERGENT**                   |
| H.1     | 701.67 waterbend                                                                                     | **DIVERGENT**                   |
| I       | citation drift (5 sites + 2 gaps)                                                                    | CITATION-ONLY → #2429           |

**Six divergences to ticket:** B.2 (mana/expiry ordering), C.2 (508.4 attack
target), C.4 (lethal-damage threshold for trample and deathtouch), E.1 (LKI
store, ADR 0086), H.1 earthbend, H.1 waterbend. G.8 is already #2430. All
citation drift belongs to #2429.
