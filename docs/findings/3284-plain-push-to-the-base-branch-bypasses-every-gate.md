---
title: deny-guard blocks only FORCE-pushes to the base branch, so a plain `git push origin staging` bypasses every gate
discoveredBy: 3284
status: draft
confidence: high
---

**What is wrong.** The enabler of the RED base tip issue #3284 repaired was not
the field name — it was that commit `18a0d25f8` reached `staging` with one parent
and no PR, so **no gate ever ran on it**. Its subject carries no `(#NNNN)`, the
signature `land` leaves.

`.claude/hooks/deny-guard.sh` § 2 denies a **force**-push to the base/release
branch. A plain `git push origin staging` is allowed, from every directory. So the
whole merge protocol — `land`'s rebase, `check:lane` under the machine mutex,
merge through the API, the one-commit advance check — is opt-in by habit.

**Evidence.** `18a0d25f8` ("feat(cards): update Aluren oracle text for clarity")
edited `convex/cards/sets/tmp/green.ts` and `docs/qa-issues.md`, landed on
`staging`, and left four tests red across two files
(`scripts/__tests__/catalogue-artifact.test.ts` ×3,
`src/components/board/__tests__/hand-card-cast-permission-picker.test.tsx` ×1).
Both reds are inside `check:pr`, so `land` would have refused it.

**Why this is the stronger fix.** #3284's class guard closes the next instance of
that particular field being mis-edited. This closes the next instance of ANY
ungated change reaching the base branch, whatever the field or file — and
CLAUDE.md's own rule points straight at it: "A rule that CAN be enforced
mechanically belongs in a script the gate runs (`scripts/queue-plan.ts`,
`scripts/gate.ts`, hooks) — prose is the fallback for judgment, not the home of
invariants."

**Shape of the fix.** Widen § 2 from force-push-only to any `git push` whose
refspec resolves to the base or release branch, with the same per-command escape
hatch the sibling rules use (`land` already sets one for the merge). The base
branch moves through `land` and `release`, and both are scripts.

**Why it may not deserve its own issue.** It is a one-person repository and the
push was the maintainer's own; a hook that refuses it may be friction where none
is wanted. Against that: this session lost a full merge attempt plus two ~12-minute
gate rounds to it, the diagnosis needed a detached worktree at the tip to
establish the red was not the feature branch's, and the durable RED marker never
fired because no health run had reached that tip either.
