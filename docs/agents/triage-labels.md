# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for `/next-issue` |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the agent-ready triage label"), use the corresponding label string from this table.

## The queue labels are mutually exclusive

`ready-for-agent` and `needs-triage` answer opposite questions and **must never
appear on the same issue**. `ready-for-agent` asserts the issue is executable
as written — `/next-issue` could pick it up and land it. `needs-triage` asserts a human still has to decide something
(unconfirmed repro, product call, unbounded scope). An issue carrying both
claims to be executable AND blocked, which is not a state: it lands in the
queue while reading as un-evaluated.

Rule when filing: if an agent could execute it without asking anyone, apply
**only** `ready-for-agent`; otherwise apply **only** `needs-triage`. Never hedge
by applying both. The same exclusivity holds for `needs-info` and
`ready-for-human` against `ready-for-agent` — anything that says "a human is
still involved" excludes the queue label.

Edit the right-hand column to match whatever vocabulary you actually use.

## Every new issue is stamped at filing (issue #4457)

**Every surface that creates an issue stamps it** — a skill, a script, a
session typing `gh issue create` by hand. An unstamped issue is a residue row
a human must come back to: the residue batch of issue #4202 drove 196 rows to
5 and watched 15 new ones appear within a day, each from a filing surface that
did not write what the band rule reads. Nothing below is new policy: it is
ADR 0143 and this file applied at the moment of creation instead of
retroactively.

| Field     | Rule                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `area:*`  | **Always** — exactly one of `area:admin`, `area:cards`, `area:docs`, `area:game-bot`, `area:infra`, `area:limited-bot`, `area:mechanics`, `area:monitoring`, `area:ui-ux`, `area:workflow`. |
| type      | **Always** — one of `bug` / `enhancement` / `prd` / `user-report`. A filer who cannot decide applies `needs-triage` instead, which is itself the declaration "a human must type this".      |
| band      | **Only where no prioritised parent lends one** — see below.                                                                                                                                 |
| `model:*` | **By exception only**, per § Model-routing labels escalate by exception. There is no `model:sonnet` label and none is ever created: absence IS the default.                                 |

**The band and the parent** (ADR 0143 Amendment II, issue #4371). A slice
wired under a prioritised umbrella takes its band from the umbrella, demotions
included; a `## Band` line on it orders it INSIDE the umbrella's turn and moves
the band not at all, so a slice needs none. A standalone issue — no parent, or
a parent with no board `Priority` — carries a `## Band` section in its body:

```markdown
## Band

P2 — <one-line reason>
```

`P1`-`P3` or `none — <reason>` (ruled off the road); never `P0`, which is
hand-set on the board and never written by a filer. A filer who may not rule
the band applies `needs-triage` instead. With neither, `backlog:triage`
computes the coarse label default (ADR 0143 § The write rule and the default)
and the issue is residue until a human rules it.

The stamp is two `--label` flags and, for a standalone, one body section:

```sh
gh issue create --title "…" --body "…" --label enhancement --label area:workflow --label ready-for-agent
```

Scripts stamp from their own table: `GAP_LABELS` in `scripts/lib/gap-issues.ts`
carries `enhancement` + an area on every Gap kind, and no band (every Gap
issue is parented to its band's umbrella). A script that COPIES an issue
(`prd:copy`) carries the original's labels through and adds none.

## Model-routing labels escalate by exception

**This section is the single authority on model routing, for filing AND for
pickup.** `model:opus` and `model:fable` decide whether `/next-issue` may run
an issue on the session's tier and where its review is routed; `resolveModel` in `scripts/lib/queue-plan.ts` reads the label
and nothing else. An unlabelled issue runs on the default tier (Sonnet). There
is deliberately no `model:sonnet` label — absence IS the default.

No skill restates the criterion below in its own words. A second prose copy is
drift by construction: `/next-issue` § 1 once carried an area-based list
("touches the layer system / bot search…") and it contradicted this section on
the first bot issue that reached it — the filing skill had correctly left a
blade-covered bot-search fix unlabelled, and the pickup skill stopped the
session as opus-class. A session that disagrees with an issue's label applies
the label (`gh issue edit N --add-label model:opus`) and thereby amends the
routing durably; it does not keep a private criterion.

Apply `model:opus` **only** when the failure mode is a wrong mental model no
gate catches: classification/taxonomy work (new event type, new seam, new
union member, a producer census), or semantics discovery in the LKI / layers /
copy / cast-permission core. Size is not the test — scoped engine fixes with
covering tests, bot heuristics with a blade scenario, frontend layout, and
card slices on existing Ops stay unlabelled regardless of file count. An issue
implementing an already-written ADR de-escalates: the design work is done, the
implementation defaults to Sonnet. `model:fable` is reserved for
architecture-setting work only — architecture-setting means a new ADR, a new
subsystem, or a design later issues build on; it is rare for a QA observation.

> A 2026-08-06 audit found 50% of the `ready-for-agent` queue carrying
> `model:opus` under the looser wording ("complex, high-risk, or
> wide-blast-radius"), including frontend layout work — which routed most
> implement/fixup volume to the expensive tier for no measured quality gain.
> When in doubt, leave it unlabelled: the fixup-rate dashboard is the feedback
> loop, and re-escalating one issue later is one label edit.

`model:sonnet` was retired because it said exactly what its absence already
says, so it was pure noise on every routine issue (21 open, 84 closed carried
it). `resolveModel` is generic over `model:<name>`, so re-creating the label
would work; it just would not mean anything.
