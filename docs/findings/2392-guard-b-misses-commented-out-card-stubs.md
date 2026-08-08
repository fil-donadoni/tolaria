---
title: Two gaps in the divergence-tracking guards — Guard B's marker regex is line-initial, so a prose deferral note on a shipped card escapes it; and no guard checks that a tracking ref is still open (4 live refs name closed issues)
discoveredBy: 2392
status: draft
confidence: medium
---

**Scope correction first.** An earlier draft of this finding claimed a
commented-out card stub's `tracked-by:` ref was unenforced. That is **wrong**:
`scripts/check-stub-coverage.ts` enforces exactly that invariant, on all 120
stubs, and it runs in both `check:pr` and `check:all`
(`package.json:39` → `check:all:inner` → `check:stubs`). It walks every
contiguous comment run containing a `// export const` anchor
(`check-stub-coverage.ts:51,96-104`) and pushes an ORPHAN unless the run
carries `tracked-by: #NNN` | `#NNN` | `out of scope` | `ADR NNNN`
(`:56` `DISPOSITION`, `:106` `runHasDisposition`, `:123`). Verified by
mutation: stripping every `#NNN` and `ADR NNNN` from the Necromancy stub run
(`vis/black.ts:44-115`) yields
`✗ stub-coverage: 1 ORPHAN stub(s) — vis/black.ts:104 necromancy «Necromancy»`,
exit 1. Commented-out stubs are covered. What follows is what is left over.

## (i) Guard B's marker regex is line-initial, so a prose deferral note on a SHIPPED card is invisible to both guards

**What is wrong.** `divergenceMarkers.test.ts` (Guard B) matches only a marker
word sitting **immediately after** the `//`:
`convex/cards/__tests__/divergenceMarkers.test.ts:47-48` —
`/\/\/\s*(Deferred|DEFERRED|divergence|DIVERGENCE|not implemented|TODO)\b/i`.
A deferral written as ordinary prose — the natural way to explain, inside a
card's doc comment, that one Oracle clause is unbuilt — puts those words
mid-line, where the regex never matches. And `check-stub-coverage.ts` does not
cover the case either: it only inspects comment runs that contain a
`// export const` anchor (`:104` `if (anchorIdx.length === 0) continue;`), and
a shipped card's doc comment has none. So an **untracked divergence on an
active card** can be documented in prose and pass every gate — precisely the
hole Guard B exists to close (#962).

**Evidence — mutation on this branch, both directions.** Inserting into
`convex/cards/sets/vis/black.ts`, as its own paragraph above the _active_
`vampiricTutor` def (no `#NNN`, no `out of scope`):

```
//
// The shuffle clause here is not handled by the engine yet, and a fix
// for it has been deferred to a later batch.
export const vampiricTutor: CardDefinition = {
```

→ `divergenceMarkers.test.ts` **9 passed**, `check:stubs`
**✓ 120 commented stub(s) — all tracked**. Both green on an untracked deferral.

Positive control, same paragraph, same words, only the line-wrap moved so
`deferred` lands right after the `//` → Guard B **reds**:
`vis/black.ts:17: // deferred to a later batch.`. The anchor is the only thing
deciding it. (Both mutations reverted; `git status` clean.)

**Why it may not deserve its own issue.** Two honest counter-arguments. First,
Guard B is scoped to _divergence markers_ by name and by its own header
(`divergenceMarkers.test.ts:1-39`), which already documents the division of
labour with `check-stub-coverage.ts`; treating every prose sentence as a
marker is a scope change, not a bug fix. Second, the obvious fix is not cheap:
relaxing the anchor to match the words anywhere in a comment line fires on
ordinary prose across the whole catalogue ("this does not diverge from Oracle",
"the TODO was resolved in #NNN"), so it needs a different rule — plausibly one
keyed on a card's doc paragraph rather than a looser regex — and someone has to
absorb the resulting one-off cleanup. Third, and mitigating: the convention in
this repo is to write `// Deferred —` line-initially, so the escape is
accidental (a line-wrap away), not a pattern authors reach for.

## (ii) No guard verifies that a tracking ref is still OPEN — 4 live refs already name closed issues

**What is wrong.** Both guards are pure offline regex scans
(`check-stub-coverage.ts:56`, `divergenceMarkers.test.ts:51`). Neither queries
GitHub, by design: `check-stub-coverage.ts:27-36` says so explicitly and points
at "the ONLINE Phase-4 reconciliation in the /new-set skill" as the place
openness is checked — a skill a human runs during a set rollout, not a gate.
Repo-wide there is no other issue-state check (`grep -rl "gh issue view"` over
`scripts/` and `convex/cards/__tests__/` returns only
`scripts/__tests__/hook-policy.test.ts`, unrelated). So a stub or divergence
note whose issue is closed, renumbered, or never existed stays green forever,
and reads as tracked.

**Evidence.** Of the 97 distinct `tracked-by: #NNN` refs under
`convex/cards/sets/**` at branch tip, **4 name CLOSED issues on a live ref** —
`#925`, `#1086`, `#1097`, `#1328` — plus `#920` in a historical
"was `tracked-by`" note (`sos/multicolor.ts:260`, already marked UNBLOCKED):

- `convex/cards/sets/clb/red.ts:14` — `// tracked-by: #925` (CLOSED)
- `convex/cards/sets/inv/white.ts:20,1079,1089,1134,1142,1148,1153,1171,1179,1188`
  and `inv/multicolor.ts:3650` — `tracked-by: #1086` (CLOSED)
- `convex/cards/sets/inv/multicolor.ts:547` — `tracked-by: #1097` (CLOSED)
- `convex/cards/sets/pls/white.ts:860,894` — `tracked-by: #1328` (CLOSED)

`check:stubs` is green on all of them. Mutation confirming the mechanism:
rewriting `vis/black.ts`'s `// tracked-by: #1975` to a nonexistent
`#999999` leaves `check:stubs` and `divergenceMarkers.test.ts` both green.

**Why it may not deserve its own issue.** The offline/online split is a
deliberate design decision, not an oversight — a gate that hits the network is
slow, flaky offline, and rate-limited, and the repo already has a documented
online reconciliation step. The honest framing is therefore "the reconciliation
is manual and has drifted on 4 refs", i.e. a chore (re-point or clear those
refs) plus possibly a report-only script, not a new blocking gate. It is also
scale-bounded: 4 of 97, in three set directories (`clb/`, `inv/`, `pls/`).

**Both gaps together.** Neither is the Necromancy stub's problem — that stub is
correctly tracked by an OPEN `#1975`, and `check-stub-coverage.ts` would fail
if it were not. They are noted here because the work on #2392 was specifically
about whether a deferral note's refs can be trusted, and these are the two
places where the answer is "not automatically".
