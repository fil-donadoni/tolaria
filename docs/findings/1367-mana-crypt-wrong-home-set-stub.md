---
title: Mana Crypt's tracked stub named the wrong home-set file/id (ADR 0041)
discoveredBy: 1367
status: draft
confidence: high
---

**What is wrong.** The pre-existing commented stub for Mana Crypt (left by an
earlier pass under PRD #620 / the #1306 residue tranche) named
`convex/cards/sets/ema/colorless.ts` and Scryfall id
`0cb33b46-4d1b-4f97-bfdc-d815aee111da` (the Eternal Masters print) as the
card's home. That id fails `scripts/check-card-index.ts`'s ADR 0041 check:
Mana Crypt's actual earliest PAPER printing is `phpr` (HarperPrism Book
Promos, a 1994 promotional insert bundled with the novel "Arena"), id
`160cf235-6463-4e16-a426-8b5be76b10d2` — confirmed by Scryfall's own
`reprint: false` flag on that print. This issue moved the `CardDefinition` to
a new `convex/cards/sets/phpr/` home-set module and left the EMA printing as
a `CardPrint` in `ema/colorless.ts` (the same fix pattern already used for
Ravenous Rats / Angel of Mercy in `p02/`, per that set's own comments).

**Evidence.** `bun run scripts/check-card-index.ts` against the ema-homed
draft reported: `Mana Crypt: uses ema 0cb33b46-…, first printed in phpr
160cf235-…`. The issue's own "Work from this investigator map" section named
the ema file/id directly, so whatever produced the original tracked stub
(likely a `/new-card` or `/new-set` pass under PRD #620) never ran the
home-set guard against it.

**Why it may not deserve its own issue.** It's already fixed as part of this
issue's diff — nothing left to do for Mana Crypt specifically. Flagging it in
case the stub-generation tooling (`/new-card`, `/new-set`) has a systematic
gap: a promo-first-printed card (book promos, judge promos, prerelease promos
predating a card's "main" set) may be silently mis-homed by whatever picks
the stub's `scryfallId`. Worth checking whether `/new-card`/`/new-set` call
`check-card-index`-equivalent logic before writing a stub, or only resolve
against the set being rolled out.
