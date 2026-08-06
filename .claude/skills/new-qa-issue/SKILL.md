---
name: new-qa-issue
description: Create a structured GitHub issue from a QA observation. Explores codebase, drafts agent-readable issue with Agent Brief template, posts after confirmation. Use when user says "new issue", "file a bug", "report a bug", "request enhancement", or invokes /new-qa-issue.
argument-hint: "<description> [--type bug|enhancement]"
---

# QA Issue Creator

Create agent-readable GitHub issues from a QA observation.

## Workflow

### Step 1 — Parse input

Extract the message and optional `--type` flag (default: `bug`). Valid types: `bug`, `enhancement`.

The **queue label** (`ready-for-agent` vs `needs-triage`) is decided in Step 6, once the draft exists — the two are **mutually exclusive**, never both.

### Step 2 — Clarify if vague

If the message lacks any of these, ask targeted questions before proceeding:

- **What area** of the system is affected (GRE, cards, UI, deck builder, auth, etc.)
- **What behavior** is broken or desired (observable symptom, not implementation guess)
- **Reproducibility** (bugs only): what steps or game state trigger it

Ask at most 3 focused questions per round. Do not proceed until you have enough to write testable acceptance criteria.

### Step 3 — Explore the codebase

Read `CONTEXT.md` for domain vocabulary. Search the relevant area:

- `convex/gre/` — engine modules
- `convex/cards/` — card definitions and types
- `src/components/` — UI components
- `src/hooks/` — React hooks

Identify current behavior and key types/interfaces involved. Use domain glossary terms from `CONTEXT.md` — never drift to synonyms.

### Step 4 — Draft the issue

**Title:** max 70 characters, prefixed with `fix:` (bugs) or `feat:` (enhancements).

**Body** follows the Agent Brief template:

```markdown
## Agent Brief

**Category:** bug | enhancement
**Summary:** one-line description

**Current behavior:**
What happens now. For bugs: the broken behavior with observable symptoms.
For enhancements: the status quo the feature builds on.

**Desired behavior:**
What should happen after the fix. Be specific about edge cases.

**Key interfaces:**

- `TypeName` — what needs to change and why
- `functionName()` — current vs expected behavior

**Acceptance criteria:**

- [ ] Specific, testable criterion 1
- [ ] Specific, testable criterion 2
- [ ] `bun run check:all` and `bun run test` pass

**Out of scope:**

- What should NOT be changed
- Adjacent features that are separate

**Target files:**

- `path/or/glob`
```

**Durability rules:**

- NO file paths or line numbers in the descriptive sections — they go stale
- Exception: the **Target files** section is scheduling metadata for the processing loop's file-disjoint batching — module/glob granularity, coarse is fine, staleness acceptable, the implementing agent is not bound by it. Always include it; a change that touches everything gets `- *` (schedules solo).
- Describe types, interfaces, and behavioral contracts
- Each acceptance criterion must be independently testable

### Step 5 — Pick a model label (only to ESCALATE)

The model-routing label decides which model the implement-subagent runs on in
`/process-gh-issues`. It is an **escalation marker, not a required field**:
route by exception, and leave the common case unlabelled.

- **no label — the default.** Bounded fix or feature: few files, clear
  diagnosis, established pattern, low ambiguity. Most QA issues. The planner
  falls back to `DEFAULT_IMPL_MODEL` (Sonnet).
- `model:opus` — complex, high-risk, or wide-blast-radius: multi-module change,
  subtle CR/timing interaction, cross-cutting refactor, or acceptance criteria
  that need real judgement.
- `model:fable` — **only** architecture-setting work (new ADR, new subsystem,
  design that later issues build on). Rare for a QA observation.

There is deliberately **no `model:sonnet` label** — it was retired because it
said exactly what its absence already says, so it was pure noise on every
routine issue (21 open, 84 closed carried it). The planner's resolver is generic
over `model:<name>`, so re-creating the label would work; it just would not mean
anything.

Pick a label only if you are escalating, and carry it into the draft's label
list.

### Step 6 — Pick the queue label (exactly ONE)

`ready-for-agent` and `needs-triage` are **mutually exclusive** — never apply
both. They answer opposite questions, and an issue carrying both is a
contradiction: it claims to be executable AND to be waiting on a human.

- **`ready-for-agent`** — the draft is complete: area identified, current vs
  desired behavior stated, acceptance criteria testable, out-of-scope drawn. An
  implement-subagent could pick it up as-is. `/process-gh-issues` drains this
  queue.
- **`needs-triage`** — something still needs a human decision: the repro is
  unconfirmed, the desired behavior is a product call, the scope is unbounded,
  or a criterion can't be written without the maintainer choosing. The issue is
  a record, not a work order.

If after Step 2's clarification round the answer is still "an agent could not
execute this without asking someone", it is `needs-triage`. Otherwise it is
`ready-for-agent`. Never hedge by applying both.

### Step 7 — Confirm with user

Present the full draft (title, body, labels including the queue label and the
model label) and ask for approval. Accept edits. Do not create the issue until
the user confirms.

### Step 8 — Create the issue

Ensure the queue label exists (only the one chosen in Step 6):

```sh
gh label create needs-triage --description "Maintainer needs to evaluate" --color "FBCA04" --force
```

Create the issue — `<queue>` = **one** of `ready-for-agent` / `needs-triage`,
`<model>` = the model label from Step 5 (omit the flag entirely when not
escalating):

```sh
gh issue create --title "<title>" --body "<body>" --label "<type>" --label "<queue>" --label "model:<opus|fable>"
```

Output the issue URL.

### Step 8b — Wire the parent edge (only when the issue came out of an umbrella)

**Every issue cut from a `prd`-labelled umbrella MUST carry the native
sub-issue edge — `gh issue edit <child> --parent <umbrella>`.** This applies
whenever the observation is filed as a slice of an existing PRD, and whenever
an issue is turned INTO a PRD and its work is split out of it: the children
are wired in the same pass, never left for later.

Why it is mandatory and not decorative: `/process-gh-issues` sorts its queue
by `parent.number ?? number` — oldest **lineage** first — read from its cheap
Stage-1 list call. A child with no edge sorts on its own number, so a slice
cut today from a PRD opened months ago lands at the **back** of the queue and
its umbrella never converges. The edge is also what `subIssuesSummary` reads,
which is the only signal that lets the loop close the PRD when its last slice
lands. A prose `Parent: #N` line is documentation for humans — it is not the
sort key, and parsing it would force a body fetch for the whole queue.

Verify, don't assume — `gh issue view <umbrella> --json subIssuesSummary`
must report `total` equal to the number of children just cut.

**Only wire `--parent` to a genuine umbrella** (it carries `prd`, or holds no
implementation work of its own). When a QA issue is split out of an ordinary
WORK ticket, use `--add-blocked-by` / `--add-blocking` and leave `parent`
unset: a parent edge asserts "my children fully discharge me", which is false
for a work ticket that keeps its own scope.

## Checklist

- [ ] Title under 70 characters
- [ ] Body uses Agent Brief template
- [ ] No file paths or line numbers in body
- [ ] Domain terms match `CONTEXT.md` glossary
- [ ] Acceptance criteria are testable
- [ ] Out of scope section present
- [ ] Model label decided — **none** unless escalating (`model:opus` / `model:fable`)
- [ ] Queue label decided — **exactly one** of `ready-for-agent` / `needs-triage`, never both
- [ ] User confirmed before creation
- [ ] Labels applied: category + exactly one queue label (+ `model:*` only if escalated)
- [ ] If cut from a `prd` umbrella: `--parent` wired and `subIssuesSummary.total` verified
