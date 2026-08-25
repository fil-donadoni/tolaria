# GRE catalogue guards — derivation and incident history

Companion to `.claude/rules/gre-development.md` § DSL-first authoring, which
carries the **norms** (Guard A, Guard B, the identity-only-test ban). This
file carries the **reasoning, the measured numbers and the incident
narratives** — read on demand, not resident in every session (see
`context-residency-audit.md`'s split, which this follows).

## Guard A — keyword-must-be-implemented (#962)

Named for the shape that motivated it: a shipped card carried `deathtouch`/
`hexproof` in `staticAbilities[]` while the Mechanics Registry still listed
the keyword `status: "planned"` — the ability rendered on the card face and
did nothing in the engine, silently (#957/#958). `mechanicsRegistry.test.ts`
now fails CI catalogue-wide on any shipped keyword that isn't `implemented`.

## Guard B — documented-divergence-needs-issue (#962, widened #1900)

### Vocabulary widening (#1900)

The original `MARKER` regex caught four words (`Deferred`/`divergence`/
`not implemented`/`TODO`), anchored as the comment's FIRST word. A corpus
sweep — dumping every `//` line matching a wide net of divergence-adjacent
English and reading the results by hand, never guessing off the issue's own
examples — found card authors overwhelmingly confess divergences with other
words (`SIMPLIFICATION`, `approximated by`, `not modelled`, `not enforced`,
`deviation`, `unimplemented`, `unbuilt`), and almost never as the comment's
first word: most per-card divergence prose opens with the card's own name,
not a marker word. Candidates REJECTED after the same read, for hitting
sanctioned non-confession shapes far more than real ones: `no-op` (78 hits,
almost all ordinary CR 608.2b/107.3 no-op explanations, not divergences),
`stub`/`placeholder` (219/12 hits, `check-stub-coverage.ts`'s domain —
commented-out cards, not a shipped card's partial behaviour), `best effort`/
`capability gap`/`engine gap` (mostly fallback-caller or provenance prose).

### Window tightening (#1900)

Guard B (#962) originally scanned the marker's whole comment PARAGRAPH for a
disposition, closing two absorption leaks (a provenance ADR citation
swallowing a deferral note below it; an untracked list vouched by an
unrelated "out of scope" note lower in the same block). #1900 found a THIRD
leak one level down: an unrelated ref sitting in a DIFFERENT SENTENCE of the
SAME paragraph as the marker — the `eld/colorless.ts` Fabled Passage shape, a
`moveZone` provenance ref for one clause wrongly vouching for a separate,
untracked divergence a few lines later in the same paragraph. Tightened to:
the marker's own line, the line immediately following it, or an earlier
same-paragraph line that is itself a dispositioned marker (the shared
section-footer shape — one ref, one header, vouching for every marker-word
bullet listed under it — still works under the tighter window).

### Sites dispositioned (#1900)

The widening surfaced 114 new sites: 101 via `tracked-by:` refs to the new
triage umbrella #2785, 11 as self-declared out-of-scope (explicit
"acceptable"/"faithful"/"no observable difference" language), 2 by reusing an
existing same-topic ref that sat just outside the tightened window. No
confession comment was deleted or watered down to make the guard pass.

## Identity-only per-card tests (`scripts/__tests__/identity-only-card-tests.test.ts`)

916 blocks that read a card's own definition fields and asserted them straight
back — no engine entry point, no fixture builder, no reducer between the read
and the `expect` — were deleted in #2363. Each was the card's definition
written twice: green on a card that was inert in the engine, red only on an
unrelated edit touching the same field, and counted as coverage while proving
nothing. Before this, the keyword-test convention was a "snapshot the
definition" row that only proved the definition equalled itself; Guard A
(above) replaced it with a strictly stronger catalogue-wide check. The
identity-only guard now fails CI on any new such block; its allowlist is
empty and is meant to stay empty.
