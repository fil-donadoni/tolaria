---
title: The library-top cast affordance carries none of the hand projection's cost hints (flash surcharge, Phyrexian split)
discoveredBy: 2398
status: draft
confidence: medium
---

**What is wrong.**

Two cast-cost hints are attached ONLY inside the hand projection
(`convex/gameProjections.ts:1137-1171`): `phyrexianOptions` (the affordable
`{C/P}` mana-vs-life splits, CR 107.4f) and `flashSurchargeRequired` (whether
this cast owes the mandatory CR 601.3c "{2} more" rider). A card projected from
the top of the library goes through `projectLibrary` → `slimCard`, which carries
neither, so `useHandCardCommit` sees `undefined` for both on a library-top cast.

Consequences, in order of how much they matter:

- **Flash surcharge.** `useHandCardCommit` reads `cardInstance.flashSurchargeRequired`
  to decide whether to open the cost dialog at all (`src/hooks/useHandCardCommit.tsx:384`).
  Off the library it is always absent, so a Rout / Twilight's Call / Saproling
  Symbiosis cast off the top during the opponent's turn is dispatched with no
  dialog and no warning, and `announceCast` then folds the {2} on anyway
  (omitted `payFlashSurcharge` means "charge me whatever the rules say"). The
  caster is surcharged silently and — the sharper half — has no way to DECLINE
  the cast, since declining is exactly what `payFlashSurcharge: false` is for.
  With the mana cost replaced by life (Bolas's Citadel) the {2} is the only mana
  the cast owes, which makes the omission more visible, not less.
- **Phyrexian split.** Inert on the replaced-cost path by construction (the mana
  cost is `{}`, so `phyrexianPipCount` is 0 and there is no split to choose), but
  it WOULD matter for a `castsSpellsFromTopOfLibrary` grant with no
  `manaCostReplacement` — Vizier of the Menagerie's shape, not yet shipped —
  where the cast pays its printed cost and a `{C/P}` pip is a real choice.

`getLegalActions`' library branch now folds the surcharge into affordability
(#2398 review round 1, finding 4), so the affordance itself is no longer offered
for a surcharge the caster cannot pay. What is missing is only the client-side
HINT and the decline.

**Evidence.**

- `convex/gameProjections.ts:1137-1171` — both fields are computed inside the
  `hand:` mapper; `projectLibrary` (`:368`) never sees them.
- `src/hooks/useHandCardCommit.tsx:384` — `flashSurcharge` derives from
  `cardInstance.flashSurchargeRequired`; `:307` — `phyrexianSplitChoices(cardInstance)`
  reads `card.phyrexianOptions`.
- Same gap applies to the graveyard cast affordance (`projectGraveyardCard`),
  which is older than #2398 — a flashback cast of a flash-surcharge card has
  never carried the hint either.

**Why it may not deserve its own issue.**

No shipped card currently combines a conditional-flash surcharge with a
top-of-library or graveyard cast permission on the same board, so nothing is
broken for a real deck today; and the fix is not one line — the honest version
hoists the two hint computations out of the hand mapper into a shared
"cast-cost hints for a card in zone Z" helper used by hand / graveyard /
library, which is a projection refactor with its own wire tests. It may be
better as a line on the projection-hygiene tracker than as a ticket of its own.
