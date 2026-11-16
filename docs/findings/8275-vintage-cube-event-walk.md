---
title: Vintage Cube event walk — a full 8-seat draft against Expert Bots, played in a browser
discoveredBy: 8275
status: triaged
issue: 8275
confidence: medium
---

**Run.** 2026-11-16, local deployment, staging tip `39cb11d7a` → `a692c9d27`
(the primary checkout moved twice mid-walk; the second half ran on a static
`vite build` + `vite preview`). Desktop 1440×900 / 1920×960, Chrome over CDP,
one human seat (Test Fil) + 7 Bots, Draft · Vintage Cube · Bo3 · Expert ·
pick timer off. Deck: R/G aggro (Inti, Minsc & Boo, Chandra, Fable, Skullclamp,
Copter, burn). Result: 3-0 (Tezzeret 2-0, Sorin 2-1, Venser 2-0).

**Machine was not quiet.** Load average 15 at the start, **95** at 12:11
(another project's test run + a tolaria lane). Every timing below is
indicative only; the Bot-speed question needs a re-measure on a quiet machine.

## Ranked list

Screenshots are linked from issue #8275. Each item names the issue it was
filed as. Bands follow the owner's rule (P1 or P2 by severity, P0 only for a
blocker): S1 items and item 7 are P1, except issue #9977 (one observation, P2);
everything else is P2. Nothing blocks play, so nothing is P0.

### S1 — broken or a clear Bot blunder

