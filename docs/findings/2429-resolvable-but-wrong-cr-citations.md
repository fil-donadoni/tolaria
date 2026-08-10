---
title: The CR 701 keyword-action citations are shifted by one revision — ~800 resolvable-but-wrong ids cr:lint cannot see
discoveredBy: 2429
status: draft
confidence: high
---

**What is wrong.** #2429 fixed the 42 rule ids that resolve to _nothing_. While
printing the replacements it surfaced a much larger, structurally different
class: ids that **resolve fine and point at the wrong rule**. `bun run cr:lint`
is blind to these by construction — it only asks whether the id exists — so the
gate this issue just added does not cover them.

The bulk of it is the **CR 701 keyword-action block**, whose entries have been
renumbered as Wizards inserted new keyword actions (Behold, Create, Double,
Triple, Goad, Investigate…). This repo's citations were written against an
older numbering and are now consistently off by four or five:

| cited  | this repo means it as | 2026-08-07 CR says `701.N` is | correct id            | occurrences |
| ------ | --------------------- | ----------------------------- | --------------------- | ----------: |
| 701.7  | Destroy               | Create                        | 701.8                 |        ~129 |
| 701.8  | Discard               | Destroy                       | 701.9                 |        ~162 |
| 701.10 | Return/bounce         | Double                        | — (no keyword action) |         ~41 |
| 701.15 | Regenerate            | Goad                          | 701.19                |        ~156 |
| 701.16 | Sacrifice             | Investigate                   | 701.21                |        ~159 |
| 701.19 | Search                | Regenerate                    | 701.23                |        ~100 |
| 701.20 | Reveal / Shuffle      | Reveal                        | 701.20 ✓ / 701.24     |        ~260 |
| 701.24 | Return to hand        | Shuffle                       | — (no keyword action) |         ~35 |
| 701.26 | Tap                   | Tap and Untap ✓               | 701.26 ✓              |         ~50 |

(Counts are `git grep` hits for `CR ?<id>`, so they over-count slightly — the
shape is what matters, not the last digit.)

The tell that this is a real shift rather than coincidence: the SAME repo cites
`701.16a` correctly for Investigate ("create a Clue token",
`convex/cards/abilities/tokens/clueToken.ts:1`) **and** `701.16` for Sacrifice
150+ times. Two incompatible meanings for one id, in one codebase.

Three smaller, unrelated instances of the same class:

- **`702.14b` used for Fear** (5 sites, `convex/cards/sets/inv/multicolor.ts:655`,
  `pls/black.ts:763`, …). `702.14b` is "Landwalk is an evasion ability"; Fear is
  **`702.36`**.
- **`702.35c` used for Madness's discard→exile replacement** (14 sites,
  `convex/gre/madness.ts:73`, `convex/gre/serialize.ts:433`,
  `convex/gre/state.ts:17421`, …). `702.35c` is the "effects referencing the
  discarded card can find it" rule; the replacement is in **`702.35a`**.
- **`702.88c` used for "declining Rebound leaves the card exiled"** (18 sites,
  `convex/gre/rebound.ts:56`, `convex/game.ts:11864`, `convex/gre/moves.ts:166`,
  …). `702.88c` is "Multiple instances of rebound are redundant"; the claim is a
  consequence of **`702.88a`** and has no rule of its own.

Two more surfaced in the #2452 review round, both large enough to be their own
slice:

- **`602.5b` used as the generic "activation restrictions are enforced" cite**
  (~85 sites, repo-wide: `convex/gre/constants.ts:1037`, `convex/game.ts:1629`,
  `src/lib/card-utils.ts:1594`, `convex/cards/types.ts:1257`, most `sets/**`
  card headers…). `bun run cr 602.5b` is a **controller-change persistence**
  clause ("the restriction continues to apply to that object even if its
  controller changes") — it says nothing about enforcement. The enforcing rule
  is **`602.5`** ("A player can't begin to activate an ability that's
  prohibited from being activated"), with `602.5a` for summoning sickness and
  `602.5d/e` for "activate only as a sorcery/instant". The seven sites this PR
  touched were re-pointed; the rest were left alone deliberately — it is the
  same ~85-site mechanical-sed risk as the 701 block.
- **`704.5m` used for the world rule** (2 sites, `convex/gre/sba.ts:746` and
  `:835`). `704.5m` is the **Aura** attachment SBA — which the same file also
  cites correctly at `:489`, so one id carries two meanings here. The world
  rule is **`704.5k`**. Narrow enough to fix in passing, but it is the
  resolvable-but-wrong class, not the unresolvable one #2429 scoped.

**Evidence.** `bun run cr 701.16` → "701.16. Investigate / 701.16a 'Investigate'
means 'Create a Clue token.'" against
`convex/gre/state.ts:15068` — "CR 701.16: to sacrifice a permanent is for its
controller to put it into its owner's graveyard". `bun run cr 701.21` prints
exactly that sentence. Same pattern for every row above; each was checked by
printing both the cited rule and the intended one.

Also worth knowing: `cr:lint` is **line-based and requires the `CR ` prefix**.
#2429 found 167 occurrences of the bad ids written bare inside a slash-list
("CR 205.4a / 602.5b / 603.3b" — only the first id carries the prefix) or
wrapped across two comment lines
(`src/lib/ai/__tests__/flashback-exile-color.bot.test.ts:47-48`), all invisible
to the sweep. They were fixed by hand; the blind spot remains.

**Why it may not deserve its own issue.** Two arguments against ticketing it as
written:

1. It is ~800 comment edits with no behaviour change, and the value is entirely
   "the next reader lands on the right rule". That is real but diffuse, and a
   mechanical sed over 800 sites re-runs exactly the risk #2429 was created to
   stop — a plausible-but-wrong number that now passes the linter too.
2. A cheaper fix may exist upstream: teach `cr:lint` (or a companion) to check
   the citation against the **section title** when the comment names a keyword
   action ("CR 701.16 sacrifice" → 701.16 is titled "Investigate" → flag). That
   turns ~800 hand edits into a guard that catches the class and the next
   revision's shift too, and would have caught all three of the 702.x cases
   above as well.

If it is ticketed, (2) is the shape worth grilling first; (1) alone is a large
diff whose correctness nobody can review at that volume.
