---
title: The descriptor grammar knows creature and land subtypes only, so "Aura spells" and "Equipment spells" are unreadable
discoveredBy: 3268
status: draft
confidence: medium
---

**What is wrong.** `convex/oracle/grammar/shared/subtypes.ts` supplies
`CREATURE_SUBTYPES` and `LAND_SUBTYPES` and nothing else, so the descriptor
grammar refuses every artifact and enchantment subtype noun. That is invisible
while the grammar reads permanents by type ("artifact spells" works), and
becomes a refusal the moment a frame names a subtype class.

**Evidence.** Issue #3268's `cast-permission` frame refuses three corpus
sentences for exactly this reason and no other: Sigarda's Aid ("You may cast
Aura and Equipment spells as though they had flash."), Rootwater Shaman ("Aura
spells with enchant creature" — which has a second, real reason too) and
Keeper of the Secret Lair ("Secret Lair spells"). The refusal reads
`"Aura" is not an adjective this grammar knows`, which is accurate and
uninformative: the word IS a CR 205.3 subtype, just not one this vocabulary
carries. The cost-modifier frame has the same blind spot for the same reason
("Equipment spells you cast cost {1} less to cast").

**Why it may not deserve its own issue.** The subtype lists are hand-vendored
and the artifact/enchantment sets are small and stable (Aura, Equipment,
Curse, Vehicle, Saga, Shrine, Fortification, Class, Room, …), so this is
plausibly a data addition rather than a design question — a line on PRD #2693's
vocabulary work. It is worth checking first whether widening the noun set
changes any EXISTING parse: `Aura` and `Saga` are also creature-adjacent words
in card names, and the descriptor's uniqueness requirement turns a newly
ambiguous split into a refusal rather than a misread.
