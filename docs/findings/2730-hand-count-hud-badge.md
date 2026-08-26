---
title: "Hand-count HUD badge" named in issue #2730 does not exist as a shipped component
discoveredBy: 2730
status: draft
confidence: high
---

**What is wrong.** Issue #2730's "What to build" section lists a hand-count
HUD badge alongside `MinimizedChoiceIndicator` and `BotThinkingIndicator`
("HUD badges (minimized choice pulse, bot thinking, hand count) are small
quiet chips"). No such affordance is actually rendered anywhere in the app —
it exists only as a prototype mock.

**Evidence.**

- Grepped the plausible owners: `src/components/board/board-portrait-chips.tsx`,
  `src/components/board/pile-chip.tsx`, `src/components/board/stack-chip.tsx`,
  `src/components/board/player-nameplate.tsx` — none renders a hand count.
- `grep -rln "handCount\|hand-count" src/components` returns nothing.
- The only place a hand-count HUD chip exists in the repo is the throwaway
  prototype: `tolaria-proto-identity` worktree,
  `src/components/prototype/identity/identity-dialogs.tsx:663-666`:
    ```tsx
    <div className="pp px-hud">
        <span className="p-eyebrow">Hand</span>
        <b>7</b>
    </div>
    ```
    (`prototype/identity-v4` never merges, per PRD #2721's own "Out of Scope".)

**Why this is a scope decision, not a re-skin.** Adding a NEW HUD affordance
is product surface, not a coat of paint: it needs a placement decision (where
on the board does a "your hand: 7" chip live without duplicating the
opponent-hand pile-count thumb or the player nameplate?) and a duplication
check against what already shows hand size today (the hand-zone pile
render itself, and the opponent's face-down hand count in
`board-portrait-chips.tsx`). Issue #2730 was scoped as a re-skin PR
(`process-gh-issues` implement pass) — inventing the badge's home was
explicitly called out as out of scope for this pass by the orchestrator's
brief and is recorded here instead.

**Why it may not deserve its own issue yet.** The prototype's `.px-hud`
"Hand: 7" chip may simply be illustrative filler in the `/prototype/identity`
knob-testing route rather than an intended shipped affordance — the PRD's
"What to build" prose could be listing it by association with the other two
HUD badges rather than committing to it. Worth confirming with the PRD owner
(is a standing "your hand size" HUD chip wanted, and where does it live
relative to the hand-zone pile and the nameplate?) before cutting a ticket —
if the answer is "no, the hand strip already shows it", this closes with no
further work.
