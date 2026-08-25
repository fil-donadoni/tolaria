---
title: No non-stack engine path pays a sacrificeFilter/discardFilter mana cost, and 8 compiled cards read `ready` on that shape
discoveredBy: 2697
status: draft
confidence: high
---

**What is wrong.** The activated-ability slot's shared cost grammar (#2697)
lowers `"Sacrifice a creature: Add {C}{C}"` to
`{ cost: { sacrificeFilter: { types: ["Creature"] } }, useStack: false }` — the
CR-faithful reading (CR 605.1a: no target, could add mana, not a loyalty
ability, no library movement; CR 605.3a: therefore not on the stack). **The
engine has no non-stack path that pays that cost.** The lockfile marks 8 cards
`ready` on this shape, so the compiler's strongest verdict is currently claimed
for definitions the engine could not run as written.

**Evidence — the two non-stack entry points.**

- `getManaTapOptionsDetailed` (`convex/gre/constants.ts:1296`) skips any
  `useStack: false` ability that has neither `cost.tap` nor `cost.sacrifice`.
  A `sacrificeFilter`-only or `discardFilter`-only cost matches neither, so the
  ability is never offered as a mana-tap option.
- `activateManaAbility` (`convex/game.ts:15179-15189`) throws
  `"Use tapUntap for tap mana abilities"` when `cost.tap || cost.sacrifice` —
  and for everything else its cost payment covers exactly `cost.mana` and
  `cost.tapOtherFilter` (`convex/game.ts:15205-15236`). There is no
  `sacrificeFilter` step and no `discardFilter` step. So the four filter-only
  shapes below are not merely inert: the mutation ACCEPTS them, resolves the
  ability, and adds the mana **without the sacrifice or discard ever being
  paid**.
- The `sacrificeFilter` / `discardFilter` payment machinery exists only on the
  STACK activation path — `activateAbilityOnState`
  (`convex/game.ts:14075-14113`), `buildPendingActivation`
  (`convex/game.ts:2941`), `finalizeTargetSelection`
  (`convex/game.ts:6420-6497`) — i.e. behind `useStack: true`.

**Evidence — the 8 `ready` cards** (`data/oracle-compiled.json`, this branch):

| Card                 | Compiled cost                                     | Reaches a mana path?                       |
| -------------------- | ------------------------------------------------- | ------------------------------------------ |
| Ashnod's Altar       | `{ sacrificeFilter: {types:["Creature"]} }`       | no — cost never paid (free mana)           |
| Krark-Clan Ironworks | `{ sacrificeFilter: {types:["Artifact"]} }`       | no — cost never paid (free mana)           |
| Skirk Prospector     | `{ sacrificeFilter: {subtypes:["Goblin"]} }`      | no — cost never paid (free mana)           |
| Skirge Familiar      | `{ discardFilter: {filter:{},count:1} }`          | no — cost never paid (free mana)           |
| Phyrexian Tower      | `{ tap, sacrificeFilter: {types:["Creature"]} }`  | tap gate passes; filter payment unverified |
| Krark-Clan Stoker    | `{ tap, sacrificeFilter: {types:["Artifact"]} }`  | tap gate passes; filter payment unverified |
| Bog Witch            | `{ mana:{B:1}, tap, discardFilter: {…,count:1} }` | tap gate passes; filter payment unverified |
| Overeager Apprentice | `{ discardFilter: {…,count:1}, sacrifice: true }` | sacrifice gate passes; payment unverified  |

The catalogue's only shipped precedent for the tap-legged half is Orcish
Lumberjack (`convex/cards/sets/ice/red.ts:1954`,
`{ tap: true, sacrificeFilter: { subtypes: "Forest" } }`, `useStack: false`),
and it has **no engine test anywhere** — grep for it outside its own set file
returns only `vintageCubeNames.ts`. So the four bottom rows are "reaches the
gate", not "verified payable".

**The catalogue already knows.** `convex/cards/sets/atq/red.ts:163-180` carries
a box comment deviating Ashnod's Altar and Priest of Yawgmoth to
`useStack: true` **for this exact reason** ("the engine's instant mana-ability
path (`tapUntap`) has no choice step"), accepting the known cost that their mana
is unavailable mid-cast. Any pass that "fixes" those two cards to
`useStack: false` before the engine gap closes turns a documented, bounded
deviation into free mana.

**What `ready` means, and why that matters here.** `ready` is a
COMPILER-FIDELITY state: the Oracle text was read whole, every op is registered,
and the emitted definition passes the gates in `convex/oracle/gates.ts`. It has
never asserted that a live engine path can activate the result — the compiler
does not import the engine's activation code and no gate consults it. These 8
cards are the first place where the two readings visibly diverge, because the
compiler is now emitting a CR-faithful shape the engine predates. Two ways out,
both larger than #2697: teach the non-stack mana path to pay filter costs (which
also retires the atq deviation and gives Orcish Lumberjack its first test), or
add an ENGINE-CAPABILITY gate to `gates.ts` that demotes a shape no activation
path accepts, making `ready` mean both things at once.

**Why it may not deserve its own issue.** The gap is pre-existing — it predates
the compiler, which only made it countable — and nothing regresses by leaving it:
the lockfile is a compiler artefact that nothing registers into the catalogue
yet, so no shipped card changes behaviour. What argues for a ticket: "free mana"
is the worst class of silent divergence, it already blocks a headline Tier-1
card (Skirk Prospector) from ever being registered as compiled, and closing it
would retire a standing catalogue deviation and cover a shipped, untested card.
