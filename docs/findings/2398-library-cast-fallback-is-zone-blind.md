---
title: getLegalActions' final cast branch is zone-blind, so any non-hand card reads as castable
discoveredBy: 2398
status: draft
confidence: medium
---

**What is wrong.**

`getLegalActions`' land branch scopes itself to a zone
(`convex/gre/rules.ts:660-680` — hand / graveyard-with-permission /
library-top-with-permission / exile-with-a-land-inclusive-grant), and every
cast branch above the fallback does the same (flashback scans
`player.graveyard`, madness scans `player.exile`, …). The FINAL branch does
not:

```ts
// convex/gre/rules.ts — "Cast" is for all non-land cards
if (!types.includes("Land")) {
```

There is no zone test at all. Handed a card that is neither in hand nor
covered by any grant, it reports `"cast"` as long as the printed mana cost is
payable and the timing is right.

That was harmless while every caller only ever passed hand cards (plus the
narrowly-gated graveyard/exile/library-land call sites). It stopped being
harmless the moment #2398's bot enumerator started feeding `player.library[0]`
in: with no Bolas's Citadel out, the enumerator got a `cast-spell` Move for
the top of the library, `locateCastSource` then refused to resolve it, and the
self-play harness stopped with `search-error`
(`src/lib/ai/selfplay/harness.bot.test.ts`). Fixed in #2398 by gating the
enumerator on `isCastableLibraryTopSpell` BEFORE calling `getLegalActions`
(`convex/gre/moves.ts`), i.e. at the caller rather than in the branch.

**Why it may not deserve its own issue.**

The server is already fail-closed: `announceCast` locates the card through
`locateCastSource`, which knows every real cast mechanism and returns
`{ zone: "hand", card: undefined }` for anything else — so the mutation throws
"Card not in hand" and no illegal cast can be committed. Every current caller
of `getLegalActions` either passes a hand card or gates the zone itself
(`projectGraveyardCard`, `projectExileCard`, `libraryTopPlayable`,
`enumerateMoves`). So this is a latent trap for the NEXT person who widens a
candidate set, not a live bug.

The counter-argument for fixing it: the fallback is the one branch where
"which zone is this card in?" is answerable cheaply and locally, and the fix
(`player.hand.some((c) => c.id === card.id)` in the condition) is one line.
Leaving it means every future zone-widening pays the same debugging cost —
which in this case surfaced as a self-play `search-error` three layers away
from the cause, not as a legality assertion.

Not opened as an issue: it is a hardening change with no user-visible symptom
today, and it touches the hottest predicate in the engine, so it wants a
deliberate decision rather than a drive-by.