1. [issue #9972] **Pass buttons stay live during a mandatory choice.** With Seasoned
   Pyromancer's "discard two" pending, Pass / Pass Turn / Pass Until Action
   (and their P / Enter hotkeys) are enabled; each press sends
   `game:passPriority`, the server answers `Illegal action (ADR 0047): the game
is waiting for choice input, not priority.` — console only, nothing on
   screen. No existing issue.
2. [issue #9864, reopened] **Bot evokes Solitude with no target — issue #9864 is not fixed at the
   root.** R2G2 T3: Sorin evoked Solitude (pitching a white card) into my empty
   board; nothing exiled, Solitude sacrificed. PR #9917 (closed #9864) keeps an
   evoke cast out of the tree _below_ the root; this was a root `cast-spell`
   decision (debug sheet). Reopen or follow up.
3. [issue #9973] **Surveil bins bombs.** Twice in round 1: Tezzeret surveiled Teferi, Hero of
   Dominaria into the graveyard T1 (Lush Portico), and Kaldra Compleat right
   after landing Basalt Monolith with Talisman + 2 Treasures up — Kaldra was
   also its Tinker target.
4. [issue #9974] **Planeswalker minus on the wrong target.** Tezzeret cast Teferi, Hero of
   Dominaria and −3'd my 1/1 Elemental token instead of Chandra, Torch of
   Defiance (5 loyalty) or Goblin Bombardment; Teferi was left on 1 and died to
   Burst Lightning.
5. [issue #9975, issue #9977] **Bot skips free attacks.** R2G2: Sorin held Figure of Destiny 4/4 +
   Nethergoyf 2/3 back against my empty board with me on 9 (6 free damage).
   Same game T2: Figure 1/1 into an empty board, no attack. R2G1: Jitte
   equipped to one Spirit, the _other_ Spirit attacked.

### S2 — confusing or wrong

6. [issue #9979] **Home "Your tables" mislabels a Limited round match** as
   "IN PROGRESS · Constructed · vs Bot" (it resumes the Limited game).
7. [issue #9976] **Deck builder opens with all 45 picks in the Maindeck and 0 basics**
   (LEGAL at 45); the human has no Auto-Build / suggest-a-deck although every
   Bot seat gets one (`convex/limited/autoBuild.ts`).
8. [issue #9980] **Priority pill says "OPPONENT TO ACT" while I choose targets** for my own
   spell/ability (Skullclamp equip, Minsc +1, Burst Lightning, Bombardment) and
   during my own mulligan prompt.
9. [issue #9995] **Surveil / library-order dialog is drag-only** — the cards are not in the
   a11y tree (`img alt=""`), no click or keyboard path
   (`src/components/board/library-order/library-order-picker.tsx`).
10. [issue #9981] **A click on a hand card while the previous action is in flight is dropped
    silently.** Under latency (land drop, then a cast) the second click does
    nothing and gives no sign; three lost land drops / casts in this walk.
11. [issue #9982] **Chandra +1 offers "Cast" for an unaffordable card** (Minsc & Boo, no G
    source); pressing it resolves as "don't cast" (2 damage) with no message.
12. [issue #9983] **Event page round card reads "— not played yet"** while the Bo3 stands 1-0.
13. [issue #9978] **Bot deck building — uncastable maindeck fatties in 4-colour piles.**
    Vraska (W/B/R/G) maindecks Blightsteel Colossus + Worldspine Wurm with no
    cheat/reanimation in the 40; Sorin (W/B/R/G aggro) maindecks Emrakul, the
    Aeons Torn next to Exhume (Emrakul shuffles itself away, so Exhume cannot
    reach it).
14. [issue #9984] **Raw Convex error toast.** At load 95, `game:announceCast` hit the 10 s
    limit and the player saw
    `[CONVEX M(game:announceCast)] … Server Error Function execution timed out
(maximum duration: 10s)`. The timeout is environmental; the message is not.

### S3 — polish

15. [issue #9985] Stack labels the reflexive "When you do…" trigger as **DELAYED TRIGGER**
    (Inti, Minsc & Boo −2). CR 603.12 has reflexive triggers follow the
    delayed-trigger rules, so the model is fine; the label conflates them
    with true delayed triggers (earthbend's return).
16. [issue #9986] Shock-land prompt copy: "If you don't, **This** land enters **the
    battlefield** tapped." (capital mid-sentence, pre-2024 wording).
17. [issue #9987] Combat damage default: a 2-power creature double-blocked by two 1/1s
    defaults to 2/0 instead of 1/1 (CR 510.1c allows 1/1). Seen twice.
18. [issue #9988] Trigger-order prompt for two independent own triggers (Gau + Goblin
    Shaman; Inti's pair) and "Arrange the cards put into your graveyard"
    (CR 404.3, issue #9554) on every multi-card discard — correct, but
    constant friction; consider an "auto-order unless it matters" setting.
19. [issue #9989] A tapped permanent in the leftmost battlefield slot rotates past the
    viewport's left edge (slot x = 12 px, rotated card wider than the slot).
20. [issue #9990] Match Over in a Limited round offers only "Back to Lobby" — it lands on
    the event page (label wrong; no "Next round").
21. [issue #9991] Player plate reads "TEST FIL (P1)" in a 1-human vs Bot match.
22. [issue #9992] Creator is not seated in the event they just created; "Start now · 8 bots
    fill in" sits next to "Join" (one click starts an event without you).
23. [issue #9993] Sideboard tiles carry the tooltip "Remove <card>" though a click adds it.
24. [issue #9994] Standings deck colours include lands' colours (a triome shows B on an RG
    deck).
25. [issue #9982] Chandra +1 prompt never names the exiled card (image only; empty "—"
    header).

## What worked

Draft (45 picks, ~1 s each, no error), pack passing, Bo3 hand-off and
sideboarding, London mulligan, adventure cast-mode chooser, Exhume picker,
earthbend, Hullbreacher replacement, Headliner Scarlett can't-block, Fireblast
alternative cost, Minsc −2 Hamster draw, trample through chump, Bot-vs-Bot
rounds resolving in the background, final standings and the public "Review
the table". The "»" debug sheet (Bot decisions) made every Bot turn
reconstructable.

## Is the Bot good enough to play against?

Mixed. It finds real tactical plays — Hullbreacher flashed in response to a
draw trigger, Solitude evoked mid-combat on my only blocker, Figure of
Destiny's attack trigger reanimating Solitude, Thopter Foundry turning
artifacts into blockers at low life. It also makes a blunder roughly every
other game (items 2–5), its draft builds 4-colour decks with uncastable
fatties (item 13), and it lost 6 of 7 games (the one win: I conceded R2G2
stuck on three lands) against a straightforward R/G aggro deck. Playable, not yet a convincing opponent at "Expert".

## Known, not re-filed

Issue #9518 (reload during a Bo3 hand-off shows Game 1's Game Over) — seen
once. Sideboarding UI notes skipped: issue #9820 redesign is in flight.

**Why it may not deserve tickets as-is.** Items 3–5 are single observations;
the Verdict/blade route (ADR 0124) wants each as a reproducible position, not
an anecdote. Item 13's colour count is inflated by lands' colours (item 24) —
the castability claim stands on the named cards alone.
