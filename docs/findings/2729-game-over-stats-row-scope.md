---
title: Game-over "moment" stats row is limited to final life — damage/cards-drawn counters need new engine tracking
discoveredBy: 2729
status: draft
confidence: medium
---

**What is wrong (or rather, deliberately incomplete).** ADR 0103's user story
26 and the `prototype/identity-v4` mock (`identity-dialogs.tsx:180-193`, the
"Modal · Game over" stage) show a stats row with three counters: damage
dealt, spells countered, cards drawn. `GameOverDialog`
(`src/components/board/game-over-dialog.tsx`) now renders a real stats row
(issue #2729), but it shows only each player's final life total —
`Player.life` (`src/types/game.ts:38`) is the one number the engine already
carries on `allPlayers` at game-over time.

**Evidence.** `GameOver` (`src/types/game.ts:583-591`) carries only
`winnerId`/`loserId`/`reason`/`isDraw` — no running counters. Building the
prototype's damage/countered-spells/cards-drawn stats would mean the engine
tracking per-game counters through `game_events` (or a new derived
aggregate) and threading them onto `GameOver` or a sibling summary object —
real GRE + wire-projection work, not a skin edit, and CLAUDE.md's own
collaboration norm is to never fabricate data the engine doesn't have.

Also skipped for the same reason: `identity-dialogs.tsx:162-165`'s art panel
(`.px-go-art`, a masked background card-art crop behind the result). There is
no existing "which card represents this game" concept to source that art
from (a deck's featured card? the last card played? undecided), so it was
left out rather than improvised.

**Why it may not deserve its own issue yet.** The stats-row AC in #2729
("game over uses TitleTreatment + OrnamentalDivider") is satisfied by the
life-total row; a richer stats row is a feature addition (new counters,
engine plumbing, wire format, a design decision on which stats matter) more
than it is "finish the skin." Worth raising as a scoped ticket only if a
human decides the extra stats are worth the counter-tracking cost — this
finding exists so that decision starts from an accurate picture instead of
rediscovering the gap from the prototype mock again.
