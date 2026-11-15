# Triggers are data: every card authors the Trigger Descriptor, and `matches` is derived

## Status

accepted (2026-11-15, grill for the "triggers are data" PRD). Amends ADR 0002:
the trigger factories stay, as the body of the expander; a card file no longer
calls them.

## Context

A `TriggeredAbility` has a readable `event` and a `matches(event, self, state)`
closure. Whose object the trigger watches ("this creature" or "a creature you
control") and which objects qualify ("a land") live inside the closure, so the
two lines "when this dies" and "whenever a creature dies" are the same value to
every reader that is not the engine.

The closure is built from data that exists and is then dropped. A trigger
factory (`convex/cards/abilities/triggers/*.ts`, ADR 0002) receives
`args.scope` and `args.filter`, closes over them and keeps neither. A compiled
card carries each trigger as a JSON descriptor with a `head`
(`CompiledTriggeredAbility`, `convex/cards/compiledTriggers.ts`), and
`expandCompiledTriggers` — called innermost at the definition seam in
`convex/cards/registry.ts` — hands it to those same factories. After that the
head is gone too.

Four readers want the dropped data, and each works around the hole on its own:

- the play Bot's reach reads `head.kind === "entered" && head.scope === "self"`
  off the raw descriptors before expansion (`convex/gre/ai/botReach.ts`), so a
  hand-written card's own enter trigger is invisible to it;
- the gold comparison (`convex/oracle/gold.ts`) renders a function as
  `"[closure]"`, so a hand-written trigger with a raw `matches` makes its card
  incomparable even when the compiler reads the line;
- the Capability derivation of ADR 0130 cannot tell a payoff's scope, which
  zeroes three of its rows (issue #3609);
- four fields already restate one slice of a closure for non-engine readers,
  each stamped by a factory and never read by the engine: `gate`,
  `phaseScope` / `phaseStep`, `sourceTapCondition`, `etbAbility`.

Measured in `docs/research/capability-derivation-feasibility.md`: 3,297
catalogue triggers, 2,479 of them compiled descriptors, 248 hand-written
`matches` / `condition` / `interveningIf` closures on 212 cards, of which about
three quarters are expressible through a factory that exists. A differential
harness infers the factory configuration of a closure by running both on
synthetic events (56 of 64 on three event types).

So the catalogue has two authoring forms for the same thing, the readable one
is the compiler's alone, and the fix on offer each time has been one more
restated field.

## Decision

### 1. One authored form

A card carries its triggers as **Trigger Descriptors** (`GLOSSARY.md`): a
**Trigger Head**, an optional condition, and the body. A hand-written card
authors the same form the Oracle Compiler emits. "Compiled" names where a
descriptor came from, never what it is; the type and the definition key lose
the word in a mechanical slice of their own.

### 2. One expansion seam

`expandCompiledTriggers` is the only place a descriptor becomes a
`TriggeredAbility`. The factories of ADR 0002 are its body — the shape ADR 0155
gave Echo and Cumulative upkeep — and card files stop importing them. The
engine is unchanged: it still reads `event` and calls `matches` on the expanded
ability. What changes is that `matches` is DERIVED from the head, so no reader
needs it.

### 3. The head vocabulary belongs to the engine

A head kind is anything the expander can interpret, not what the grammar
happens to read today. Two consequences:

- The parameters of an existing kind widen to the arguments its factory
  already accepts (`tapped.scope` becomes a `PermanentScope`, where the grammar
  only ever emitted `"self"`). No Grammar Rule is owed for that.
- A NEW kind — an event no factory serves, such as "blocks" / "becomes
  blocked" or "attacks alone" — is born whole: the kind, its factory and the
  Grammar Rule that emits it, in one change. A kind the compiler cannot emit
  would be a hand-written-only dialect, which is what this ADR removes.

### 4. Two declared escapes, and what each may narrow

A descriptor may carry a function in two places only.

- **`resolve`** — an imperative body, on the terms ADR 0045 sets for a
  protocol card. Out of this ADR's reach; it only has to keep fitting.
- **A narrowing predicate on the head** — for a firing test the vocabulary
  cannot say. The head stays TRUTHFUL: it names the tightest kind, scope and
  filter that are a superset of the events the ability fires on, and the
  predicate narrows from there. A reader that ignores the predicate
  over-counts; it never reads a wrong event or a wrong scope. A headless
  `matches` is allowed only where no head is an honest superset.

The narrowing predicate is part of the trigger event and is tested once, when
the event occurs (CR 603.2). It is not the descriptor's `condition`: that is
the intervening "if" (CR 603.4), which the expander installs as both the
firing-time `condition` and the resolution-time `interveningIf`. A firing test
moved into `condition` would be re-checked on resolution and change behaviour,
so the two slots stay separate and the migration never folds one into the
other.

### 5. Every escape names the vocabulary it is waiting for

A narrowing predicate or a headless `matches` carries Guard C's marker —
`compiler-gap: <fragment> (#issue)` — and the issue is a Grammar Gap for the
missing vocabulary item: one issue per item, not per card. There is no baseline
amnesty: a closure without its issue reds the lane. A census of the escapes is
a lane guard (it costs seconds), so the count is a ratchet, not a hope.

The same rule covers a `condition` the condition vocabulary cannot say.

### 6. The migration is proven by differential equivalence

A hand-written trigger moves to a descriptor when the expanded descriptor and
the old closure answer identically on an event corpus, AND the corpus varies
every field the closure reads. A closure reading a field the corpus does not
vary is not migrated by the codemod; it is rewritten by hand or stays an escape
with its marker and issue. The receipt goes in the PR. No per-card test is
added: a descriptor on an exercised head is data on exercised code.

### 7. Perimeter

In: every trigger a card or a keyword carries — `triggeredAbilities`,
`triggeredGrantTemplates`, Class sections, back faces, the keyword expanders
under `convex/cards/abilities/`.

Out, as a declared follow-up: the triggers a token carries
(`TokenTriggeredAbility`). They fold into the content-derived
`tokenDefinitionId`, which is persisted, so changing their form is a migration
of saved games and gets its own decision.

Out: every other closure on a definition — `applies` on a static effect,
replacement predicates, `resolve` bodies. `applies` is the same shape of
problem and the natural next ADR; nothing here decides it.

### 8. The destination

When no card authors a `TriggeredAbility` directly, the authored
`triggeredAbilities` key leaves `CardDefinition` and only the expanded
definition has it. The restated fields that a head subsumes (`etbAbility`,
`phaseScope`, `phaseStep`) are then derived from the head or retired, each in
its own change with its readers.

The grammar follows the vocabulary: one subject sub-grammar shared by every
head verb, instead of subjects wired verb by verb, so the heads the migration
writes by hand are heads the compiler can emit, and a migrated card can reach
its compiled twin and retire through ADR 0114.
`docs/research/trigger-head-gap-families.md` prices that slice.

## Considered options

- **Stamp the head on the expanded ability, from the factories.** The smallest
  change, and where this started. Rejected: it is a fifth restated field with
  two authorities (the closure decides, the stamp describes), nothing keeps
  them equal, and a hand-written raw `matches` stays unreadable.
- **Keep both forms and drain hand-written cards through retirement alone**
  (ADR 0114). Rejected as the whole answer: the compiler accepts 935 of the
  2,270 hand-written cards, so the rest would keep their closures for as long
  as the grammar takes to reach them. Retirement stays the exit for the cards
  it can reach.
- **A head vocabulary owned by the grammar** — a hand-written card may use
  only what a Grammar Rule emits. Rejected: it makes the migration wait on the
  grammar for combinations the factories have served for months (a `tapped`
  trigger with a host scope), and turns the escape closure into the default.
- **A second, hand-written-only descriptor type.** Rejected: two forms again.

## Consequences

- The gold comparison compares heads, so a hand-written descriptor and its
  compiled twin are comparable where today a closure makes them incomparable.
  Whether any present `equal` hides a scope difference behind two factory-built
  closures is checked by the slice that makes the comparison read the head.
- `botReach`, the Capability derivation and the Bot's script valuation read one
  head on every card, hand-written or compiled.
- PRD issue #3602 (the deck Plan) is not held for the whole migration. It
  resumes when the seam exists and every card on the `vintage-cube` and
  `modern-metagame` Targets authors descriptors; the rest of the catalogue and
  the removal of the authored key proceed beside it.
- The codemod touches most set files. Its PRs are cut per set so each is
  file-disjoint from the queue's other work.
- The vocabulary grows on purpose, and every growth is paid three times (kind,
  factory, Grammar Rule). That is the price of having one form.
- ADR 0002's table of factories keeps describing the expander's body. Its
  authoring guidance — "a card calls the factory" — is superseded by §1.
