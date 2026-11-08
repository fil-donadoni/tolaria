# The hand-written catalogue stays in code; the compiled pool lives in `data/`

## Status

accepted (2026-11-08, issue #8725). Answers the revisit question ADR 0081
posed. Evidence: `docs/research/adr-audit-2026-11-07.md`.

## Context

ADR 0081 decided that card definitions stay in `convex/cards/sets/**` and named
two preconditions for revisiting: a predicate DSL for `matches`/`applies`/
`interveningIf`/…, and a replacement for the CI guards that run statically
against the in-code registry. Since then the Oracle compiler (ADR 0105, ADR 0113) puts a large compiled pool in `data/oracle-compiled.json`, hydrated into
definitions by `getDefinition`. A reader sees "the catalogue is in JSON" next to
"the catalogue stays in code".

## Decision

Neither precondition fired for the hand-written catalogue, and 0081 stands for
it: closures in `convex/cards/sets/**` remain code, the static guards still
run on them. What exists in `data/` is a **different population**: cards the
compiler derives from Oracle text, whose rows are data by construction and whose
guards (round-trip, lockfile, Grammar Gaps) are their own. A compiled card is
never authored in a database; the lockfile is regenerated, never edited.

## Consequences

- ADR 0081 gains a status line: precondition did not fire; compiled pool noted.
- "Move the catalogue to a DB" remains closed on the same terms as before.
