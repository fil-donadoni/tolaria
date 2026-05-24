# ADR 0003 — Auto-resolve trivial player choices (Arena-style UX)

**Status:** Accepted (2026-05-24)

## Context

When a card effect requires a player to select N items from an eligible set
(targets, discards, untap picks under Winter Orb / Smoke, sacrifice picks,
etc.), the engine can either:

1. Always show a prompt whenever a choice is rule-mandated (even if the
   outcome is forced).
2. Auto-resolve when there is no real choice — i.e. the eligible set size is
   ≤ the required selection count.

The Comprehensive Rules technically allow the player to "choose" in both
cases (CR 700.1, 701.39 etc. — the player makes the choice even when only one
option exists). MTG Arena resolves these automatically to streamline the
common case.

## Decision

**Adopt Arena-style auto-resolve.** When the eligible set has 0 items, skip
the prompt entirely (no decision possible). When the eligible set size equals
or is below the required selection count and there is no legal "skip" branch
that the player might tactically prefer, auto-resolve to the forced outcome.

Examples:

- "Discard a card" with 0 cards in hand → no prompt; effect resolves with 0
  discards.
- "Discard 2 cards" with ≤ 2 cards in hand → discard all without prompting.
- "Discard 2 cards" with 3+ cards → prompt (real choice exists).
- Winter Orb (cap 1 land) with 0 tapped lands → no prompt; with 1+ tapped
  lands → prompt (player may legitimately choose to skip the untap, CR
  502.1 / 701.39 — "can't untap more than one" is a cap, not an obligation).
- Smoke analogous to Winter Orb for creatures.

The cap-style restrictions (Winter Orb, Smoke) keep the prompt even with a
single eligible permanent because "untap zero" is a tactical choice the
player must be able to declare. Effects without a tactical zero-branch (forced
discards, sacrifices) auto-resolve when the set is fully forced.

## Consequences

- New `PendingChoice` instances must compute eligibility before enqueueing.
  If `eligibleSet.length === 0` and no tactical zero-branch, no prompt is
  enqueued and the engine proceeds.
- Tests must cover both "real choice" and "auto-resolved" branches.
- When in doubt about whether a tactical zero-branch exists, fall back to
  prompting — false prompts are recoverable, false auto-resolves silently
  remove agency.
