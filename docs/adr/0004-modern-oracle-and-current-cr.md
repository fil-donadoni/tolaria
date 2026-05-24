# ADR 0004 — Card text and rules follow modern Oracle and current Comprehensive Rules

**Status:** Accepted (2026-05-24)

## Context

Magic cards have been errata'd multiple times across the game's history. The
text printed on a card (e.g. the Alpha printing) often differs significantly
from the current Oracle text on Scryfall. Similarly, the Comprehensive Rules
have evolved — older interactions may have been simplified, restructured, or
re-templated.

When implementing a card or rules interaction, the project must pick a
canonical source.

## Decision

**Always follow the modern Scryfall Oracle text and the current Comprehensive
Rules.** Never the printed text on the physical card, never an older CR
revision.

Concretely:

- `CardDefinition.oracleText` must match the current Scryfall Oracle entry
  verbatim.
- GRE implementation must match the behavior implied by that modern Oracle
  text and current CR sections.
- When in doubt about an interaction, the modern CR (and the corresponding
  Oracle ruling) wins over historical printing, internal comments, or
  intuition from an older version of the card.
- If `oracleText` and impl disagree, the impl is the bug — fix the impl, not
  the text.

Example: Winter Orb. Printed (Alpha): "Players cannot untap their artifacts,
creatures, or lands during their untap phase." Modern Oracle: "As long as
Winter Orb is untapped, players can't untap more than one land during their
untap steps." The impl must cap **lands only**, not ACL.

## Consequences

- `/new-card` skill fetches from Scryfall (which serves modern Oracle).
- Comment blocks may reference printed text for historical context but must
  not be treated as authoritative.
- When CR templating changes (e.g. "destroy" vs "put into the graveyard"),
  the project follows the current templating.
