# ADR 0010 — LEA cards declared permanently out of scope

**Status:** Accepted (2026-06-14)

## Context

An audit of `convex/cards/sets/lea.ts` against the canonical Alpha catalogue
(290 distinct cards, Scryfall `set:lea`) found that **every** Alpha card has a
registered `CardDefinition` except for ten, which remain commented out. Those
ten split into two groups: six need genuinely new GRE features and are
planned (see [ADR 0011][adr-0011], [ADR 0013][adr-0013], and the Raging River
work in [ADR 0012][adr-0012]); the remaining **six are declared out of scope
by this ADR** because they are either irrealizable in a digital engine or
depend on a game mode Tolaria does not model.

Without this decision the six sit in limbo — periodically re-audited,
re-investigated, and re-deferred. Recording the exclusion makes "the LEA set
is complete" a precise, defensible statement: complete **minus six named
cards**, each excluded for a stated reason.

## Decision

The following six Alpha cards are **not implemented and will not be**, absent a
deliberate reversal of this ADR. They stay commented out in `lea.ts` with a
back-reference to this document.

### Physical-dexterity card (irrealizable)

| Card          | Reason                                                                                                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chaos Orb** | "Flip this artifact onto the battlefield from a height of at least one foot… destroy all nontoken permanents it touches." (CR — superseded) The effect is a real-world physical action with no digital equivalent. Every digital implementation either bans it or substitutes an unrelated effect; we decline to invent one. |

### Ante cards (game mode not modelled)

Ante (CR 407) requires an **ante zone** and a pre-game "remove from your deck
if not playing for ante" step. Ante was removed from sanctioned play and the
modern game; Tolaria models neither the zone nor the pre-game removal.

| Card                    | Effect                                              |
| ----------------------- | --------------------------------------------------- |
| **Contract from Below** | Discard hand, ante top card, draw seven.            |
| **Demonic Attorney**    | Each player antes the top card of their library.    |
| **Darkpact**            | Exchange an ante card with the top of your library. |

### Whole-opponent control (CR 720)

| Card                | Reason                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Word of Command** | "You control that player until Word of Command finishes resolving. The player plays that card if able…" Requires driving the opponent's decisions — mana ability activation, target choices, sub-spell casting — mid-resolution, under a constrained legality envelope. This is the single most invasive control mechanic in Alpha and touches priority, the stack, and mana payment simultaneously. Disproportionate for one card. |

### Hidden-assignment pile combat with randomness (CR 509 variant)

| Card           | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Camouflage** | Each defender secretly divides creatures into piles equal to the number of attackers, piles are assigned to attackers **at random**, and forced blocks resolve from the assignment. The random pile-to-attacker assignment plus simultaneous hidden division across both players is materially more complex than Raging River's deterministic left/right labelling (which **is** planned, [ADR 0012][adr-0012]). Excluded while Raging River is kept. |

## Rationale

1. **Precision over aspiration.** "Set complete minus six declared cards" is a
   verifiable claim. "Set nearly complete" is not.
2. **Each exclusion is independently justified**, not a blanket "too hard".
   Chaos Orb is irrealizable in kind; Ante is a missing game mode; Word of
   Command is a control surface out of proportion to its payoff; Camouflage is
   excluded as the harder twin of a card we do implement.
3. **Reversible by intent, not by drift.** Re-including any of these is a
   conscious act that supersedes this ADR — not something that happens because
   someone forgot they were excluded.

## Consequences

- The six definitions stay commented in `lea.ts`, each prefixed with
  `// Out of scope — see ADR 0010`.
- The LEA completion target is **284 of 290** registered (280 already done +
  the four planned in ADRs 0011–0013), with six permanent exclusions.
- Dead duplicate stubs (superseded comment blocks for Terror, Disintegrate,
  Fog — already implemented under active definitions) are unrelated to this
  ADR and may be deleted independently.

## Out of scope

- Implementing an ante zone or whole-player control purely to satisfy these
  cards. If such infrastructure ever lands for another reason, the relevant
  exclusions here can be revisited.

[adr-0011]: ./0011-text-changing-effects-layer-3.md
[adr-0012]: ./0012-transient-combat-block-restrictions.md
[adr-0013]: ./0013-face-down-permanents.md
