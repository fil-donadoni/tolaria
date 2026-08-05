# Findings drawer

What a subagent noticed but was **not asked to fix**. Drafts for a human to
pre-triage — never issues, never work the loop gave itself.

```bash
bun run findings          # open drafts, highest confidence first
bun run findings --all    # including triaged and declined
```

## Why this exists

A subagent working an issue routinely trips over something adjacent: a producer
nobody enumerated, a guard that fails open, a second card carrying the same bug.
Until this drawer, that observation lived in the receipt's prose and died with
the orchestrator's context — so the same gap got rediscovered months later by a
different pass, from scratch.

## Why a subagent must not just open the issue

The loop **drains** the `ready-for-agent` queue and never fills it. An agent that
files its own work removes the one place a human sets direction, and the queue
stops being a statement of intent. So the subagent writes the draft; **you**
decide whether it becomes an issue.

The existing bar still applies: a gap earns its own issue only if it is
defensible **without** the card or ticket that surfaced it. Everything else is
either a line on an existing tracker or a `declined` with a reason.

## Why one file per finding

A tracked file that every subagent appends to produces a merge conflict on every
parallel batch — the exact reason debug scenarios stopped being a code array
(issue #1455). One file per finding lands cleanly with the PR that discovered it.

They are **tracked in git**, unlike the receipt artifacts under
`.claude/receipts/`, which are gitignored run telemetry. A finding needs to be
readable next month.

## Format

`docs/findings/<issue>-<slug>.md`

```markdown
---
title: getLegalTargets and selectTarget disagree on face-down permanents
discoveredBy: 2187
status: draft
confidence: medium
---

**What is wrong.** …

**Evidence.** `convex/gre/targeting.ts:88` filters on `card.card.types`, which is
stripped by `projectPublicState` — so the client offers a target the server then
rejects.

**Why it may not deserve its own issue.** Only one shipped card reaches this
path today; if that stays true it is a line on #1525 rather than a ticket.
```

| Field          | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| `title`        | one line, the claim itself                                        |
| `discoveredBy` | the issue whose work surfaced it                                  |
| `status`       | `draft` → `triaged` (with `issue:`) or `declined` (with a reason) |
| `confidence`   | `high` / `medium` / `low` — low is fine, silence is not           |

`status: triaged` **must** carry `issue: N`. A triaged finding with nothing
pointing at it reads as handled while nothing tracks it — the failure this drawer
exists to prevent, reintroduced one level up.

## Writing one

State what is wrong, the evidence (`file:line` beats prose), and — the part that
makes triage fast — **why it might not deserve a ticket**. A finding that argues
only one side leaves the reader to do the work the discoverer was best placed to
do.
