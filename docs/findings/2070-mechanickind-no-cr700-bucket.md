---
title: MechanicKind has no bucket for a CR 700.x term that isn't a real ability word
discoveredBy: 2070
status: draft
confidence: low
---

**What is wrong.** `convex/cards/mechanicsRegistry.ts`'s `MechanicKind` union
is `"keyword-ability" | "keyword-action" | "cast-rider" | "ability-word"`. The
`ability-word` variant's own doc comment restricts it to a genuine CR 207.2c
italic ability word (`bun run cr grep "ability word"` prints the closed list —
"domain", "metalcraft", etc.). Devotion (CR 700.5) is NOT on that list — it is
a plain glossary term referenced inside other cards' rules text, never an
italicized word of its own — but it earned a registry row anyway (issue #2070)
because it graduated to a real engine primitive (`SpellContext.getDevotion`)
exactly like Domain did, and there is no narrower bucket to file it under.

**Evidence.** `convex/cards/mechanicsRegistry.ts` — the `devotion` row (added
next to `domain` in `ABILITY_WORDS`) carries an explicit note admitting the
mismatch. `MechanicKind`'s doc comment (same file, ~line 72) still describes
`ability-word` as strictly CR 207.2c.

**Why it may not deserve its own issue.** One misfiled row is cosmetic — no
test cross-checks `ABILITY_WORDS` against the official CR list, so nothing is
broken today, and the row's own note documents the tension for the next
reader. It would be worth a real fix (a fifth `MechanicKind`, e.g.
`"cr-term"`, or renaming `ability-word`'s doc comment to admit the wider
scope) only once a SECOND CR 700.x-style term (not an actual ability word)
earns a row — the same extract-on-second threshold this issue already applied
to two-colour devotion.
