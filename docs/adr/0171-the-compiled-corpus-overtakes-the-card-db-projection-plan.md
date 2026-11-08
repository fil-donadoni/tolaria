# The resident compiled corpus overtakes ADR 0046's database projection

## Status

accepted (2026-11-08, issue #8725). Overtakes the deferred half of ADR 0046;
the repo-is-source-of-truth half stands. Evidence: ADR 0113 and
`docs/research/adr-audit-2026-11-07.md`.

## Context

ADR 0046 fixed three things (pure-JSON `effects[]`, one `getDefinition` seam,
a synchronous GRE) and deferred a fourth: a content-hashed Convex table
projecting DSL-only cards, to be built "when draft/sealed work starts or bundle
size hurts". Both triggers fired. The answer was not a table. ADR 0113 made the
compiled-card store the **whole corpus, resident**: bundled server-side, one
content-addressed immutable asset client-side, definitions built on demand
behind a generated Definition Index (Amendment IV). ADR 0113 cites 0046 for the
seam but never says the projection plan is dead.

## Decision

The DB projection of ADR 0046 will not be built. The `getDefinition` seam,
the pure-JSON `effects[]` guard and the synchronous GRE stand and are the
reason ADR 0113's shape works. Card **Prints** live in a Convex table (ADR
0140); definitions do not.

## Consequences

- ADR 0046 gains a status line: deferred projection superseded here.
- Nobody should open "cards in the DB" again without a measurement that breaks
  ADR 0113's heap bound (64 MiB per call).
