---
name: to-prd
description: Turn the current conversation context into a PRD and publish it to the project issue tracker. Use when user wants to create a PRD from the current context.
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can.

Check with the user that these seams match their expectations.

3. Write the PRD using the template below, then publish it to the project issue tracker as the umbrella issue. Apply the `prd` label so the umbrella is identifiable as a PRD, plus exactly one `area:*` label — the filing stamp, `docs/agents/triage-labels.md` § Every new issue is stamped at filing (`gh issue create --title "…" --body "…" --label prd --label area:workflow`). A PRD with no prioritised parent is a standalone for that rule: its `## Band` line, when the owner has ruled one, is the band its children will inherit; with none, leave it out — `prd` has no computed default and `backlog:triage` lists it for the owner (ADR 0143 § The write rule and the default). Never a queue label on the PRD (below). If the `prd` label does not yet exist in the tracker, create it first (e.g. `gh label create prd --description "Umbrella PRD issue" --color 0e8a16`).

    **Do NOT apply `ready-for-agent` to the PRD.** A PRD is a spec, not a work item: `/process-gh-issues` explicitly refuses to select `prd`-labelled issues, so the label makes the umbrella get _skipped_ on every pass forever — buying nothing, and permanently falsifying the loop's stop condition ("no more **unclaimed** `ready-for-agent` issues"). The children carry `ready-for-agent`; the umbrella carries the spec. Priority comes from the lineage sort (`parent.number`), not from a label on the parent.

    **Converting an EXISTING issue into the PRD** (it was filed as one big request and is being turned into a spec, rather than a new umbrella being opened): rewrite its body to the template, add `prd`, **remove its queue label** (`ready-for-agent` / `needs-triage`), and treat every issue already related to it — slices cut in this same pass, or children cut earlier and only referenced in prose — as children: wire each one with `gh issue edit <child> --parent <umbrella>`. A related issue that stays linked only by a body mention is invisible to the loop's lineage sort and to `subIssuesSummary`. Verify with `gh issue view <umbrella> --json subIssuesSummary` — `total` must equal the number of children. The same holds for **dependencies** between those children: every `Blocked by` / `after #N` / `requires #N` in a child's body gets its native edge (`gh issue edit <child> --add-blocked-by <n>`), and every native edge its `## Blocked by` line — run `bun run queue:lint <children…>` and fix every `dependency-parity` finding before reporting the conversion done (issue #3794; never a hand-rolled read-back — the lint compares against the planner's own parser).

4. **Hand off to `/to-tickets`, passing the PRD's issue number.** A published PRD with no children is inert — nothing in the loop decomposes it, and nobody notices it never got sliced. Tell the user the number and run `/to-tickets <N>` (or say plainly that it is the next step). `/to-tickets` is what wires each child back with `gh issue edit <child> --parent <N>` and each dependency with a native `--add-blocked-by` edge mirrored in the body; without the parent edge the slices sort by their own number and the umbrella starves at the back of the queue. Each child carries its own `## Target files` section (the `/to-tickets` template) — the umbrella does not: it is a spec, not a work item, and the planner schedules only the children.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
