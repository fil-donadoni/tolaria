# Ante and subgames stay out of scope; Word of Command and Camouflage are in

## Status

accepted (2026-11-08, issue #8725). Narrows ADR 0010 and the "Camouflage is out
of scope" line of ADR 0012. The audit that found the reversal:
`docs/research/adr-audit-2026-11-07.md`.

## Context

ADR 0010 declared six Alpha cards permanently out of scope and said that
re-including one "supersedes this ADR". Two of the six have since shipped as
live definitions without that record: Word of Command
(`convex/cards/sets/lea/black.cards.ts`, the acting-player seam of ADR 0037)
and Camouflage (`convex/cards/sets/lea/blue.cards.ts`, a protocol card named in
ADR 0045 and `CLAUDE.md` § Card Definition System). ADR 0012 still calls
Camouflage out of scope; ADR 0010's "284 of 290" completion target is gone.
Separately, `CLAUDE.md` § Out of Scope cites ADR 0010 for "Ante & subgames",
but 0010 never mentions subgames.

## Decision

1. **Still out of scope, permanently:** the ante cards (Contract from Below,
   Demonic Attorney, Darkpact: no ante zone, no pre-game ante removal), Chaos
   Orb (a physical-dexterity card), and **subgames** (Shahrazad and its kin: a
   nested game is a second `GameState` inside a game; no feature needs it).
   They stay commented out (or, for Shahrazad, banned in `convex/formats.ts`)
   with the `// Out of scope — see ADR 0010` back-reference; this record adds
   subgames to that list. The reasons in ADR 0010 for the first four stand.
2. **No longer out of scope:** Word of Command and Camouflage are implemented.
   ADR 0010's reasons ("disproportionate", "the harder twin of Raging River")
   were overtaken by the protocol-card path (ADR 0045, ADR 0037).
3. **Completion is stated by the code, not by a count.** Whether a set is
   complete is what the Targets and `check:gaps` measure (ADR 0143); the
   "284 of 290" arithmetic is retired.

## Consequences

- `CLAUDE.md` § Out of Scope keeps "Ante & subgames (ADR 0010)", now true
  because this record is the one that names subgames.
- ADR 0010 gains a status line pointing here; its body stays as history.
- A future card in the excluded list reopens it with a new record, as ADR 0010
  asked.
