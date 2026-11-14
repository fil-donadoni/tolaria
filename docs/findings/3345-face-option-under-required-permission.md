---
title: A face option under a mandatory free-cast permission is legal on the server but hidden from the Bot and the picker
discoveredBy: 3345
status: draft
confidence: medium
---

**What is wrong.** `announceCast` now asks `castPermissionRequiredFor` about the
announced subject (CR 709.3a / 715.3a), so an Adventure that is an instant on a
creature card with mana value 3 or less, under Aluren and outside its caster's
sorcery window, is accepted: the permission covers the creature, not Petty
Theft. The Bot and the client still ask the question of the printed card.
`enumerateCastMoves` (`convex/gre/moves.ts`, `permissionRequired`) drops the
whole printed pass, Adventure included. The picker
(`src/hooks/useHandCardCommit.tsx`, `permissionRestricted`) filters the
Adventure row out, because the hand projection's `printedCostCastUnavailable`
is card-level.

**Evidence.** The reviewer of PR for issue #3345 traced it. On the base tip the
cast was refused on every surface, so nothing regresses: only a legal option is
missing. A modal card's back face is the same case, under a permission covering
the back face and not the front.

**Why it may not deserve its own issue.** The Bot's half is a small change: a
per-option `castPermissionRequiredFor` skip already exists in the
independent-options loop, so the card-level drop could exempt face options.
The picker's half needs a per-face answer from the server, which is a new
projection field. Whether one shipped Adventure card reaches this under Aluren
decides if it is worth that field.
