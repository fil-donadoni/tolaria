# The Modern metagame is the second ranked Target; Commander and the full Premodern pool rank third

## Status

accepted (2026-11-08, issue #8725; owner ruling given in the session that
picked the issue). Settles ADR 0143 Amendment IX's "the owner will decide
later". Builds on commit 2a3bfd817 (issue #8276) and PRD #8445.

## Context

ADR 0143 Amendment IX left the integer 2 open in the Target ranking until the
owner decided whether a `modern-metagame` Target takes it. On 2026-11-06 the
Target was registered at priority 2 (ten Modern archetypes, 210 distinct
cards, `data/modern-metagame-decks.json`, `enforced`) with no record, and
`format-premodern` kept 3.

## Decision

- **`modern-metagame` ranks second** (priority 2): P2 today, P1 when the
  Vintage cube completes (bands follow the order, ADR 0143).
- **Commander (v2, ADR 0145) and the full Premodern format pool
  (`format-premodern`) rank third**, P3. Commander has no registry row with a
  priority yet; it takes 3 when its first slice is cut.
- It completes on `playable`, as every Target (Amendment IX).

## Consequences

- ADR 0143 gains a status line naming this record.
- `data/targets.json` already encodes modern = 2 and premodern = 3.
