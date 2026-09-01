---
name: audit-tracker
description: Audit a roll-up / umbrella / tracker GitHub issue that enumerates missing capabilities — re-verify each listed gap against HEAD, correct the ones whose premise is wrong, grill what's left, cut one slice ticket per survivor, re-point the code's tracked-by markers and retire the tracker. Use when the user points at a tracker issue and asks "what's still missing", "what's left in #N", "split this into tickets", "is this still open", or invokes /audit-tracker <issue>.
argument-hint: "<issue-number>"
---

# Tracker Audit

`$1` is the tracker issue number (accept `#1097`, `1097`, or a URL). If it's
missing, ask for it — one question — before anything else.

A **tracker** is an issue whose body enumerates several independent gaps found
during some earlier pass ("Ten green cards hit capability gaps: 1… 2… 3…").
It is a _snapshot of a belief_, taken at a moment that has since passed. This
skill converts that stale snapshot into: a verified verdict per gap, one
self-contained ticket per survivor, and a retired tracker with no dangling
`tracked-by:` markers.

Same shape as the ordinary discuss → plan → tickets workflow, except the input
is an already-written issue instead of the user's prompt. Standing project
conventions in `.claude/skills/new-set/SKILL.md` § "What you already know"
apply here too — apply them silently, do not re-ask.

## The premise: everything in the tracker is suspect

Three independent things rot, and you must re-derive all three:

1. **The gap list** — gaps close without anyone editing the tracker.
2. **The housekeeping comments** — a "5 of 10 are now closed" comment is
   itself stale the moment another gap ships. Never trust the newest comment
   as a starting point; use it only as a hint about _where_ to look.
3. **Each gap's own premise** — the reason a card/feature was declared blocked
   is often wrong on the rules, not just out of date. Re-derive from the
   modern Scryfall Oracle text and the actual CR subrule.

Assume nothing carries over. The tracker names the _questions_, never the
_answers_.

## Phase 1 — Enumerate

`gh issue view $1 --json number,title,state,labels,body,comments`.

Produce a numbered gap list — the tracker's own numbering, extended with any
gap a comment added. Also list the "tracked elsewhere" items the tracker
disclaims, so you don't re-ticket someone else's work.

Then grep the code for the tracker's own footprint:

```
grep -rn "tracked-by:[^#]*#\?$1\|#$1" convex/ src/ scripts/ | grep -i "tracked-by"
grep -rn -B3 "tracked-by:$" convex/ src/ scripts/   # markers wrapped onto the next line
grep -rn "#$1" convex/ src/ --include='*.ts' --include='*.tsx'
```

**Never grep the bare string `"tracked-by: #$1"`.** Prettier wraps comments at
the print width, so a marker routinely lands as `// tracked-by:` / `// #1095`
across two lines and a literal-string grep silently misses it. That is a
false `shipped` verdict on a gap that is still blocked — the single most
expensive error this skill can make. In the #1095 audit the naive grep found 2
of 3 live markers, and the missing one had already caused a prior pass to
record "no marker in `red.ts` — tracked elsewhere" about a card that was in
fact still parked on the tracker being audited.

Live stubs are the **ground truth of what is still blocked** — a gap with no
surviving marker is almost certainly shipped. The third grep finds the
_closed_ gaps' landing sites (a shipped gap leaves `issue #N` in a doc comment
on the code that closed it), which is the cheapest possible proof of closure.

## Phase 2 — Verify each gap against HEAD

One verdict per gap, each anchored to `file:line`. Never "seems shipped".

| Verdict         | Means                                                    |
| --------------- | -------------------------------------------------------- |
| `shipped`       | the capability exists and a consumer uses it — name both |
| `open`          | still genuinely missing at HEAD                          |
| `narrowed`      | partly shipped; state exactly which half remains         |
| `wrong-premise` | the gap as written was never real (see Phase 3)          |

Delegate the _lookups_ — they are read-only fan-out — to `Explore` subagents
with **`model: sonnet`** (per CLAUDE.md § Subagent model routing), one per gap
or per cluster of related gaps, all spawned in **one message**. Each returns a
verdict + anchors, not file dumps. Keep the _verdicts_ on the session tier:
deciding that a half-shipped capability doesn't cover the case is the
reasoning this skill is bought with.

Run against a clean checkout of `origin/main`, and say which commit you audited
— a verdict without a commit is unreproducible.

## Phase 3 — Re-derive the premise of every survivor

For each `open` gap, before writing a ticket:

1. **Fetch the modern Oracle text** (`curl -s -H "User-Agent: tolaria/1.0"
"https://api.scryfall.com/cards/named?exact=<Name>"`). Old sets are heavily
   errata'd and the tracker may quote printed wording.
2. **Read the actual CR subrule**, don't paraphrase from memory. The current
   rules text is one download:
   `curl -s -o /tmp/cr.txt https://media.wizards.com/<...>/MagicCompRules%20<date>.txt`
   (or `/mtg-rules-check`). Grep the keyword-action section.
