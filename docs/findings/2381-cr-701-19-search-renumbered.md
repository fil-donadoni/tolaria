---
title: 104 sites cite "CR 701.19" for Search; the vendored CR numbers Search 701.23 and Regenerate 701.19
discoveredBy: 2381
status: declined
reason: fixed at the source instead of ticketed — `cr:lint` now checks CR
    701/702 citations against the vendored section titles
    (`scripts/cr-keyword-citations.ts`), and the sweep it forced re-pointed
    every site in this entry.
confidence: high
---

**RESOLVED.** Not by the comment sweep this entry proposed, but by option (2) of
the sibling finding: the gate learned to see the class. All 104 sites here (and
the `701.20` shuffle cluster) were re-pointed as part of landing that guard.

**What is wrong.** The whole search/tutor subsystem is annotated against an
older CR numbering. `bun run cr 701.19` prints **Regenerate**; Search is
**701.23** in the vendored document (`data/cr/VERSION.json`). Every
`CR 701.19a` / `CR 701.19c` comment therefore points at a real rule that says
something entirely unrelated to the code it annotates — the "resolvable but
wrong" blind spot CLAUDE.md names explicitly, which `bun run cr:lint` cannot
see because the id resolves.

**Evidence.** `grep -rn 'CR 701\.19' convex src scripts docs` → 104 hits.
Representative:

- `convex/gre/state.ts:2532` — `PendingChoice.isSearch` doc, "(CR 701.19a, issue #788)"; the rule it means is CR 701.23a ("To search for a card in a zone, look at all cards in that zone…").
- `convex/gre/state.ts:9313`, `:9321` — `emitLibrarySearchedEvent`, same substitution.
- `convex/gre/search.ts:564-566` and `convex/gre/ai/choicePriors.ts:58,86` — "fail to find (CR 701.19c)"; the fail-to-find rule is CR 701.23b/701.23c.
- `convex/gre/__tests__/cycling.test.ts:272` — a test NAME carrying the wrong id.
- `convex/cards/types.ts:4184` — the `isSearch` request-field doc.

Same class, different rule: `convex/cards/mechanicsRegistry.ts` describes the
trailing `libraryLook` shuffle as "CR 701.20", but 701.20 is **Reveal** —
Shuffle is **701.24**.

This PR's new card (`convex/cards/sets/wth/black.ts`) cites 701.23 / 701.13
directly from `bun run cr`, so it does not add to the count; issue #2381's own
body cites 701.19 (Search) and 701.3 (Exile) and is wrong on both.

**Why it may not deserve its own issue.** It is a pure comment sweep with no
behavioural effect, and #2429 already did one correction pass over
non-resolving ids — this is the resolvable-but-wrong residue that pass was
scoped to leave. It may be better as a line on the existing CR-citation
tracker than a ticket. Against that: 104 sites is the largest single
mis-citation cluster in the repo, it is mechanically fixable
(`701.19` → `701.23`, `701.20`(shuffle) → `701.24`) with a per-site read to
confirm the subrule letter, and every future search-related card copies the
wrong id from its neighbours.
