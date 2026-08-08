---
title: "move to…" menu button is always visible, unlike its FeaturedCardButton sibling
discoveredBy: 1633
status: draft
confidence: low
---

**What is wrong.** `DeckCardMoveMenu` (`src/components/deckbuilder/deck-card-move-menu.tsx`,
wired at `src/components/deckbuilder/deck-card-tile.tsx:113-120`) renders its
trigger button unconditionally — `opacity-100` at every viewport and every
pointer type. Its sibling affordance on the same tile, `FeaturedCardButton`
(`src/components/lobby/deck-builder/featured-card-button.tsx:29-35`), instead
fades in only on `group-hover` (mouse) and stays invisible until then on a
desktop pointer.

**Why it's this way.** The move-to menu exists specifically for touch, where
there is no hover state to reveal a `group-hover`-only affordance — issue
#1633's whole point is that a precise drag is not a realistic touch gesture,
so the substitute has to be reachable on a plain tap without a discovery step.
Making it always-visible was the simplest way to guarantee that.

**Why it may not deserve its own issue.** It is a cosmetic tradeoff, not a
functional bug: every Maindeck tile now carries one more small always-on badge
(bottom-right corner, `size-5`) that a desktop mouse user who never needs it
still sees. A `@media (hover: hover)`-gated fade (visible for touch, hover-only
for a fine pointer) would remove the visual noise on desktop without breaking
touch reachability, but this needs a human call on whether the extra
complexity is worth it versus the AC's "verified visually on a phone-width
viewport" step already covering the touch case. Flagging rather than
resolving, since the acceptance criteria for #1633 don't ask for a desktop-only
hover treatment and the human visual-verification step (HITL) is a more
concrete place to judge whether it actually reads as clutter.
