---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker.
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

Tickets may be **HITL** or **AFK**. HITL tickets require human interaction — an architectural decision, a design review, a manual verification step. AFK tickets can be implemented and merged without human interaction (the autonomous `/process-gh-issues` loop can grab them). Prefer AFK over HITL where possible.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Model**: the proposed implement tier — `opus` / `fable` / _(default Sonnet)_, per the complexity heuristic in step 5
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?
- Are the correct tickets marked HITL vs AFK?
- Do the proposed implement tiers look right — anything over- or under-scoped for `model:opus`?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured — the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below — one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Every edge is written **twice — the native relationship AND the body's "Blocked by" section — never one instead of the other** (see below). Apply the `ready-for-agent` triage label unless instructed otherwise — the tickets are agent-grabbable by construction.

**Wire every blocking edge natively AND in the body (GitHub tracker) — `gh issue edit <ticket> --add-blocked-by <n>,<m>`.** The two forms feed different consumers and neither substitutes for the other:

- the **native edge** is what the board, the dependency graph and the "blocked" icon show — a body-only dependency looks like ready work to a human scanning the board;
- the **body `## Blocked by` section** (one `- #NNNN` per line under the heading) is what the queue planner actually reads to defer a pick — a native-only edge gets picked by the loop and bounced.

Rules:

- Wire the edges **right after each ticket is created**, in the same pass as `--parent`, not "at the end": a batch interrupted halfway otherwise leaves every edge as prose. Include edges to tickets that already exist (closed ones too) and **implied** edges — if ticket B's acceptance criterion names a command or artefact ticket A delivers, A blocks B even when nobody wrote it.
- `gh issue edit --add-blocked-by` can exit non-zero with `failed to update 1 issue` when **some** of the listed edges already exist (REST: `Target issue has already been taken`). Never trust the exit code in either direction — read back.
- **Parity read-back is the done-condition**, for every ticket published in this pass (and every pre-existing ticket you added an edge to):

    ```sh
    for n in <tickets…>; do
      nat=$(gh api repos/{owner}/{repo}/issues/$n/dependencies/blocked_by --jq '[.[].number]|sort|join(",")')
      body=$(gh issue view $n --json body --jq .body | python3 -c 'import sys,re
    t=sys.stdin.read(); m=re.search(r"^#+\s*blocked by\s*$(.*?)(?=^#+\s|\Z)",t,re.I|re.M|re.S)
    print(",".join(sorted(set(re.findall(r"#(\d+)",m.group(1))))) if m else "")')
      [ "$nat" = "$body" ] && echo "ok  #$n [$nat]" || echo "DRIFT #$n native=[$nat] body=[$body]"
    done
    ```

    Any `DRIFT` line is fixed before reporting the tickets as published. The same parity pass applies whenever this skill touches an existing umbrella whose earlier children carry prose-only dependencies — fix them in the same pass, they are part of the graph you are publishing into.

**Wire every ticket to its parent umbrella (GitHub tracker) — `gh issue edit <ticket> --parent <umbrella>`.** When the tickets were cut from an existing issue (a PRD, a tracker, a spec umbrella), the **native sub-issue edge is mandatory, not decorative**. `/process-gh-issues` sorts its queue by `parent.number ?? number` — oldest _lineage_ first — and reads `parent` from its cheap Stage-1 list call. A ticket with no parent edge sorts on its own number, so children cut today from a PRD opened months ago land at the **back** of the queue and their umbrella never converges. (The key is the parent's _number_, not its `createdAt` — the list payload's `parent` object carries no date.) The prose `Parent: #N` line in the template below is for humans; it is not the sort key and parsing it would force a body fetch for the whole queue.

Same call closes the loop at the other end: `subIssuesSummary.completed == total` is what lets `/process-gh-issues` close the umbrella when its last child lands, instead of leaving a discharged spec open forever.

Do **not** put `ready-for-agent` on the umbrella itself — it is a spec, not a work item, and the loop skips `prd`-labelled issues by design. The children carry the label; the lineage sort carries the priority.

**Stamp the implement-model label by complexity (GitHub tracker).** `/process-gh-issues` runs each ticket's implement-subagent on the tier named by its `model:*` label, defaulting to **Sonnet** when none is present. Sonnet is safe for the bulk of work and the opus reviewer + full gate + catalogue guards catch correctness regressions — but a diff-review is weak at catching a **wrong abstraction**, so the one thing worth deciding here (where the design context is freshest) is: does this ticket set a pattern others will copy? Apply exactly one label:

- `model:opus` — the ticket introduces a **new Op / primitive / cross-layer interaction / a shape later tickets will imitate**. Design mistakes here propagate; pay for the stronger implementer.
- `model:fable` — **only** for genuinely architecture-setting work (a new subsystem, an ADR-level decision baked into code). Rare.
- **no label** (⇒ Sonnet default) — a DSL card reusing existing Ops, a localized fix, a mechanical refactor, a test addition. Don't stamp `model:sonnet` explicitly; the default already covers it, and an empty label set reads as "routine".
- If the design decision genuinely needs a **human** (not just a stronger model), that's a HITL ticket (`⚠️ HITL`), optionally `needs-design` — not a `model:*` label.

When unsure between opus and the default, prefer the default and note the ticket as one to watch — over-labeling opus erodes the cost win the routing exists for.

**Stamp exactly one `area:*` label per ticket (GitHub tracker, where the repo defines them).** The family axis the telemetry dashboard aggregates spend by: `area:cards` / `area:mechanics` / `area:ui-ux` / `area:game-bot` / `area:limited-bot` / `area:workflow` / `area:monitoring` / `area:admin` / `area:docs`. The family says WHERE in the system, never why. A card needing a new seam/keyword is `mechanics`, not `cards`.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

<local-ticket-template>

# <NN> — <Ticket title>

**Type:** HITL / AFK

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None — can start immediately".

**Target files:** module/glob-level file set this ticket touches (scheduling metadata for the processing loop, not spec). `- *` if it touches everything. Omit append-only registration points.

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

<!-- For a HITL ticket, put `⚠️ HITL` on its own line at the very top of the body; omit for AFK. The `/process-gh-issues` loop leaves ⚠️-HITL PRs for human review instead of auto-merging. -->

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket (`- #NNNN — why`, one per line), or "None — can start immediately". Every ref here MUST also exist as a native `--add-blocked-by` edge, and vice versa.

## Target files

- `path/or/glob/one`
- `path/or/glob/two`

Scheduling metadata, NOT implementation spec (exception to the no-file-paths rule above): the module/glob-level set of files this ticket will touch, used by the `/process-gh-issues` loop to batch file-disjoint tickets for parallel execution. Coarse is fine (`convex/cards/sets/ice/red.ts`, `src/components/debug/**`); staleness is acceptable — the implementing agent is not bound by it. **Omit append-only registration points** (registry index re-exports, scenario/key lists every ticket appends to) — the loop excludes them from overlap by convention. Always include this section; if the ticket genuinely touches everything (broad refactor), write `- *` so the loop schedules it solo.

</issue-template>

In either form, avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

Work the frontier one ticket at a time with `/implement`, clearing context between tickets.
