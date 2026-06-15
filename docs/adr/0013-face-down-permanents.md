# ADR 0013 — Face-down permanents with hidden identity (Illusionary Mask)

**Status:** Accepted (2026-06-14)

## Context

**Illusionary Mask** (Alpha):

> {X}: You may choose a creature card in your hand whose mana cost could be paid
> by some amount of, or all of, the mana you spent on {X}. If you do, you may
> cast that card face down as a 2/2 creature spell without paying its mana cost.
> If the creature that spell becomes as it resolves has not been turned face up
> and would assign or deal damage, be dealt damage, or become tapped, instead
> it's turned face up…

This is the only face-down / morph-style card in Alpha. It needs infrastructure
the engine does not have, and one piece of it — **hidden identity on the
battlefield** — breaks a standing assumption: that the battlefield is fully
public information. That makes it the most invasive single change in the LEA
completion effort, touching the network projection boundary.

We chose to build the **full** face-down infrastructure (hidden identity
included) rather than a lossy visible-identity approximation, because the
hidden information _is_ the card.

## Decision

Four pieces:

### 1. Face-down permanent (CR 708)

A transient `faceDown?` marker on the instance. A read-time characteristic
override presents a face-down creature as a **2/2 colourless vanilla Creature**
with no name and no abilities (CR 708.2), regardless of the real card
underneath. The true `cardId` is retained on the instance for the turn-up.

### 2. Hidden identity in the projection

`projectPublicState` gains a battlefield branch: a face-down permanent **not
controlled by the viewer** is projected with a generic face-down placeholder
identity; the **controller** sees the real id (they know what they cast). This
is the first time battlefield identity is filtered per viewer — the
**Projection** glossary entry and the "battlefield is public" assumption are
updated accordingly.

### 3. Cast face-down without paying mana

A cast path on Illusionary Mask's activated ability: spend {X}, choose an
eligible creature card from hand (mana cost payable by some or all of the X
spent), and put it onto the stack as a face-down 2/2 creature spell that pays
no mana cost. It resolves into a face-down permanent.

### 4. Turn face up (reuse the replacement engine)

`replacements.ts` already exists ([CR 614/616] damage / life / discard /
lose-game). "If it would deal or be dealt damage… instead it's turned face up"
is a replacement and hooks that engine: the face-down permanent is turned up
(clear `faceDown`, reveal the real card), then the original event proceeds
against the now-real creature. The **"would become tapped"** trigger needs a
new tap replacement-event kind, which this work adds.

(Note: the CLAUDE.md "replacement effects out of scope" line is **stale** —
`replacements.ts` has shipped. That doc should be corrected.)

## Rationale

1. **Hidden information is the card.** A visible-identity face-down 2/2 would
   be a different, weaker card. The whole point is the opponent not knowing
   what they are blocking or burning.
2. **Reuse the replacement engine** for damage turn-up rather than inventing a
   parallel mechanism; only the tap-event kind is genuinely new.
3. **Isolate the invasive bit.** Hidden battlefield identity is a single,
   well-defined projection branch plus a read-time override — bounded, even if
   conceptually large. Building it now means any future morph card is cheap.
4. **Scheduled last and alone.** Of the planned LEA features this is the
   highest-risk; it ships on its own so its projection changes are reviewed in
   isolation.

## Consequences

- New transient `faceDown` marker + retained true id on the instance;
  serialize key + round-trip test.
- Read-time characteristic override yielding a 2/2 colourless vanilla creature.
- `projectPublicState` filters battlefield identity per viewer for face-down
  permanents — **the public-battlefield assumption now has one documented
  exception.**
- A face-down cast path keyed to the {X} spent.
- A new tap replacement-event kind in `replacements.ts`; damage turn-up reuses
  the existing loop.
- Illusionary Mask moves from commented stub to active definition.
- CLAUDE.md "replacement effects out of scope" corrected.

## Out of scope

- General morph / megamorph / disguise (face-up cost, turn-up cost). Illusionary
  Mask turns up only via the damage/tap replacement, never by paying a cost.
- Face-down non-creatures, or multiple distinct face-down kinds — Alpha has
  exactly one face-down source.
- Hiding any battlefield information other than a face-down permanent's
  identity. Everything else on the battlefield stays public.
