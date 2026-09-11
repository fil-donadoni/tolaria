---
title: Kismet's "lands your opponents control" is read from the pre-move controller on a cross-player land play
discoveredBy: 3000
status: draft
confidence: medium
---

**What is wrong.** A land played out of ANOTHER player's exile under a grant
(Dauthi Voidwalker's void-countered opponent land) decides its
enters-tapped replacement (CR 614.1c / 110.5b) while the card still sits in the
owner's exile, so `shouldEnterTapped` sees the OWNER as the land's controller
rather than the player it is about to enter under. A Kismet ("Artifacts,
creatures, and lands your opponents control enter tapped") controlled by the
land's OWNER therefore fails to tap it, and a Kismet controlled by the player
PLAYING it wrongly taps it. Both directions are wrong, and the same read feeds
every other controller-sensitive entry replacement.

**Evidence.** `convex/gre/playLand.ts` — `applyPlayLandFromExile` computes
`const willEnterTapped = shouldEnterTapped(state, exileCard)` before the zone
move (and `finalizeLandEntry`'s play-source branch does the same), then
`moveCardAcrossPlayers` stamps `card.controllerId = toPlayer.id` on arrival
(issue #3000). The comment above the read is explicit that it is deliberate —
"tapped-on-entry is decided from the PRE-move board" — and the BOARD half of
that is correct (CR 616 applies replacements using the game state before the
event); it is only the ENTERING permanent's own controller that is stale, since
its controller as it enters is the player playing it, not the zone owner.

**Why the stamp was not simply moved earlier.** Stamping the controller while
the card is still in exile would break the deferred pay-choice path: a land
carrying `entersTappedUnlessPay` suspends BEFORE the move
(`enqueueLandEntryChoice`) and stays in the owner's exile for the choice window,
where a premature stamp would leave an exiled card claiming the other player as
its controller — the same field/zone inconsistency, in reverse.

**Why it may not deserve its own issue.** It needs Dauthi Voidwalker's land
grant AND a Kismet-style entry replacement on the board at once; no other
shipped pair reaches it. If that stays true it is a line on a
replacement-timing tracker rather than a ticket of its own.
