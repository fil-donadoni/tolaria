---
title: The attack power set never offers more than five attackers once six or more are optional
discoveredBy: 10631
status: draft
confidence: high
---

**What is wrong.** `powerSet` (`convex/gre/moves.ts`, under
`MAX_COMBINATIONS = 64`) checks its cap as `out.length + next.length <=
MAX_COMBINATIONS` while `next` is being built from `out`, so the subsets that
gain the new item stop at about half the cap instead of at the cap. With six
optional attackers it returns 48 subsets, none of size 6; with seven, 56; with
eight, 60 — and the largest declaration is five attackers in every case. The
attack enumeration (`subsets = … powerSet(optional)`) therefore never offers
the full attack on a board of six or more creatures able to attack, whatever
the position: an alpha strike that is lethal is not a candidate the search can
pick.

**Evidence.** A copy of the function run over 5…8 items (issue #10631 pass,
2026-11-23): `5 → 32 subsets, full present`; `6 → 48, full absent, max size 5`;
`7 → 56, max 5`; `8 → 60, max 5`. The blade entry "wide board, full attack:
five attackers into two blockers is lethal, any four is not (issue #10631)"
sits exactly at the edge that still works (five attackers, 32 subsets, the full
declaration is the 32nd); `MAX_COMBINATIONS = 16` reds it 0/20, which is its
one-line break. A sixth attacker on the same board would make the entry
unwinnable for the Bot today.

**Why it may not deserve its own issue.** It does: a lethal attack with six or
more creatures is a common late-game board, and no `must` entry declares more
than five attackers, so nothing guards it. The fix is the cap's arithmetic (or
an enumeration that keeps the full and near-full declarations when it
truncates, the way the exert variants keep the all-declines answer first),
plus a six-attacker `must` entry admitted by `bun run blade:probe`.
