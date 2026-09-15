# ADR 0133 — Every CR citation carries a committed ledger entry: `confirmed` against the printed rule, or `baseline` — and the baseline only shrinks

**Status:** Accepted (2026-09-15, issue #3674). Amends ADR 0098.

## Context

ADR 0098 vendored the Comprehensive Rules and put `bun run cr:lint` in the
gate. The gate asks three questions: does a cited id exist; does a
`CR 701.N`/`702.N` citation name the keyword its section is titled with; and,
for two targeted shapes (issues #2559, #3014), does the line claim something
the cited rule plainly does not say. Outside those shapes a **resolvable but
wrong** id passes clean — blind spot 3 in
`docs/agents/gre-guards.md` § CR citation linting, stated there as a standing
hole.

The findings drawer shows the hole is a class, not an incident: `707.10b`
cited for retargeting a copy at 36 sites (really 707.10c), `602.5b` at 86,
`702.35c` for the Madness replacement, `704.5m` for the world rule, `608.2b`,
`603.3c`, `117.3a`, `118.5`, `114.1`, `510.1c`, `603.6e`, `611.2b` — and the
ten replacement-layer sites issue #3013 corrected, where two priority-tier
letters of CR 616.1 stood for the once-per-event rule (CR 614.5) and the
choose-the-order rule (CR 616.1e). Every one was found by a human printing the
rule. A targeted scanner per shape guards only shapes already discovered, and
the tree holds ~43,700 citations.

The gate is offline and deterministic by contract (CLAUDE.md, ADR 0098). A
model reading every citation against its rule inside `check:all` is out.

## Decision

1. **A committed ledger beside the vendored CR** —
   `data/cr/citations-ledger.json`. One entry per citation: the cited `id`,
   the **normalized text of the line** citing it (whitespace collapsed; never
   a file or a line number), the number of **`sites`** in the tree making that
   exact citation, a `status`, and for `confirmed` entries the `ruleHash` of
   the printed rule at confirmation. The site count is what keeps "moving a
   line stays green" from also meaning "copying a recorded line is free": a
   second site of a recorded line is unrecorded until confirmed.

2. **Two statuses, and the semantics of each are exact.** `confirmed`: a
   reader printed the rule (`bun run cr <id>`) and the line says what the rule
   says. `baseline`: the citation predates the ledger and was never checked.
   There is no third status and no "trusted" flag.

3. **`cr:lint` reds, offline, on four things**: a citation in the tree with
   **no entry** (a new comment, an edited line — editing the claim reopens
   its citation on purpose — or a new site of a recorded line); a `confirmed`
   entry whose **rule text no longer hashes** to what was confirmed (a
   `cr:sync` that rewrites a rule reopens every citation of it, which is how
   the next renumbering outside 701/702 gets caught); a **`baseline` entry the
   base branch's ledger does not have**; and a **stale entry** matching no line
   in the tree, or more sites than the tree has. The failure output names the
   line, prints the cited rule and gives the confirming command.

4. **The baseline only shrinks.** The recording command never writes
   `baseline`; `cr:lint` compares the set with the merge-base's ledger through
   git (`scripts/lib/base-artifact.ts`, the Oracle lockfile's state-regression
   precedent: a base that cannot be read is a red, a base that has no ledger
   yet is a skip that says so). Nothing enters the tree unchecked under that
   status. Burning the baseline down is issue #3675.

5. **One recording command, outside the gate**: `bun run cr:ledger` lists every
   open citation beside the full printed text of its rule;
   `cr:ledger confirm <file>:<line>` records the citations on **that one line**
   — there is no bulk form; `cr:ledger prune` drops stale entries, and every
   write prunes; `cr:ledger init` generated the baseline once and refuses
   while a ledger exists. A wrong citation is fixed on its line first, then
   confirmed under its new id.

6. **One tokenizer.** What counts as a citation is the existence scan's own
   walk (`scanCitations`: the prefixed pass plus bare ids on a `CR ` line);
   the ledger reuses its output, so the two scans cannot disagree on the set.
   What gets hashed is what `bun run cr <id>` prints, through the one parser
   both share (`scripts/lib/cr-rules.ts`). The exempt-file convention (the
   guards' own sources and tests, the findings drawer, this ADR and ADR 0098)
   applies, as an explicit list of files rather than an open prefix. The
   **`cr-cite-ok` hatch is NOT honoured by the ledger** — a deviation from the
   issue's letter, chosen at review: the targeted scans ask "is this claim
   wrong", which a deliberate counter-example answers; the ledger asks "was
   this line read", which it does not, and an unbounded one-word suppression
   on a gate this heavy is a hatch every session would reach for. No
   suppressed citation outside the exempt files existed when this was decided.

7. **Shape.** One entry per line, sorted by id then line, fixed key order, no
   header hash and no tally — so two branches confirming two different
   citations touch disjoint lines and merge without a conflict
   (`scripts/lib/generated-artifacts.ts`' discriminator). Prettier-ignored,
   written only through the command. What the gate can prove about a
   `confirmed` entry is exactly this: its hash matches the rule's text NOW.
   The entry is a **recorded human claim** that the rule was read against the
   line — the command asserts it on the reader's behalf, and a hand-written
   entry with the right hash asserts the same thing with less ceremony. The
   ledger makes the claim explicit, attributable in `git blame`, and
   reopenable; it does not make it true.

## Consequences

- **A session adding a CR comment now owes one command per line.** The gate's
  red is the workflow: it prints the rule under the line and names
  `cr:ledger confirm <file>:<line>`. That is the cost this ADR chooses to pay —
  the alternative is what the findings drawer records.
- **The three existing scans stay.** They are cheap and catch known shapes
  inside the baseline, which the ledger cannot: a `baseline` entry asserts
  nothing.
- **A `cr:sync` reopens every confirmed citation of a rule it rewrites**, and
  only those — baseline entries were never checked, so a rule change does not
  make them more unchecked. Section-level citations (`CR 605`) hash the whole
  section, as `bun run cr 605` prints it, so they reopen on any change under it.
- **The baseline was generated after issue #3013 landed**, so the ten known
  616.1c/d mis-citations are corrected, not grandfathered; the committed file
  carries no 616.1c/616.1d entry.
- **Blind spot 3 is closed for every citation made after this ADR, and
  bounded for every one before it**: the ~41,000 baseline entries are a
  finite, shrinking, enumerable list rather than a standing hole.
- **The burndown has a known tooling cost.** A `confirm` re-scans the tree
  and rewrites the ledger (~1–2 s), one line per call by design; at 41,000
  entries that is a day of pure tooling. Issue #3675 owns the burndown and
  must solve this (a warm-process confirm loop, or a model-assisted pass that
  proposes corrections and leaves the one-line confirmation to a reader) —
  this ADR deliberately does not add a bulk path to the gate-side command.
- Citations wrapped across two comment lines (issue #2514) and ids on a line
  with no `CR ` stay outside — the ledger inherits the existence scan's
  definition of a citation.
