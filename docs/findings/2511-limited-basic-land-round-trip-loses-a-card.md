---
title: In the Limited builder, a basic land moved Pool → Maindeck → Pool disappears from the Pool
discoveredBy: 2511
status: draft
confidence: medium
---

**What is wrong.** On `/limited/<eventId>/build`, tapping a basic land in the
Pool moves it to the Maindeck (Pool 90 → 89, Maindeck 0 → 1) and tapping it
again in the Maindeck removes it from the Maindeck WITHOUT returning it to the
Pool (Maindeck 1 → 0, Pool stays 89). One card leaves the seat's Pool on every
round trip. A non-basic round-trips correctly.

**Evidence.** Measured in Chrome against the `main` tip, on the UNCHANGED
desktop layout (1440x900), so it is not a side effect of this issue's phone
work:

- Pool 89 / Maindeck 0 → tap `Nightmare` in Pool → 88 / 1 → tap it in Maindeck
  → **89 / 0** (correct).
- Pool 89 / Maindeck 0 → tap `Forest` in Pool → 88 / 1 → tap it in Maindeck →
  **88 / 0** (one Forest lost).

The asymmetry is presumably where the two "basics are special" rules meet: a
basic added from the ADD BASIC bar is a brand-new copy that is NOT
Pool-constrained (`pool-basic-lands-bar.tsx`, ADR 0054/0055 — "unlimited basic
lands added freely"), while a basic that came OUT of the Pool is. The removal
path appears to treat every Maindeck basic as the first kind. Start at
`src/components/deckbuilder/poolZoneCards.ts` (which derives the Pool zone from
the seat pool minus the deck) and `onMainCardClick` in
`src/components/deckbuilder/pool-deck-builder-form.tsx`.

**Why it may not deserve its own issue.** The visible damage is confined to a
display count on a screen where basics are unlimited anyway — the player can
re-add any number of them from the ADD BASIC bar, so nothing they can build is
actually blocked. If the seat's stored Pool is genuinely mutated (not just the
derived count), that is a data-loss bug and clearly deserves a ticket; I did not
verify which, and that check is the first thing triage should do.
