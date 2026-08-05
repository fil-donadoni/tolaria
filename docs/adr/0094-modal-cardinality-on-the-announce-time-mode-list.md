# Modal cardinality lives on the announce-time mode list, with the announcement and permanent storage kept apart

## Status

accepted

## Context

Four tracked stubs — Kolaghan's Command, Fiery Confluence, Mystic Confluence,
Flame of Anor — are blocked on one gap: a modal spell can only ever pick
**exactly one** mode. Neither modal construct carries a count. Collective
Brutality (Escalate) needs the same axis, plus a cost rider.

Issue #1566, written before ADR 0089 landed, proposed adding `count` /
`repeats` to the resolve-time DSL Op `optionChoice`. ADR 0089 had meanwhile
decided the opposite for **printed** modal picks: they are announce-time
(`CardDefinition.modes` / `ActivatedAbility.modes`, CR 601.2b via 602.2b for
abilities), because a resolution-time pick can neither lock a target at
announcement nor give the opponent a window on the chosen mode. All four
blocked cards carry per-mode targets, so the resolve-time seam was never
available to them.

The CR text that constrains the design (verified verbatim, rules of
2026-08-07):

- **700.2a** — the controller picks the mode(s) as part of casting; a mode
  that would be illegal can't be picked.
- **700.2d** — a mode normally can't repeat; "You may choose the same mode
  more than once" lifts that, the spell is "treated as if that mode appeared
  that many times in sequence", and each instance **may target the same
  object** or a different one.
- **608.2c** — instructions are followed in the order **written**. With
  700.2d, that fixes execution order as printed order, not pick order.
- **609.3** — an effect "does only as much as possible": fewer legal modes
  than the required count is legal, you pick as many as you can. Nothing
  inside 700.2 covers this case.
- **601.4** — a mode count conditioned on an additional cost chosen while
  casting (kicker) is normed. A count conditioned on **board state** (Flame of
  Anor's "if you control a Wizard as you cast this spell") has **no** CR rule
  — it is plain card text evaluated at announcement.

One complication is local to this codebase: `chosenModeId` serves two
unrelated domains under one name. On the announcement path (pendingCast,
pendingTarget, pendingActivation, stack item) it records what the caster
picked. On a **modal permanent** (CR 700.2c — Prismatic Ward, Voice of All,
Quirion Elves, Jihad) it stores the one mode the permanent entered with, read
by the layer system from roughly twenty set files.

## Decision

**A `ModeSelection` value declared next to `modes` carries the cardinality, at
both announce sites; `optionChoice` is not extended.**

- **Cardinality is a property of the mode LIST, not of a mode.** `ModeSelection`
  expresses a fixed N, a `min..max` range, whether repeats are allowed, and a
  predicate-conditioned count. It is one shared type across
  `CardDefinition.modes` and `ActivatedAbility.modes`, which already share the
  `ModeOption` display surface and the announcement plumbing. A future modal
  **triggered** ability (CR 603.3c) reuses it unchanged.
- **The conditional count is a declarative, JSON-pure predicate**, not a
  closure — board state via a card filter, or the kicker flag for CR 601.4. It
  has three readers: the server validating the announcement, the **client**
  sizing the picker before any mutation is called, and the bot enumerating
  moves. A closure would force all three to execute card code.
- **The two storage domains are split.** The announcement path moves to
  `chosenModeIds: string[]` (duplicates allowed, normalised to printed order);
  the modal permanent keeps the singular `chosenModeId`, stamped from the first
  element, guarded by a catalogue-wide rule that a card whose modes carry
  `staticEffects` cannot declare a count above one.
- **Targets stay one flat list, read at a per-instance offset**, with the span
  of each instance stored alongside (it is not derivable when a mode's
  requirement has a variable count). The instances themselves flatten into the
  existing sequence of independent target groups
  (`additionalTargetRequirements`), so per-mode legality validation is
  inherited rather than rebuilt.
- **`optionChoice` keeps its resolve-time, exactly-one semantics.** It remains
  right for a "choose one" written inside a resolving effect.

## Consequences

- **`chosenModeId` → `chosenModeIds` is deliberately compile-breaking** on the
  announcement path (~20 non-test source files). That is the point: the
  alternative — keeping the singular and adding a parallel array used only when
  N > 1 — leaves two sources of truth for one fact, and every reader that knows
  only the singular silently sees mode 1. Fail-open, and this project has paid
  for that shape before. The set files are untouched because the permanent
  domain does not move.
- **The bot's enumeration changes character.** It emits one move per (mode ×
  target tuple); cardinality multiplies that by the number of mode
  combinations. Mode combinations stay fully enumerated (a small space) and
  only the target level is budgeted — and any truncation is reported, because a
  silent cap would delete a whole line of play from the bot's view.
- **`optionChoice`'s valuation does not transfer.** It is valued as
  best-of-modes, which is right for a pick made during resolution. Announce-time
  multi-mode picks all execute, so their values compose.
- **The picker becomes load-bearing.** The server rejects a modal announcement
  with no mode, so a client that cannot express "choose three, repeats allowed"
  makes the card uncastable rather than awkward.
- **Escalate is reduced to a cost problem.** The `min..max` range lands here, so
  "choose one or more" needs no further rules work — only the per-extra-mode
  additional cost (CR 702.120 / 700.2h).
- **Out of scope, deliberately:** pawprint modes (CR 700.2i) are a weight
  budget rather than a count, with their own printed symbol and no card in the
  catalogue.

## Alternatives considered

- **Add `count` / `repeats` to `optionChoice`** (issue #1566's written
  proposal). Rejected on the same CR grounds ADR 0089 gave: it would build a
  second, resolution-time modal-targeting path for cards whose modes target,
  with no response window and no announcement-time target lock.
- **One `chosenModeIds` array everywhere, including permanents.** Rejected: it
  breaks every modal-permanent card definition to model a cardinality those
  permanents can never have.
- **Nested per-instance target arrays** instead of offsets into the flat list.
  Rejected: it changes the wire shape every positional consumer reads —
  projection, target prompt, move enumeration, serialization, move description
  — to express something an offset plus a stored span already expresses.
- **A closure predicate for the conditional count.** Rejected: the client must
  size the picker before calling the mutation, so a closure moves card code onto
  the client's critical path for a decision that is plain data.
