---
name: grill
description: 'Grill the owner about a plan or design, one question per turn, until shared understanding; records terms in CONTEXT.md and hard decisions as ADRs. Use when the owner says "grill me" or the intake pipeline calls for a design interview.'
---

# /grill — the design interview

Interview the owner about every branch of the plan until you share one
understanding. Walk the decision tree, resolving dependencies between decisions
one at a time. Project skill on purpose (issue #5097): the interview that
precedes every PRD is versioned with the pipeline it feeds. The name is not
`grill-with-docs` — a machine-level skill of that name shadows a project skill.

## The interview

1. **ONE question per turn.** One decision, your **recommended answer** stated
   with it, then stop and wait. Never a batch, never a numbered round — a
   multi-question turn is bewildering and the answers cross-contaminate
   (`feedback_grill_one_step_at_a_time`).
2. **Facts are yours, decisions are the owner's.** Anything the environment can
   answer, look up first: the code (`git grep`, read the file), the rule text
   (`bun run cr <id>` — printed, never recalled, ADR 0098), the tracker
   (`gh issue view N --json number,title,body,labels,state`), `docs/adr/README.md`
   by keyword. Put to the owner only the decision that remains.
3. **Decide alone when the case is structurally equivalent to one the owner
   already confirmed** (`feedback_autonomous_when_consistent`); say so in one
   line and move on. CR-compliance is never a question — pick the CR branch
   yourself (`feedback_cr_compliance_default`). Ask only on a real fork.
4. **Stress-test with concrete scenarios.** Invent the edge case that forces a
   boundary to be stated: a card, a board, a priority window.
5. **Cross-check what the owner states against the code.** A contradiction is
   surfaced at once: "the code does X, you said Y — which is right?"
6. **Do not act on the plan until the owner confirms shared understanding.**
   No edits to code, no issue filed, no PRD written before that confirmation.
   The glossary and ADR writes below are the only exception: they record what
   was already decided.

## Domain discipline

Read `docs/agents/domain.md` for how the docs are consumed; the glossary is
`GLOSSARY.md`, the decisions are `docs/adr/` (index `docs/adr/README.md`).

- **Challenge the glossary.** The owner uses a term that conflicts with
  `GLOSSARY.md` → say so immediately and ask which meaning holds.
- **Sharpen fuzzy words.** A vague or overloaded term gets one precise
  canonical name proposed, with an `_Avoid_` line for the rivals.
- **Write resolved terms inline.** The moment a term resolves, add it to
  `GLOSSARY.md` (`feedback_update_context_md`) — not at the end, not batched.
  Format: `**Term**:` then a one-or-two-sentence definition of what it IS, then
  `_Avoid_: …`. `GLOSSARY.md` is a glossary and nothing else: no
  implementation detail, no spec, no scratch notes. Only terms specific to this
  project, never general programming vocabulary.
- **Offer an ADR sparingly** — only when ALL three hold: hard to reverse,
  surprising without context, the result of a real trade-off. Then write
  `docs/adr/NNNN-slug.md` (next number after the highest in the directory) and
  **add its row to `docs/adr/README.md` in the same change** — an ADR without
  its index row is undiscoverable (`CLAUDE.md` § Agent skills). A grammar rule
  or a one-off scope call is not an ADR.
- **Walk the code before writing the ADR** — the brief misses existing
  machinery (`feedback_walk_the_codebase_before_writing_the_adr`).
- Worktree isolation applies: a glossary or ADR edit is an authored file, so it
  goes in a worktree (`bun run wt:docs <slug>` → `bun run docs:ship`), never the
  shared checkout.

## Done

The interview ends when the owner confirms shared understanding. Hand off by
name: `/to-prd` synthesizes the grill (it does not re-interview), then
`/to-tickets` cuts the slices. State the decisions reached in a few lines so the
next skill starts from the same page.
