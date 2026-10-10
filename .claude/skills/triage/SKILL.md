---
name: triage
description: Move GitHub issues through the triage roles — categorise, verify, grill, write the agent brief, label for the queue.
disable-model-invocation: true
---

# /triage — issue state machine

Move issues through the triage roles. Tracker: GitHub Issues via `gh`
(`docs/agents/issue-tracker.md`). Label strings, queue exclusivity, area/type
stamp, band and model routing: `docs/agents/triage-labels.md` — the single
authority; this skill restates none of it.

Qualify every reference in output: `issue #NNN` / `PR #NNN`.

## Reference docs

- [AGENT-BRIEF.md](AGENT-BRIEF.md) — how to write the brief that makes an issue `ready-for-agent`
- [OUT-OF-SCOPE.md](OUT-OF-SCOPE.md) — how `.out-of-scope/` records rejected enhancements

## Roles

Category (one per issue): `bug`, `enhancement` (also `prd`, `user-report` per
`triage-labels.md`).

State (one per issue): `needs-triage`, `needs-info`, `ready-for-agent`
(executable by `/next-ticket` as written), `ready-for-human`, `wontfix`.

An unlabeled issue goes to `needs-triage` first; from there to any other state.
`needs-info` returns to `needs-triage` once the reporter replies. State roles
that conflict on one issue (e.g. `ready-for-agent` + `needs-triage`): flag it
and ask before anything else. The owner can override any transition — flag the
unusual ones and confirm.

## Invocation

The owner describes what they want in natural language:

- "show me anything that needs my attention"
- "let's look at #42"
- "move #42 to ready-for-agent"
- "what's ready for agents?"

## Show what needs attention

Query with `gh issue list` and present three buckets, each ordered by the
default work order below:

1. **Unlabeled** — never triaged.
2. **`needs-triage`** — evaluation pending.
3. **`needs-info` with reporter activity since the last triage notes.**

Counts and a one-line summary per item; let the owner pick.

## Default work order (no issue named)

Do not ask which issue to start with. Pick: `bug` first, then everything else;
tiebreak oldest `createdAt`. State the pick and why in one line, then go
straight into the next section.

## Triage a specific issue

1. **Gather context.** Read the issue whole (`gh issue view N --comments`,
   labels, parent, blockers). Parse prior triage notes — never re-ask a
   resolved question. Terms: `GLOSSARY.md`; decisions: `docs/adr/README.md` by
   keyword. Two checks: (a) **redundancy** — search the code by domain concept,
   not the request's wording, for an existing implementation; report where you
   looked; found → already-implemented `wontfix`. (b) **prior rejection** —
   read `.out-of-scope/*.md`, surface any that resembles the request.

2. **Recommend.** Category + state with reasoning, and a short codebase summary.
   Wait for direction.

3. **Verify the claim.** For a bug, reproduce it from the reporter's steps
   (targeted `bunx vitest run <path>`, or `bun run cr <id>` for a rules claim —
   never recall CR text). Report: confirmed (with code path), failed, or
   insufficient detail (a strong `needs-info` signal). A confirmed repro makes a
   much stronger brief.

4. **Grill if needed.** Run `/grill` — one question per turn, terms into
   `GLOSSARY.md`, hard decisions as ADRs.

5. **Apply the outcome** (read the worktree rule first — `.out-of-scope/` and
   ADR files are authored files, never written in the shared checkout):
    - `ready-for-agent` — post an agent brief comment (AGENT-BRIEF.md). Apply the
      stamp from `triage-labels.md` (`area:*`, type, `## Band` only if no
      prioritised parent, `model:*` only by its exception rule). Remove
      `needs-triage`.
      The brief ends with `## Target files` (scheduling metadata for the
      queue's file-disjoint batching: module/glob granularity, `- *` for
      everything; a HEADING, not a bold label) and, only when specific cards are
      the subject, `## Cards`. **Card names are Scryfall links**
      (`docs/agents/issue-tracker.md` § Card names are Scryfall links): paste
      what `bun run card:link "<Card Name>"` prints, never build the URL by hand.
      Shape and durability rules: `/create-ticket` Step 4. `bun run queue:lint`
      checks the result.
    - `ready-for-human` — same structure, plus why it cannot be delegated.
    - `needs-info` — post triage notes (template below).
    - `wontfix` — close with a comment, by reason:
        - **Already implemented**: point to where it lives; do not write
          `.out-of-scope/`.
        - **Rejected bug**: polite explanation, close.
        - **Rejected enhancement**: write `.out-of-scope/` (OUT-OF-SCOPE.md), link
          it from the comment, close.
    - `needs-triage` — apply the role; optional comment on partial progress.
    - **Turned into a PRD / umbrella** — too big for one work item: label `prd`,
      **remove** the queue role (a PRD is a spec; an AFK-ready label makes the
      loop skip it forever), then wire every slice per the rule below.

### Slices of a PRD are native sub-issues, always

Every issue cut from an umbrella carries the native parent edge — `gh issue edit
<child> --parent <umbrella>` — wired in the same pass that creates it, never
back-wired. Both directions: an existing issue turned INTO a PRD, and new
slices cut from an existing one.

It is scheduling: `queue:plan` sorts by `parent.number ?? number` (oldest
lineage first), and `subIssuesSummary` is the only signal that lets the loop
close the umbrella. A prose `Parent: #N` line is documentation, not the sort key.

Verify: `gh issue view <umbrella> --json subIssuesSummary` reports `total` equal
to the children just cut. Slice order and blocked-by edges: `/to-tickets`.

Only wire `--parent` to a genuine umbrella (`prd`, or one with no work of its
own). A slice split out of an ordinary WORK ticket uses `--add-blocked-by` /
`--add-blocking`, parent unset. Never cut a slice blocked on another slice
unless the blocking edge is recorded — describe it in the PRD body and cut it
when its blockers land.

## Quick state override

"Move #42 to ready-for-agent": trust the owner. Confirm what you are about to do
(labels, comment, close), then act; skip grilling. For `ready-for-agent` without
a grilling session, ask whether to write an agent brief.

## Needs-info template

```markdown
## Triage Notes

**What we've established so far:**

- point 1
- point 2

**What we still need from you (@reporter):**

- question 1
- question 2
```

Everything resolved during grilling goes under "established so far". Questions
are specific and actionable, never "please provide more info".

## Resuming a previous session

If triage notes exist, read them, check whether the reporter answered, present
the updated picture before continuing. Never re-ask resolved questions.