3. **Re-check the engine for the capability the CR text actually implies** —
   not the one the tracker's prose named. This is where `wrong-premise`
   verdicts come from, and they are common: a tracker written during
   implementation records what the author _couldn't find_, which is a weaker
   claim than "does not exist".

A `wrong-premise` gap usually collapses into a plain card ship / small task.
Say so loudly in its ticket — an implementer who believes the stale premise
will build a primitive that already exists.

## Phase 4 — Dedupe and apply the ticket bar

- **Search by MECHANISM, not by card or keyword name**
  (`feedback_search_tracker_by_mechanism`): `gh issue list --state open
--search "<mechanism words>"`. A keyword-name search misses the issue that
  already owns the gap under a different name, and you ship a duplicate.
- **Ticket bar** (`feedback_issue_vs_catalogue_line`): a gap earns its own
  issue only if it is defensible **without** the card that surfaced it. A
  single-consumer gap belongs as a line on the relevant catalogue tracker,
  not as a standalone issue.
- If a gap is already owned by an open issue, don't re-file — re-point its
  marker at that issue in Phase 7 and record the redirect in the closing
  comment.

## Phase 5 — Grill (only where a decision is actually open)

Grill **only** the survivors that still carry an unresolved design decision —
a shape choice, a scope boundary, a CR ambiguity. A gap that reduced to "ship
this card" needs no grill; a gap with a real fork (new Op vs. generalize an
existing one; where the seam goes) does.

One question per turn, with your recommended answer stated
(`feedback_grill_one_step_at_a_time`). Decide autonomously when the new case is
structurally equivalent to one already confirmed
(`feedback_autonomous_when_consistent`). For anything touching the domain model
or an ADR, use `/grill-with-docs` instead of grilling inline.

Unresolved forks are **not** a reason to withhold the ticket: write them into
the ticket's "Design questions" and label it `needs-design`.

## Phase 6 — Cut one ticket per survivor

One issue per gap — never a second bundle (that is how you got here). Each is
self-contained, because the tracker is about to be closed:

- **Title** — `[engine]` / `[card]` / `[bot]` prefix, the mechanism, the CR
  ref, and the card that surfaced it in a trailing em-dash clause.
- **Provenance** — "Split out of #<tracker> on <date>", parent PRD, origin issue.
- **The card / feature** — file, stub id, modern Oracle text quoted.
- **What already exists** — the shipped machinery with `file:line` anchors, so
  the implementer starts from the seam instead of rediscovering it.
- **The gap** — exactly what is missing, and (when a `wrong-premise` correction
  applies) what the tracker got wrong and why.
- **Sites table** — every file that must change, one row each.
- **Design questions** — the open forks from Phase 5.
- **Definition of done** — including the standing per-slice obligations
  (proof-of-failure on new tests, frontend wiring walked, debug scenario
  emitted in the PR receipt as `{ label, spec }`).
- **`## Target files`** — MANDATORY, a plain bullet list of the module/glob
  paths the slice touches, derived from the Sites table. This is not a
  duplicate: the Sites table is prose for the implementer, `## Target files` is
  **scheduling metadata** the queue planner parses (`scripts/lib/queue-plan.ts`)
  to batch file-disjoint issues in parallel. Omit it and the planner refuses to
  guess the blast radius, runs the issue SOLO, and closes the batch around it —
  measured: a single such issue at the head of the queue deferred 162 others and
  collapsed a `BATCH_CAP = 4` fan-out to one. Coarse is fine, `- *` when it
  touches everything; omit append-only registration points. A WRONG path is
  worse than a missing one (it makes two issues look disjoint when they are
  not), so widen rather than guess.

Label: `ready-for-agent` when the shape is settled, `needs-design` when Phase 5
left a real fork. Add `model:opus` only for a ticket introducing a
primitive/Op/cross-layer shape later tickets will copy — the criterion is
`docs/agents/triage-labels.md` § Model-routing labels, which is the single
authority; this line is a shorthand, not a second rule.

**Wire the native parent edge — `gh issue edit <slice> --parent <tracker>`.**
Mandatory, on every slice, at creation time. `/process-gh-issues` sorts its
queue by `parent.number ?? number` (oldest **lineage** first) and reads
`parent` from its cheap Stage-1 list call. Without the edge a slice cut today
from a tracker opened months ago sorts by _today's_ date — i.e. behind the
entire queue — so the very trackers this skill exists to drain are the ones
that starve, and each audit makes it worse by adding more children at the
bottom. The `Split out of #<tracker>` provenance line is documentation for
humans; it is **not** the sort key, and parsing it would force a body fetch for
the whole queue.

The same edge closes the loop at the other end: `subIssuesSummary` is what lets
`/process-gh-issues` close an umbrella once its last child lands. That matters
here even when Phase 7 retires the tracker — a tracker kept open as a live PRD
(the "not retired" case) is exactly the thing that otherwise rots.

**Only wire `--parent` when the tracker is a genuine umbrella** — it carries the
`prd` label, or it is being retired and holds no implementation work of its own.
When the audited issue is an ordinary WORK ticket that merely had a slice split
out of it, use `--add-blocking` / `--add-blocked-by` instead and leave `parent`
unset. A parent edge asserts "my children fully discharge me", which is false
for a ticket that still has its own code to write; the loop's auto-close reads
that assertion literally (guarded by the `prd` label on its side, but do not
lean on the far side of a contract you can honour on this one).

