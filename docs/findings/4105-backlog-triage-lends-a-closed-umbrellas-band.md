---
title: backlog-triage lends a CLOSED umbrella's board Priority to its children
discoveredBy: 4105
status: draft
confidence: high
---

**What is wrong.** Issue #4105 made `effectivePriority` / `bandIsInherited`
(`scripts/lib/queue-plan.ts`) treat a parent whose `state` is `CLOSED` as no
parent — a dead umbrella's board `Priority` must not govern the band its
children compete in. `scripts/lib/backlog-triage.ts` carries its **own**
reimplementation of the same "the parent governs the band" rule, citing the
same issues (#3212, #4371), and it was not covered by that change: a residue
issue whose native parent is closed as `not planned` but still sits on the
board with a stale `Priority` still gets that band lent to it.

**Evidence.** `scripts/lib/backlog-triage.ts:660-676` — `triage()` computes a
`"parent"`-source band from `seedBand(issue.parent)` / `lent(board[issue.parent])`
with no check of the parent's state; `TriageIssue.parent` is a bare
`number | null` (`:555`), never `{ number, state }`. The board map comes from
`fetchBoardPriority` (`scripts/lib/board-priority.ts`), which does not filter
by issue state, so a closed umbrella keeps its value there. The GraphQL query
that builds the field does not even request the parent's state
(`OPEN_ISSUES_QUERY`, consumed at `scripts/backlog-triage.ts:227`:
`parent: node.parent?.number ?? null`), so closing this needs a query change,
not only a type change. `scripts/__tests__/backlog-triage.test.ts` has no
closed-parent case.

**Why it may not deserve its own issue.** It is the same mechanism issue #4105
already fixed on the queue side, and the honest fix is probably not "patch the
second copy" but "delete it": one definition of the band, shared, which is why
`queue-plan.ts` exports `effectivePriority` in the first place. That may be a
line on the workflow re-order PRD #4373 rather than a ticket of its own — its
blast radius is `backlog:triage --write`, a human-run sweep, not the loop's
pick order.
