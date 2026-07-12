# 0055 — Limited Event: ends at the deck, pool-as-sideboard, server-side Bot Drafter

## Status

Accepted

## Context

The engine has a solid constructed 1v1 base (Match → Games, deck chosen before
`createGame`). We are adding a Limited environment (Sealed + classic booster
Draft): an Admin creates an event, N seats fill with humans and bots, packs are
opened/drafted, decks are built, then people play. Three structural questions
had genuine alternatives.

## Decision

1. **The Limited Event ends at the built Deck.** The event covers admin setup →
   pool generation (Sealed) or synchronous pick-and-pass Draft → deckbuild →
   one Limited-legal deck per seat. It does **not** orchestrate Matches:
   participants play through the existing Match flow. Pairing, rounds, and
   standings are deferred — they can be layered on top later without touching
   the event's core.

2. **Pool = maindeck + sideboard (MTGO model).** A Limited deck carries its
   whole Pool: maindeck ≥ 40 (unlimited basic lands added freely) and every
   unplayed pool card in the sideboard, with no 15-card cap. The deck row
   references its event + seat; legality is validated by comparing the deck's
   multiset (minus basics) against the **authoritative Pool stored on the
   seat** — the client can never fabricate a pool. Sideboarding between games
   moves cards across the pool boundary and is already supported by the Match
   flow. This extends the `FORMAT_RULES` validate seam (ADR 0036) with a
   pool-scoped format instead of inventing a parallel legality system.

3. **The Bot Drafter runs server-side in Convex** — deliberately unlike the
   gameplay Bot, whose ISMCTS Brain runs client-side (ADR 0000). A pick is a
   lightweight scoring decision (Pick Rating file per set when available,
   always-present Pick Heuristic fallback sharing the Brain's Card Value,
   extracted to a server-usable module), not a search. Server-side picks are
   deterministic (seeded PRNG), have no dependency on connected clients, and
   eliminate the "which client drives the bots" race a multi-human draft would
   create. The same engine powers the Auto-Pick when a human's draft timer
   expires (never a random pick) and the end-of-event Auto-Build of bot decks,
   which are playable as vs-AI opponents — the solo draft (1 human + 7 bots)
   is a primary use case, and the study loop closes by testing your deck
   against the table's.

## Considered options

- **Event orchestrates matches too** (pairing/standings): rejected for v1 —
  large surface on `matches.ts` with no study value yet.
- **Free deck + subset check at `createGame`**: rejected — legality would live
  outside the Format system and be invisible in the deck builder.
- **Pool snapshot copied into the deck row**: rejected — client-falsifiable,
  against the server-authoritative principle.
- **Client-driven bot picks (vsAiDriver pattern)**: rejected — race with
  multiple humans, draft dies if the driving client closes the tab.
