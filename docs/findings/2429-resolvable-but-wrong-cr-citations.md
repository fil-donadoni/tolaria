---
title: The CR 701 keyword-action citations are shifted by one revision — ~800 resolvable-but-wrong ids cr:lint cannot see
discoveredBy: 2429
status: draft
confidence: high
---

**What is wrong.** #2429 fixed the 44 rule ids that resolve to _nothing_. While
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

- **The whole copy-a-spell block is muddled**, two ids deep. Surfaced in the
  #2452 round-3 review.
    - **`707.10b` used for "you may choose new targets for the copy"** —
      **36 sites**, `convex/game.ts` (×3+), `convex/cards/types.ts:4042`,
      `convex/gre/state.ts:3034`, `lea/red.ts` and its tests, …
      Printed, `707.10b` is "A copy of an ability has the same **source** as the
      original ability"; the retarget permission is **`707.10c`** ("Some effects
      copy a spell or ability and state that its controller may choose new
      targets for the copy"). 12 other files already cite `707.10c` correctly,
      so the repo contradicts itself. Related: `lea/red.ts:414` cites
      `707.10c` for a "color-change to red" — `707.10c` is the retarget rule,
      and Fork's colour-change is Fork's own text, not a CR subrule at all.
    - **`707.12` used for "copy a spell"** (26 sites,
      `convex/cards/sets/c19/white.ts` and its tests, …). `707.12` is **cast** a
      copy ("An effect that instructs a player to cast a copy of an object **and
      not just copy a spell**… follows the rules for casting spells"); putting a
      copy on the stack without casting it is **`707.10`** ("a copy of a spell
      isn't cast"). Not interchangeable — a cast copy goes through 601.2a–h, so
      it triggers cast triggers, pays costs and obeys cast restrictions. Needs
      per-site classification, not a sed: a card really worded "cast a copy"
      cites `707.12` correctly.

    One instance was fixed in passing rather than recorded, because it was
    **unresolvable** and so in #2429's scope: PR #2443 landed a
    `707.10b`-slash-`707.12c` pair at four sites in
    `src/lib/__tests__/variable-target-count-integration.test.ts` — `707.12` has
    only an `a` subrule — re-pointed to `707.10c`. (This paragraph names a dead
    id and `cr:lint` stays green only because no line here carries the `CR `
    prefix — blind-spot shape 2, documented below. Add `CR ` in front of it and
    this file reds the gate. That is the trap for anyone quoting a bad id in
    prose: keep the prefix off, or the document describing the problem becomes
    one.)

Three more surfaced in the #2452 review rounds, all large enough to be their own
slice:

- **`602.5b` used as the generic "activation restrictions are enforced" cite.**
  `bun run cr 602.5b` is a **controller-change persistence** clause ("the
  restriction continues to apply to that object even if its controller
  changes") — it says nothing about enforcement. The enforcing rule is
  **`602.5`** ("A player can't begin to activate an ability that's prohibited
  from being activated"), with `602.5a` for summoning sickness and `602.5d/e`
  for "activate only as a sorcery/instant".

    **Count: 88 lines across 44 files** at the tip of #2452 —
    `git grep -c '602\.5b' -- '*.ts' '*.tsx' '*.md' ':!docs/findings'`. **86 of
    the 88 are the misuse**: grepping the same set for `controller chang|persist`
    returns nothing outside this drawer file, so there is no correct-usage subset
    to preserve. The two exceptions are not citations at all but the illustrative
    slash-list example `CR 205.4a / 602.5b / 603.3b` in `docs/adr/0098-*.md` and
    in `scripts/check-cr-citations.ts`'s header — leave those alone, and take the
    other 86 as the worklist. It spans
    `convex/gre/` (`constants.ts`, `autoTapDemands.ts`, `activationCostPicks.ts`),
    `convex/game.ts`, `convex/cards/types.ts`, `src/lib/card-utils.ts`, and most
    `convex/cards/sets/**` card headers with an activation-timing restriction.
    The seven sites this PR touched were re-pointed; the rest were left alone
    deliberately — it is the same mechanical-sed risk as the 701 block.

- **`704.5m` used for the world rule.** `704.5m` is the **Aura attachment**
  SBA ("If an Aura is attached to an illegal object or player… that Aura is put
  into its owner's graveyard"). The world rule is **`704.5k`** ("If two or more
  permanents have the supertype world…"). One id therefore carries two
  meanings in this repo, sometimes in the same file.

    **Count: 21 lines across 9 files** (not 2 — an earlier draft of this entry
    said 2, from a `sba.ts`-only glance):

    | file                                            | world-rule cites | Aura cites (correct) |
    | ----------------------------------------------- | ---------------: | -------------------: |
    | `convex/gre/sba.ts`                             |                5 |                    4 |
    | `convex/gre/state.ts`                           |                3 |                    5 |
    | `convex/gre/__tests__/serialize.test.ts`        |                2 |                    0 |
    | `convex/gre/serialize.ts`                       |                1 |                    0 |
    | `convex/cards/sets/leg/__tests__/green.test.ts` |                6 |                    0 |
    | `convex/cards/sets/leg/__tests__/black.test.ts` |                1 |                    0 |
    | `convex/cards/sets/leg/__tests__/helpers.ts`    |                1 |                    0 |
    | `convex/cards/sets/leg/black.ts`                |                1 |                    0 |
    | `convex/cards/sets/leg/green.ts`                |                1 |                    0 |

    **How to tell the two apart without line numbers** (which rot — the two this
    entry used to name were already stale by one review round): start from
    `git grep -n '704\.5m'` (65 hits repo-wide, 60 outside `data/cr`) and keep the
    hits whose subject is
    the **World supertype**, not an attachment. Mechanically that is
    `allWorldPermanents` / `checkWorldRuleSBA` and the `checkStateBasedActions`
    call site in `sba.ts`; the `worldSeq` / `nextWorldSeq` timestamp field, its
    serializer key and its round-trip tests; and the LEG World-enchantment cards
    and their tests. Everything else — `checkAuraAttachmentSBA`,
    `checkAttachmentSBA`, `attachedTo`, bestow, protection — is a genuine
    `704.5m` and must be left alone. Filtering the grep output for the word
    "world" on the SAME line finds only 16 of the 21 — five carry "world" on the
    neighbouring comment line — so do not use that as the worklist.

    Note the neighbours travel with it: the `worldSeq` sites cite
    `CR 704.5m / 613.7m`, and `613.7m` (simultaneous timestamps in APNAP order) is
    the right rule for the tie-break, so only the first id moves. Narrow enough to
    fix in passing, but it is the resolvable-but-wrong class, not the unresolvable
    one #2429 scoped.

**Evidence.** `bun run cr 701.16` → "701.16. Investigate / 701.16a 'Investigate'
means 'Create a Clue token.'" against
`convex/gre/state.ts:15068` — "CR 701.16: to sacrifice a permanent is for its
controller to put it into its owner's graveyard". `bun run cr 701.21` prints
exactly that sentence. Same pattern for every row above; each was checked by
printing both the cited rule and the intended one.

Also worth knowing what `cr:lint` does and does not reach. It is **line-based**,
and it scans a line twice: prefixed ids, then — if the line mentions `CR ` at
all — every bare `NNN.N[a-z]` token on it. #2429 found 167 occurrences of bad
ids written bare inside a slash-list ("CR 205.4a / 602.5b / 603.3b", only the
first id prefixed); that shape used to be invisible and is now covered (the
widening was the round-2 review finding on #2452 — it is what would have caught
`706.5c` and the nine `112.5` sites without a hand-rolled sweep). Two shapes are
**still** out of reach, both because `CR ` on the same line is what tells an id
from an ordinary number:

1. A citation **wrapped across two comment lines**, the prefix on one and the id
   on the next (`src/lib/ai/__tests__/flashback-exile-color.bot.test.ts` had the
   only one; it was rewritten onto a single line). Keep citations on one line.
2. An id on a line with **no `CR ` anywhere on it** — **1,795** of them at the
   tip of #2452 (drop the condition and the scan goes from 27,491 to 29,286
   citations), of which `convex/cards/mechanicsRegistry.ts` alone contributes
   **597**, its 188 `// 702.NN <Keyword>` section headers among them. All 1,795
   resolve today, and this boundary is deliberate, not an oversight: dropping
   the `CR `-on-the-line condition reds the gate on **16** ids, and what they
   are is the argument. Three are benchmark timings from CLAUDE.md's own
   happy-dom measurement (`119.35s`, `180.05s`, `113.03s`); four are bot
   numbers (the blade eval margins `−951.0` / `−135.0` in
   `gre/ai/blade/registry.ts`, `168.1` in `gre/ai/cardScriptValue.ts`, `134.3`);
   the rest are deliberate negative fixtures and the very documents — this one
   included — that quote a dead id in order to describe it. A gate that reds on
   a benchmark second is worse than one that misses a prefix-less header.

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
