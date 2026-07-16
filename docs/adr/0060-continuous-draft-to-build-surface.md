# 0060 — Continuous draft→build surface: the draft-time Pool is the working deck (amends ADR 0055)

## Status

Accepted. **Amends ADR 0055** (which left deckbuild as a separate phase after
the draft and made the Auto-Pick a pure Pick-Heuristic decision).

## Context

ADR 0055 fixed that a Limited Event "ends at the built Deck" and that a human's
timer-expiry Auto-Pick is computed by the Bot Drafter's Pick engine. The
draft-time pool view shipped as a flat `name ×count` text list, with a distinct
post-draft deckbuild step (`pool-deck-builder-form`, MTGO-style maindeck +
sideboard, dnd, piles-by-Mana-Value). Two problems: (1) the draft-time view
throws away the deckbuilder's affordances a player wants _while_ drafting
(seeing images, sorting by curve, parking cards toward a sideboard), and (2) a
heuristic Auto-Pick overrides a present-but-slow human's actual intent.

## Decision

- **The draft-time Pool _is_ the working deck.** The draft view reuses the
  existing pool deckbuilder surface (card images, fixed **Mana Value** columns,
  a narrower **Sideboard** column, drag-and-drop) with the active **Booster**
  panel mounted above it. Draft and deckbuild are one continuous surface; the
  post-draft build view is the same surface with the Booster removed. This
  realises ADR 0055's "ends at the built Deck" as a smooth continuation rather
  than a phase boundary.

- **The Pool Arrangement is server-persisted on the Seat.** The maindeck-column
  / sideboard layout, including a **per-card manual column override** (a card
  pinned to a chosen fixed Mana-Value column stays there, Draftmancer/MTGO
  style), is stored on the seat so it is device-independent and carries
  unchanged from draft into deckbuild. It is presentation/deck-intent layered
  over the authoritative Pool multiset — never the legality authority (ADR 0055:
  legality still validates the deck multiset against the Pool).

- **Pick gestures, and selection vs commitment.** A **single click selects**
  (tentative, never commits). A **double-click**, the context-menu **Pick** /
  **Pick to sideboard** actions, or a **drag** (Booster→Pool column /
  Booster→Sideboard) commits the Pick immediately. A committed non-drag Pick
  lands by default in the card's corresponding Mana-Value column.

- **Auto-Pick honours the Selected Card first.** On timer expiry the seat's
  **Selected Card** is picked if one is set; only with no selection does it fall
  back to the Bot Drafter's Pick engine (ADR 0055's behaviour, now the
  fallback). This is strictly better than the earlier "pre-select the first
  card" idea for an away player — the heuristic fallback picks a real card, not
  position 1. Never random.

- **Timer is on/off, following the official MTGO/Wizards descending schedule**
  (amends ADR 0055's admin-configurable fixed `timerSeconds`). When on, seconds
  are a function of **cards remaining in the pack**: 15→40, 14→40, 13→35,
  12→30, 11→25, 10→25, 9→20, 8→20, 7→15, 6→10, 5→10, 4→5, 3→5, 2→5, 1→auto
  (single card, no choice). Packs smaller than 15 (ARN/ATQ = 8 cards) index the
  same table by cards-remaining, so a small pack simply starts lower on the
  schedule. The between-pack review period (30s after pack 1, +15s each) is
  deferred.

## Considered options

- **Keep deckbuild a separate fresh phase** (all pool cards start in the
  sideboard): rejected — throws away the sorting a player did while drafting and
  makes the Booster→Pool vs Booster→Sideboard drop distinction meaningless.
- **Client-only (localStorage) Pool Arrangement**: rejected — device-specific,
  lost on clear, and can't be honoured by the server-side Auto-Pick resolver.
- **Auto-Pick always heuristic (ADR 0055 as-is)**: rejected — overrides a
  present human's tentative selection.
- **Auto-select the first card as the timeout default**: rejected in favour of
  the heuristic fallback (a real pick beats position 1).

## Consequences

- New Seat state: the Selected Card (`selectedPickId`) and the Pool Arrangement
  (per-card column, maindeck/sideboard split) — both server-persisted, so both
  go into `PERSISTED_OPTIONAL_KEYS` with round-trip serialization tests
  (serialization requirement).
- `resolveAutoPickTimeout` reads the Selected Card before falling back to the
  Pick engine; a single-click selection mutation updates `selectedPickId`.
- The timer becomes `timerEnabled: boolean` + a cards-remaining schedule
  lookup, replacing the fixed `timerSeconds` value.
