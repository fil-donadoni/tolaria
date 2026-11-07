# Docs follow the change — the prose-enforced rule

**A substantive change lands with the documents that describe it, in the
same PR.** Substantive: a behaviour, a default, a knob, a count, a metric, a
workflow step, a command, a file that moved, a decision that flipped. The
resident line is CLAUDE.md § Development cycle step 10; this file is its
derivation, read on demand.

## Why a prose rule, and why now

Nothing mechanical catches a guide that still says "not yet built" or "ten
rules" after the code moved: a test can check that a file exists or that a
number matches a constant, not that a paragraph is still true. A document
that lies is worse than none — the next session acts on it with full
confidence, and a reader who delegated the area (the owner, on the Bot) has
no way to tell.

Measured on 2026-11-07 (audit of the play-Bot documentation against the code
at `3f750884247a`): **35 stale claims across 9 documents**, 4 clean. The
damage was not in the ADRs, which err only by a missing status line or a
wrong citation; it was in the two "living summaries" every Bot session reads
first — `docs/guides/bot-glossary.md` and `.claude/skills/bot-change/SKILL.md`
— both still describing Roadmap v2 (ladder as metric, priors "not yet on the
action space", early stopping "not yet built", difficulty "one knob") after
Roadmap v3 (ADR 0138) and four shipped tickets. Every stale number lived in
`docs/research/` with no date and no sha.

## The rule, in full

1. **Grep before the PR.** For every identifier, term, number, default and
   issue the diff renames, moves, flips or retires, grep `docs/`,
   `GLOSSARY.md`, `.claude/skills/**`, `.claude/rules/*.md`,
   `convex/CLAUDE.md`, `src/CLAUDE.md`, `AGENTS.md` (regenerate it with
   `bun run agents:build`, never edit). Fix every hit in the same PR, or say in
   the PR body why the hit stands.
2. **PR body line.** `Docs: <files touched>` or `Docs: none (<why>)`. A
   reviewer reads it like the `check:ui` line: `none` on a diff that moves a
   default, a metric or a workflow step is a review finding, not a formality.
3. **Numbers live in `docs/research/`, dated.** A measured value (a share, a
   count, a duration, a pass rate) goes in a research document under a
   `Measured at <sha> (<date>)` line, never inline in a guide, a skill or an
   ADR; those cite the document. A number older than the code it describes is
   a stale-number finding, and the honest fix is a re-measure or a `Dated:`
   banner saying what moved since.
4. **An ADR is history.** It is never edited to say something new. A decision
   that changes gets a NEW ADR; the old one gains a one-line status at its top
   (`Superseded by NNNN` / `Amended by NNNN: <what>`) and, once the index
   carries a status column, its row. Fixing a broken link, a wrong citation or
   a `Proposed` that shipped is maintenance, not a new decision, and is done
   in place with a dated note.
5. **Living summaries are reconciled, not appended.** A glossary, a skill or a
   guide describes the thing as it IS. When a change makes an entry false,
   rewrite the entry; do not add a paragraph under it that contradicts the one
   above. State the reconciliation point (`Last reconciled against the code at
<sha> (<date>)`) at the top when the file is large.
6. **Docs-only fixes have their own lane.** Something already shipped and
   described wrongly: `bun run wt:docs <slug>` → write → `bun run docs:ship`
   (`check:docs` in seconds, then the queue). Never in the shared checkout
   (`.claude/hooks/deny-guard.sh` § 0 blocks it).

## What is NOT owed

- A refactor that changes no behaviour, default or name a document cites:
  `Docs: none (refactor, no cited name moved)`.
- A test-only change, unless the test is cited as a guard in a document.
- A number that only a research document reports: re-measuring it is a
  separate ticket, not a blocker — the PR adds the `Dated:` banner.

## Budget

The resident tier (`CLAUDE.md`, `.claude/rules/*.md`) and every skill
manifest are byte-budgeted (`scripts/__tests__/resident-context-budget.test.ts`).
This rule costs the resident tier one step line; everything else is here.
A doc update that pushes a manifest over its ceiling moves a branch-only
procedure to a sibling file behind a pointer, as `/next-ticket` does.

## Glossary

### <a id="g-living-summary"></a>Living summary

A document that describes the current state of a subsystem for a reader who
starts from zero (a glossary, a skill, a guide), as opposed to an ADR (a
dated decision) or a research document (a dated measurement). Living summaries
are reconciled; the other two are dated.

### <a id="g-stale-number"></a>Stale-number finding

A quantity quoted in a document that was measured on code older than the
current tip, with no banner saying so. Fixed by a re-measure or by a `Dated:`
banner naming what moved.
