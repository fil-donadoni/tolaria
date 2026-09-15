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

## No card name in an engine identifier (`convex/cards/__tests__/engineIdentifierNames.test.ts`, #1918)

Derivation for the norm `.claude/rules/gre-development.md` § Naming states in
six lines. It is NOT in `convex/CLAUDE.md`: the on-demand tier had 98 bytes of
headroom against `ON_DEMAND_CEILING_BYTES` when this landed, and a guard's
reasoning is exactly what this file is for.

**The rule** (issue #1917). An engine identifier is named after the MECHANIC,
never after the card that introduced it. `islandSanctuaryProtection` is a
`GameState` key the next "can only be attacked by creatures with flying" card
cannot use without a sweep; `playerAttackRequirements` is one it can. Two
halves, and only one is a rule:

- **Generic NAME from card #1 — always.** Costs nothing, it is a mechanical
  rename, and it is what the second card hooks onto.
- **Generic SHAPE from card #1 — no.** Generalizing before the second case is
  guessing the axis of variation. `landManaRidersThisTurn` generalized well
  precisely because it came after Deep Water + High Tide + Chaos Moon; on High
  Tide alone it would have been `islandManaBonus: number`, wrong axis. Rename
  now, keep the narrow shape until card #2 shows the axis.

**Why a guard rather than a convention.** The rule is mechanically verifiable —
card names are enumerable, engine identifiers are enumerable, and the check is
containment. The hand audit of 2026-07-29 that produced #1917's rename list was
true for 2026-07-29 only, and the guard found two identifiers it had missed
(below).

**Surfaces.** Every top-level `interface`/`type` declaration in
`convex/gre/state.ts` and `convex/cards/types.ts`, members read through the
TypeScript AST, plus the Op names in `EFFECT_OP_REGISTRY`. Issue #1918 specified
four declarations — `GameState`, `PlayerState`, `CardInstanceState`,
`SpellContext` — and review found that a hand-listed set is a blind spot with no
tell: `PlayerPreferences` (reached through `GameState.playerPreferences`, which
is in `PERSISTED_OPTIONAL_KEYS`, so persisted state shape) carries
`libraryOfLengRouting`, and `TriggerStateView` carries the
`gazeOfPainActiveThisTurn` mirror that #1917 explicitly lists for rename. Both
were live violations, invisible to the four-name sweep. Sweeping the two files
is the same work and closes the class. The AST is used rather than a runtime key
list because a type has no runtime keys, and because it sees the REQUIRED
members too — `PERSISTED_OPTIONAL_KEYS` is exhaustive over the OPTIONAL ones
only.

**Detection.** Normalise the card name (lowercase, non-alphanumerics dropped:
"Gaze of Pain" → `gazeofpain`); flag when an identifier contains it. Containment
runs **identifier ⊃ card name, never the reverse** — that is what keeps the Op
`animate` from being flagged by the card "Animate Wall" while still flagging a
hypothetical `animateWallCounter`.

**`MIN_NAME_LENGTH = 5` is a floor, not a free choice.** Measured against the
catalogue: at 6 the real offender `GameState.meleeCombat` ← the card "Melee" is
lost; at 4 the six extra pairs are all English substrings ("Bind" inside
`captureBinding` / `recallCapturedBinding` / `capturedBindings`, "Rout" inside
`revealTopAndRoute`) with no true positive among them.

**Two lists, asymmetric on purpose.**

- `ALLOWLIST` — (surface, identifier, card) rows that ARE card-named and not
  renamed yet, each with its tracking issue. Pre-populated with the #1917 sweep
  deliberately: landing the guard BEFORE the sweep is what makes it impossible
  for the sweep to stop halfway. A row matching nothing reds, so it only shrinks.
- `RULES_VOCABULARY_NAMES` — a card name that is also ordinary rules vocabulary
  (`Island`, `Flash`, `Overload`, `Regeneration`, `Sacrifice`, `Blessing`,
  `Exclude`, `Recall`), dropped from the corpus across all surfaces. This is the
  FAIL-OPEN list, so it is held to the stricter test: the name must be a real
  card AND the row must suppress something today. `Forest`/`Mountain`/`Plains`/
  `Swamp` were in the first draft and suppressed nothing — the assertion deleted
  them. Add a row the day the collision fires, with the identifier that fired it.

**Anti-vacuity.** "Scanned nothing" and "found nothing" look identical, so two
checks stand behind the sweep: `GameState`'s extracted members are cross-checked
against `PERSISTED_OPTIONAL_KEYS` + `TRANSIENT_KEYS`, and each file must yield a
floor of scanned members (`MEMBER_FLOORS`), so a reshape the AST walk cannot
read — a mapped type, an intersection, a namespace, a split interface — reds
instead of silently shrinking the surface.

**Stated scope limit.** An anonymous inline shape is not a declaration and is not
swept: `types.ts`'s `preferences?: { libraryOfLengRouting?: … }` is invisible
while the `PlayerPreferences` member it mirrors is caught. A rename sweep greps
the old name, so the mirror travels with the original; what the guard promises is
that the original cannot be missed.

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

**Its two remaining blind spots**, both of which the one-line habit avoids:

1. A citation **wrapped across two comment lines** — the prefix is split from
   its id.
2. An id on a line mentioning `CR ` **nowhere**: 1,795 today, 597 of them in
   `mechanicsRegistry.ts` alone. Deliberate boundary — reaching them reds the
   gate on 16 ids that are mostly not citations at all.

A third — a **resolvable but wrong** id, since the scan only asks whether an
id exists — stood as a standing hole until the citation ledger (below,
ADR 0133) bounded it.

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

**The targeted scans** close blind spot 3 for one recurring shape at a time,
outside 701/702: one id (or a small set), one claim vocabulary, one printed
rule that plainly contradicts it. `scripts/cr-118-4-life-payment.ts` (issue
#2559) reds on the {X}-cost rule cited for a life payment;
`scripts/cr-616-1-subrule-citations.ts` (issue #3014) reds on the copy and
back-face priority tiers of the replacement-ordering procedure cited for the
once-per-event rule or the choose-the-order rule. Each fires on the claim
words, never on the id alone, and passes a line that names what the id is
really about. They share one skeleton (`scripts/lib/cr-misattribution.ts`:
file walk, needle prefilter, line scan, `cr-cite-ok`), so the next shape is a
rule row, an `EXEMPT` list, a CLI report and a regression test. A general
claim-vs-text checker is out of scope — the gate is offline and deterministic.

**The citation ledger (`data/cr/citations-ledger.json`, ADR 0133, issue
#3674)** closes blind spot 3 for every citation made after it and bounds it
for every one before. One entry per citation — id, the normalized text of the
citing line (never a position), a status — with two statuses that mean exactly
one thing each: `confirmed` (a reader printed the rule and the line says what
it says; carries the hash of the printed text) and `baseline` (predates the
ledger, never checked). The fourth scan under `cr:lint` reds on a citation
with no entry, a confirmed entry whose rule text changed (a `cr:sync`
reopens every confirmed citation of a rule it rewrites), a `baseline` entry
the merge-base's ledger does not have (the set only shrinks — the recording
command never writes it), and a stale entry. The report prints the rule under
the line and names the one command that records a check,
`bun run cr:ledger confirm <file>:<line>` — one line per call, no bulk form.
The tokenizer is the existence scan's own (`scanCitations`), the hashed text
is what `bun run cr <id>` prints (`scripts/lib/cr-rules.ts`), and the
regression test (`scripts/__tests__/cr-citation-ledger.test.ts`) drives the
same pure report over a fixture document. **41,276 baseline entries** were
recorded on 2026-09-15, after issue #3013 corrected the ten 616.1c/d sites;
burning them down is issue #3675.

Wizards republishes roughly per set at <https://magic.wizards.com/en/rules>.
