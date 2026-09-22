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
- [ ] `area:game-bot` only: `Blade: <expected position and move | none — <why>>`

**Out of scope:**

- What should NOT be changed
- Adjacent features that are separate

## Cards

- Card Name

## Target files

- `path/or/glob`
```

**Durability rules:**

- NO file paths or line numbers in the descriptive sections — they go stale
- Exception: the **Target files** section is scheduling metadata for the processing loop's file-disjoint batching — module/glob granularity, coarse is fine, staleness acceptable, the implementing agent is not bound by it. Always include it; a change that touches everything gets `- *` (schedules solo). It is the one section written as a `## Target files` HEADING, not as a bold label: the planner reads a bold `**Target files:**` too (issue #3535), but the heading is canonical and is what the queue lint's fix hint names.
- **`## Cards` only when the issue is ABOUT specific cards** (issue #4086) — a
  bug a card shows, an enhancement a card waits on: one lockfile card name per
  list item, no prose. It is what `backlog:triage` bands the issue by
  (`docs/agents/issue-tracker.md` § `## Cards`), so a card cited as an EXAMPLE
  or a test case never goes here — omit the section when no card is the
  subject.
- **Card names are Scryfall links** (`docs/agents/issue-tracker.md` § Card names are Scryfall links): every card name in the body —
  never the title — is the link `bun run card:link "<Card Name>"` prints;
  paste it, never build the URL by hand. Fenced code and the `## Cards` items
  stay bare. `bun run queue:lint` flags a miss as `unlinked-card-name`.
- Describe types, interfaces, and behavioral contracts
- Each acceptance criterion must be independently testable
- **`area:game-bot` issues carry a mandatory `Blade:` acceptance line**
  (issue #2688) — the area is picked in Step 5b, after this draft exists, so
  add it retroactively once the area is known: `Blade: <expected position
and move | none — <why>>`, declaring whether this issue is expected to add
  or change a blade entry (`.claude/rules/bot-development.md`, `/bot-slice`)
  or deliberately carries none.

### Step 5 — Pick a model label (only to ESCALATE)

The model-routing label is an **escalation marker, not a required field**:
route by exception, and leave the common case unlabelled — the planner falls
back to `DEFAULT_IMPL_MODEL` (Sonnet), and `/next-issue` runs an unlabelled
issue on whatever tier its session has.

**Apply the criterion in `docs/agents/triage-labels.md` § Model-routing labels
verbatim — that section is the single authority and this step does not restate
it.** In one line: escalate only when the failure mode is a wrong mental model
no gate catches; size, file count and "it touches the engine" are not the test,
and a frozen ADR de-escalates.

Pick a label only if you are escalating, and carry it into the draft's label
list.

### Step 5b — Pick the area label (exactly ONE, mandatory)

Every issue carries exactly one `area:*` label — it is the family axis the
telemetry dashboard aggregates time/token spend by. The family says **WHERE in
the system**, never why (there is deliberately no `area:optimizations` — a
perf fix on the bot is `area:game-bot`):

`area:cards` (card slices on existing Ops, set rollouts) · `area:mechanics`
(keywords, CR, engine seams, layers, LKI, new DSL/Ops) · `area:ui-ux` ·
`area:game-bot` (Brain/ISMCTS/evaluate/moves/driver) · `area:limited-bot`
(botDrafter, pick ratings, draft engine) · `area:workflow` (loop, skills,
gates, hooks, queue, merge-train) · `area:monitoring` (telemetry, dashboards,
scorecard) · `area:admin` (auth, profiles, deck management, matchmaking,
Convex infra) · `area:docs`.

Boundary rule: a card needing a new seam/keyword is `mechanics`, not `cards`.

**`area:game-bot`** additionally requires going back to the Step 4 draft and
adding the mandatory `Blade:` acceptance-criteria line (see Step 4).

### Step 6 — Pick the queue label (exactly ONE)

`ready-for-agent` and `needs-triage` are **mutually exclusive** — never apply
both. They answer opposite questions, and an issue carrying both is a
contradiction: it claims to be executable AND to be waiting on a human.

- **`ready-for-agent`** — the draft is complete: area identified, current vs
  desired behavior stated, acceptance criteria testable, out-of-scope drawn. A
  session could pick it up as-is. `/next-issue` drains this queue.
- **`needs-triage`** — something still needs a human decision: the repro is
  unconfirmed, the desired behavior is a product call, the scope is unbounded,
  or a criterion can't be written without the maintainer choosing. The issue is
  a record, not a work order.

If after Step 2's clarification round the answer is still "an agent could not
execute this without asking someone", it is `needs-triage`. Otherwise it is
`ready-for-agent`. Never hedge by applying both.

### Step 6b — Decide the board Priority (P0/P1/P2)

**The board offers a fourth band, `P3`, and this step does NOT seed it**
(issue #4051). `P3` is a maintainer's ruling — "I looked at this and it goes
last" — and a seed is by definition not one: a fresh QA issue nobody has
ranked belongs in the unprioritized residue, which is where it lands with no
value set. Only an explicit `P3` in the user's own message (rule 1 below)
reaches the board from here.

The GitHub Project board's `Priority` single-select (Project #2) is what
`queue:plan` sorts on as its zeroth key
(`docs/agents/issue-tracker.md` § Why the queue is sorted the way it is) — an
issue with no value there sorts on the default heuristic (bug label, lineage,
number), behind everything a human has actually flagged. This step seeds a
STARTING value so a fresh QA issue does not silently fall to the bottom of a
200+-item queue; it is a seed, not a lock — the maintainer's own edit on the
board still overrides it at any time, exactly as before.

1. **Explicit wins.** If the user's own message names a priority — `P0`/`P1`/
   `P2`/`P3` literally, or an unambiguous severity word (`critico`/`blocca tutto`/
   `crash`/`urgente` → P0; `minore`/`cosmetico`/`nice to have` → P2) — use it
   verbatim. Never override an explicit request with the heuristic below.
2. **Otherwise, infer from the drafted Agent Brief:**
    - **P0** — crashes or freezes a game, an uncaught server error, data
      corruption, a security issue, or anything breaking the core play loop
      for every user hitting the affected path (not just one card/one edge
      case).
    - **P1** — the default for a real, reproducible, scoped bug or
      enhancement that does not halt the app. Most QA issues land here.
    - **P2** — cosmetic/minor UX, a low-value enhancement, or an edge case
      with an easy workaround.
3. State the chosen priority and a one-line reason alongside the draft in
   Step 7, so the user can correct it before creation — this is a proposal,
   not a silent write.

### Step 7 — Confirm with user

Present the full draft (title, body, labels including the queue label and the
model label, and the Step 6b priority + its one-line reason) and ask for
approval. Accept edits — including a priority override. Do not create the
issue until the user confirms.

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

Why it is mandatory and not decorative: the queue planner sorts its queue
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

### Step 8b′ — Wire blocking edges natively AND in the body (whenever there is a dependency)

**A dependency is not declared until it exists twice — as a native GitHub
edge and as a `## Blocked by` section in the body.** Applies whenever the draft
names one (`blocked by #N`, `after #N`, `requires #N`, `depends on #N`), when
the new issue must land before an existing one, and when a dependency is only
**implied** (an acceptance criterion names a command or artefact another open
issue delivers). The two forms feed different consumers and neither substitutes
for the other:

- the **native edge** (`gh issue edit <n> --add-blocked-by <m>` /
  `--add-blocking <m>`) is what the board, the dependency graph and the
  "blocked" icon show — a body-only dependency looks like ready work to a human
  scanning the board;
- the **body section** (a `## Blocked by` heading, one `- #NNNN — why` per
  line) is what the queue planner reads to defer a pick — a native-only edge is
  picked by the loop and bounced.

When the new issue BLOCKS an existing one, the existing issue's body gains the
`## Blocked by` line too — edit it in the same pass.

`--add-blocked-by` can exit non-zero with `failed to update 1 issue` when some
of the listed edges already exist; never trust the exit code in either
direction. **Parity read-back is the done-condition**, over the new issue and
every issue whose edges this step touched:

```sh
bun run queue:lint <issues…>
```

Its `dependency-parity` finding names each side's missing refs and the exact
one-line fix (issue #3794). Fix every one before reporting the issue created.
When the new issue joins a `prd` umbrella, pass the umbrella's other open
children in the same call: a sibling carrying prose-only edges is part of the
graph this issue was just published into.

**Never hand-roll this read-back.** The shell loop that used to live here
matched the `## Blocked by` section only, so it reported parity on a body whose
inline `depends on #N` the planner already read as a blocker; `queue:lint`
compares against the planner's OWN parser.

### Step 8c — Apply the Step 6b Priority to the board

Add the new issue to the board and set its `Priority` to the value decided (or
corrected) in Step 6b/7 — `<owner>`/`<project>` default to `fil-donadoni`/`2`
(override with `TOLARIA_PROJECT_OWNER`/`TOLARIA_PROJECT_NUMBER`, matching
`scripts/queue-plan.ts`), `<priority>` is one of `P0`/`P1`/`P2`/`P3`:

```sh
gh project item-add <project> --owner <owner> --url <issue-url>
gh project item-edit <project> --owner <owner> --url <issue-url> --field Priority --value <priority>
```

This is a convenience seed, not a gate: if either command fails (missing
`project` scope, a transient API error), do NOT fail the issue creation over
it — the issue already exists and is queued correctly by its labels
regardless of Priority. Print the two commands above with the real URL/value
filled in so the user (or a later session) can run them by hand, same
degrade-with-an-escape-hatch shape as the board READ in
`scripts/lib/board-priority.ts`. A missing `project` write scope is fixed with
`gh auth refresh -s project`.

## Checklist

- [ ] Title under 70 characters
- [ ] Body uses Agent Brief template
- [ ] No file paths or line numbers in body
- [ ] Domain terms match `CONTEXT.md` glossary
- [ ] Acceptance criteria are testable
- [ ] Out of scope section present
- [ ] Model label decided — **none** unless escalating (`model:opus` / `model:fable`)
- [ ] If `area:game-bot`: acceptance criteria include the `Blade:` line
- [ ] Queue label decided — **exactly one** of `ready-for-agent` / `needs-triage`, never both
- [ ] Board Priority decided (explicit from the user, else severity heuristic) and shown for confirmation
- [ ] User confirmed before creation
- [ ] Labels applied: category + exactly one queue label (+ `model:*` only if escalated)
- [ ] If cut from a `prd` umbrella: `--parent` wired and `subIssuesSummary.total` verified
- [ ] Every dependency (explicit or implied) wired natively AND as a `## Blocked by` body line, parity read-back shows no `DRIFT`
- [ ] Board Priority applied (`item-add` + `item-edit`), or the fallback commands printed if it failed
