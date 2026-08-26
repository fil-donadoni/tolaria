---
title: CR 608.2b is cited repo-wide for "the referenced object is gone", which is CR 609.3
discoveredBy: 2297
status: draft
confidence: medium
---

**What is wrong.** A recurring comment in the DSL layer explains an Op that
does nothing because the permanent it names has left the battlefield as
"CR 608.2b — the spell does as much as it can". CR 608.2b is about **targets**:
it says a resolving spell or ability re-checks the legality of its ANNOUNCED
targets and does not resolve at all if every target is illegal. The rule that
actually says "does as much as possible" is **CR 609.3** ("If an effect
attempts to do something impossible, it does only as much as possible"), and it
is the one that applies to a `{ ref: "$source" }` reference, which is not a
target at all. The two rules also have different consequences — 608.2b removes
the whole ability from the stack, 609.3 lets the rest of the script run — so
the citation is not merely imprecise, it points at the opposite behaviour for a
mixed script.

**Evidence.** `bun run cr 608.2b` and `bun run cr 609.3` print the two texts.
Sites: `convex/cards/types.ts:11995`, `:12015`, `:12091`, `:12881`, `:13844`
(the `pump` / `counters` / `tapUntap` / `regenerate` / … Op docs, all reading
"Skipped when the referenced permanent is gone (CR 608.2b — the spell does as
much as it can)"), plus `convex/gre/ai/blade/registry.ts:1213` (issue #2490's
note, "the Ops that read it skip in turn (CR 608.2b)"). Two further sites in
that file (`:1556`, `:2150`) cite 608.2b for a genuinely TARGET-legality case
and are correct — this is not a blanket rename.

**Why it may not deserve its own issue.** `cr:lint` cannot see it: the ids all
resolve, and the title-matching second scan covers only CR 701/702 keyword
sections, so this is exactly the "resolvable but wrong" class CLAUDE.md already
records as uncovered. It is comment-only — no behaviour depends on it — and the
correction is a handful of one-line edits that any pass touching those Ops can
make in passing. It is a line on the CR-citation-hygiene work (#2429's
successor) rather than a ticket of its own. Recorded because the wrong citation
propagates: this pass nearly copied it into four new files.