## Phase 7 — Retire the tracker (order matters)

Do these **in this order**. Closing first is how a marker ends up pointing at a
closed issue (issue #1841 — 10 issues, ~22 stubs).

1.  **Re-point every marker**, in a worktree (`git worktree add` +
    `bun run worktree:init`), one branch: each `// tracked-by: #<tracker>`
    becomes the new slice issue's number.
2.  **Converge the OTHER markers on the same gap.** A marker does not have to
    name the audited tracker to be this audit's business. Once a gap has a
    dedicated issue, every stub blocked on **that same gap** points at it —
    whatever it pointed at before. Two shapes, both proven in the #1095 audit:
    - **Sibling stubs under a different tracker.** For each new slice issue,
      grep the catalogue for the gap's own words, not the tracker number —
      the Oracle phrase (`"as though it had flash"`), the capability name.
      #1095's flash-surcharge gap had **five** stubs across five colour files
      pointing at **four** different issues (#1086, #1095, #1399/#1405,
      #1841); each earlier pass saw only its own colour and re-deferred, which
      is how a five-consumer engine capability stayed filed as five one-off
      card notes. Converging them is what turns the ticket bar's
      "defensible without the card that surfaced it" from a guess into a
      count.
    - **Markers pointing at an already-closed issue.** Resolve the state of
      every issue a marker cites, not just the audited one:

        ```bash
        grep -rhoE "tracked-by:? *#[0-9]+" convex/ src/ | grep -oE "[0-9]+" | sort -u
        ```

        then `gh issue view <n> --json number,state,title` per hit. A marker
        citing a CLOSED issue is dead on arrival — nobody will ever find it.
        Re-point it if this audit's tickets cover it; otherwise say so in the
        closing comment so it is not silently inherited.

    Also correct the ISSUE side: when a gap moves out of another open bundle,
    comment there saying which issue owns it now, so the bundle doesn't keep
    advertising work it no longer holds.

3.  **Correct the stub comments you proved wrong.** A `wrong-premise` stub whose
    comment still asserts the false blocker will re-block the next reader. Fix
    the prose in the same commit; it is comment-only, so it is cheap. This
    includes any prose ROLL-UP the tracker left in the file — a "Shipped: … /
    Still blocked: …" header paragraph goes just as stale as the markers under
    it, and is read first.
4.  **Run the guard**: `bunx vitest run
convex/cards/__tests__/divergenceMarkers.test.ts` (every marker paragraph must
    carry a tracking ref) plus `bun run check:pr`. Report any pre-existing red
    on `main` as pre-existing, with the culprit commit — never absorb it
    silently, never claim green you didn't see.
5.  **Open the PR**, listing the tracker → slice mapping as a table.
6.  **Close the tracker** with a comment carrying: the audited commit, the
    shipped list (with what closed each), the mapping table, and every
    `wrong-premise` correction. Close as `not planned` with a "superseded by
    #a/#b/#c" reason — the work isn't done, it moved.

## Failure modes this skill exists to prevent

| Failure                                                              | Guard                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Trusting the newest housekeeping comment                             | Phase 2 re-verifies every gap, including the ones a comment calls closed                                                    |
| Re-ticketing a gap that shipped                                      | anchors required for a `shipped` verdict — name the capability AND its consumer                                             |
| Building a primitive that already exists                             | Phase 3 re-derives from Oracle + CR, not the tracker's prose                                                                |
| Duplicate issue under a different name                               | Phase 4 searches by mechanism, not by card/keyword name                                                                     |
| Dangling `tracked-by:` at a closed issue                             | Phase 7 order: re-point, then close — and step 2 resolves the state of EVERY issue a marker cites, not just the audited one |
| A live marker missed because prettier wrapped it across two lines    | Phase 1 — never grep the literal `tracked-by: #$1`; a missed marker reads as a shipped gap                                  |
| Slices sort to the back of the queue and the audited lineage starves | Phase 6 — `gh issue edit <slice> --parent <tracker>` on every slice; `/process-gh-issues` sorts by `parent.number`          |
| The same gap left parked under three other trackers                  | Phase 7 step 2 — grep by the gap's own words and converge every stub on the new issue                                       |
| A stub comment that keeps re-blocking readers                        | Phase 7 step 3 corrects the prose in the same PR — including the file-level "Shipped / Still blocked" roll-up header        |

## Reference

- Conventions inherited: `.claude/skills/new-set/SKILL.md` § "What you already know"
- Marker rules: `.claude/rules/gre-development.md` § Guard B (documented-divergence-needs-issue)
- Related skills: `/mtg-rules-check`, `/grill-with-docs`, `/to-tickets`, `/new-qa-issue`
- Worked example: **#1097** (10 gaps → 6 shipped, 2 `wrong-premise`, 4 tickets
  #2139–#2142, markers re-pointed in #2143)
