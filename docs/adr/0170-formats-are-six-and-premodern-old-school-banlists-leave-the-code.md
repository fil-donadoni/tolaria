# Six Formats; the banlists of Premodern and Old School live in the database

## Status

accepted (2026-11-08, issue #8725). Reverses ADR 0036's "everything is
code-side" for banlists, as ADR 0057 already did in its body; this record names
the reversal and the registry size. Evidence: `docs/research/adr-audit-2026-11-07.md`.

## Context

ADR 0036 introduced deck Formats with three members (Freeform, Alpha 40, Old
School) and a rule: "Everything is code-side; no format data in the DB. A
banlist or ruleset change is a code release." ADR 0057 overturned that for
banlists (DB-backed, name-keyed, Scryfall-synced) without naming the reversal in
0036's status. `FormatId` (`convex/formats.ts`) now has six members: freeform,
alpha-40, old-school, premodern, limited, manual. `GLOSSARY.md` § Format
already lists all six.

## Decision

- The Format registry is open-ended: a Format is a code-side ruleset
  (size bounds, copy limits, legal sets) whose **banned/restricted lists** may
  be data. Premodern and Old School read theirs from the database (ADR 0057);
  the code-side `Set` constants are the seed, not the authority.
- Freeform, Alpha 40, Limited (pool-scoped, ADR 0106) and Manual (unvalidated)
  keep no list.
- The three-Format scope of ADR 0036 is history; the registry is whatever
  `FormatId` says.

## Consequences

- ADR 0036 gains a status line pointing here and at ADR 0057.
- A new Format needs a `FormatId` member and its row in `GLOSSARY.md` § Format
  in the same change.
