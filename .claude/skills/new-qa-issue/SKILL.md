---
name: new-qa-issue
description: Create a structured GitHub issue from a QA observation. Explores codebase, drafts agent-readable issue with Agent Brief template, posts after confirmation. Use when user says "new issue", "file a bug", "report a bug", "request enhancement", or invokes /new-qa-issue.
argument-hint: "<description> [--type bug|enhancement]"
---

# QA Issue Creator

Create agent-readable GitHub issues from a QA observation.

## Workflow

### Step 1 — Parse input

Extract the message and optional `--type` flag (default: `bug`). Valid types: `bug`, `enhancement`. Also tag as `ready-for-agent` to make it findable by ralph.

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

### Step 5 — Confirm with user

Present the full draft (title, body, labels) and ask for approval. Accept edits. Do not create the issue until the user confirms.

### Step 6 — Create the issue

Ensure the `needs-triage` label exists:

```sh
gh label create needs-triage --description "Maintainer needs to evaluate" --color "FBCA04" --force
```

Create the issue:

```sh
gh issue create --title "<title>" --body "<body>" --label "<type>" --label "needs-triage"
```

Output the issue URL.

## Checklist

- [ ] Title under 70 characters
- [ ] Body uses Agent Brief template
- [ ] No file paths or line numbers in body
- [ ] Domain terms match `CONTEXT.md` glossary
- [ ] Acceptance criteria are testable
- [ ] Out of scope section present
- [ ] User confirmed before creation
- [ ] Labels applied: category + `needs-triage`
