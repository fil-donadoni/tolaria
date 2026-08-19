---
title: src/lib/deckViewPrefs.ts's Grouping/Ordering are still a live, un-deduplicated alias of convex/deckLayout.ts
discoveredBy: 2560
status: draft
confidence: medium
---

**What is wrong.** `src/lib/deckViewPrefs.ts`'s `GROUPINGS`/`Grouping` and
`ORDERINGS`/`Ordering` declared a `tracked-by: #1618` disposition, reasoning
"ADR 0075's `convex/deckLayout.ts` … does not exist as of issue #1620 … once
that module ships, this alias should move there and be re-exported from
here." Both #1618 and #1620 have since shipped, and `convex/deckLayout.ts`
now exists with the canonical `GroupingKind`/`OrderingKind` vocabulary — but
the migration described in the comment was never actually done:
`deckViewPrefs.ts` still declares its own local `Grouping`/`Ordering` types
with the identical string-literal vocabulary (`"mv" | "color" | "type" |
"none"` / `"name" | "mv" | "color" | "rarity"`), rather than importing from
`convex/deckLayout.ts`.

**Evidence.** `convex/deckLayout.ts:34` (`GroupingKind`) and `:37`
(`OrderingKind`) vs. `src/lib/deckViewPrefs.ts`'s own `GROUPINGS`/`ORDERINGS`
consts a few lines below the comment. `deckViewPrefs.ts:42` even names
`convex/deckLayout.ts` as the existing bridge point for a DIFFERENT type
(`DeckZone`'s doc comment), confirming the module is already imported/known
about elsewhere in the same file's neighborhood, just not for this pair.

**Why it surfaced now.** Issue #2560's liveness sweep (`bun run
markers:lint`) resolves `tracked-by:` dispositions against `gh`, and #1618
is CLOSED — so the marker was rotten. Fixing it meant rewriting the comment,
and since no open issue currently tracks the migration itself (#1618 and
#1620 are both closed/shipped) it was left as an explicit, untracked note
rather than a `tracked-by:` naming a closed issue, or an invented one.

**Why it may not deserve its own issue.** This is a pure internal dedup
(two string-literal unions with identical members, zero runtime risk) —
nothing currently reads the wrong one or drifts silently, since both are
hand-kept in sync by inspection today. It only earns a ticket once someone
is about to touch either union and would benefit from one source of truth,
or if a THIRD copy of the same vocabulary shows up elsewhere (the actual
"stop duplicating" trigger per CLAUDE.md's primitive-reuse discipline).
