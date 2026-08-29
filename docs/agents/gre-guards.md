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

## CR citation linting (`bun run cr:lint`, #2429)

Derivation for the norm CLAUDE.md states in four lines. Moved here from
CLAUDE.md by the Lever 4 pass (`context-residency-audit.md`): it is the
reasoning behind the rule, not the rule, and it was being re-read on every
request of every agent.

**Why the guard exists.** 44 of the 850 distinct CR ids cited in this repo
resolved to nothing, and nearly all of them never existed in any revision.
All 44 were corrected in #2429, and `cr:lint` joined `check:guards` so a new
one cannot land. Before ADR 0098 vendored the document, the sourcing habit was
an ad-hoc `curl` of a remembered `MagicCompRules YYYYMMDD.txt` URL — twelve
distinct versions, back to 2022, appear in past session transcripts — plus two
third-party mirrors (yawgatog; ancestral.vision, frozen at 2022-10-07).

**What the first scan sees.** It resolves every bare `NNN.Nx` token on any
line that mentions `CR `, which is why a bare id in a slash-list is covered:
two of the 44 ids, at 10 sites, hid in exactly that shape and survived the
first correction pass.

**Its three blind spots**, all of which the one-line habit avoids:

1. A citation **wrapped across two comment lines** — the prefix is split from
   its id.
2. An id on a line mentioning `CR ` **nowhere**: 1,795 today, 597 of them in
   `mechanicsRegistry.ts` alone. Deliberate boundary — reaching them reds the
   gate on 16 ids that are mostly not citations at all.
3. A **resolvable but wrong** id, since the scan only asks whether an id
   exists.

**The second scan (`scripts/cr-keyword-citations.ts`)** closes blind spot 3
for keywords. For every `CR 701.N`/`702.N` citation it reads the section TITLE
out of the vendored document and reds when the line names a different keyword
— "701.19 search" is Regenerate, "701.16 sacrifice" is Investigate, "702.13
landwalk" is Intimidate. Wizards inserts keyword actions alphabetically, so
the 701 block renumbers every few revisions; keying the check on titles rather
than numbers means the NEXT renumbering reds the gate instead of going
unnoticed. **793 sites stood wrong when it was added**, plus ~200 more (bare
ids on keyword-less lines) found by hand in the same pass. It sees only lines
that name a keyword.

Wizards republishes roughly per set at <https://magic.wizards.com/en/rules>.
