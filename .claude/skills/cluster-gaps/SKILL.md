---
name: cluster-gaps
description: "Cut named Gap Clusters for one gap kind (ADR 0146): group singles by the kind's axis, write Cluster Signatures, cut one issue per family. Use when a `[Cluster] cut <kind> singles` ticket names it, or when `/new-set` Phase 3 needs its grouping rules."
argument-hint: "<kind> [Cluster Cut ticket #N]"
---

# /cluster-gaps — the judgment ADR 0146 hands off

ADR 0146 splits Gap Cluster management in two: **adoption is mechanical**
(`gaps:sync` matches a new gap against an open Cluster Signature and claims it,
`scripts/lib/gap-issues.ts`'s `matchCluster`), and **the cut is judgment** —
deciding what belongs together in the first place. This skill is the second
half. Read `docs/adr/0146-gap-clusters-are-permanent-adoption-mechanical-cut-judgment.md`
first; its terms (**Gap Cluster**, **Cluster Signature**, **Standalone Gap**,
**Absorb**, **Re-home**, **Cluster Cut ticket**) are in `GLOSSARY.md` and used
here without re-defining them.

`$1` is the kind (`grammar` / `bot` / `hand-tail` / `mechanic` / `scenario`);
`$2`, when given, is the Cluster Cut ticket number — otherwise find it (§1).

## §1 — Read the singles

The kind's ONE standing Cluster Cut ticket is the `cuts` row in
`data/grammar-gaps.json` (`{ kind, issue }` — `gaps:sync`'s own record, never
this skill's to write):

```bash
jq -r --arg k "$1" '.cuts[] | select(.kind==$k) | .issue' data/grammar-gaps.json
gh issue view <issue> --json body,title,state --jq '.body'
```

Its `## Singles` section lists every open single of this kind that no open
Cluster Signature currently absorbs and no Standalone Gap declares alone —
`- \`<key>\` — issue #<n>` per line. Read every named single's own body too
(`gh issue view <n> --json body,parent`) — its band (the umbrella it currently
sits under) matters for §4's parent choice, and a `hand-tail` single's own
listed card is what gives its set and colour.

**No standing ticket for this kind** (the `cuts` row is missing): stop and say
so — nothing has crossed `clusterCutThreshold` (`data/targets.json`) yet, so
there is nothing to cut.

## §2 — Group by the kind's axis

Five kinds, five axes — this is the only part of the judgment that is
kind-specific; §3's rules apply to whatever grouping comes out of it:

| Kind        | Axis                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grammar`   | One rule family by **slot or shared sub-grammar path** — the same slot segment, or the same clause shape across slots.                                                  |
| `bot`       | **Cause fixed** + an **Op or keyword glob** — e.g. every `never-chosen › … › …forEach…` row is one family, one per cause.                                               |
| `hand-tail` | `{ set, colour }` — the set-file colour bucket a hand-written card lives in (ADR 0043); a Hand Tail gap is one card, so its siblings are the file they'd be written in. |
| `mechanic`  | One family (the same quarantine class / keyword root), else a Standalone Gap.                                                                                           |
| `scenario`  | One family (the same quarantine class), else a Standalone Gap.                                                                                                          |

`grammar` and `bot` glob the key's `›`-joined segments (each with a space on
either side, `keyMatchesGlob` in `scripts/lib/gap-issues.ts`) — write the
`match` pattern as the segment prefix the family shares, `*` for the rest
(e.g. `never-chosen › * › *forEach*`).
`hand-tail` never globs a key: its `match` is a list of `{ set, colour }`
objects. `mechanic` / `scenario` glob the key too, but most quarantine classes
have no real family — say so and reach for §3's Standalone Gap instead of
forcing one.

## §3 — Cutting rules (shared across all five kinds)

The same three heuristics `/new-set` Phase 3 used to restate for `grammar`
alone — moved here so every kind gets them once:

- **One family, never a grab-bag.** A cluster is one rule, one cause, or one
  shared sub-grammar plus the slots that route through it — a reviewer must be
  able to read it as one design. Two unrelated singles are two clusters, not
  one with a wider glob.
- **Cap ~10 members.** Past that a landing PR is too big to review and one red
  member blocks every sibling; split by sub-form instead of widening the cap.
- **The long tail clusters by its own axis, not by nothing.** Singles with no
  real family (one card, one shape, one cause with a single occurrence so far)
  go into a **long tail** cluster keyed on the coarsest shared segment (the
  slot for `grammar`, the cause for `bot`, the set for `hand-tail`) — a few
  capped tail clusters, never one ticket each and never an unbounded grab-bag
  either.
- **Every single is covered.** Each key in `## Singles` gets exactly one
  disposition: a family cluster's `match`, the long tail's, or a Standalone
  Gap (§4). A single left uncovered is a single `/cluster-gaps` forgot, not one
  the data says is fine alone.

## §4 — Cut the cluster issues

For each family (including each long-tail bucket), one new issue — **title
`[Cluster] <kind>: <family>`, no member count** (ADR 0146 § Decision 6: a
cluster's membership is `gaps:sync`'s managed block from here on, so a count in
the title would be stale the moment it is filed). For a single that stays
truly alone, skip this step entirely — §5's Standalone Gap row points at the
single's OWN existing issue number; nothing new is created for it.

- **Labels** — the kind's own `GAP_LABELS` row (`scripts/lib/gap-issues.ts`):
  `ready-for-agent`, `enhancement`, and the kind's `area:*`
  (`area:mechanics` for `grammar`/`mechanic`/`scenario`, `area:game-bot` for
  `bot`, `area:cards` + `hand-tail` for `hand-tail`) — the filing stamp
  (`docs/agents/triage-labels.md` § Every new issue is stamped at filing).
  Any card name the body names follows the card-link convention
  (`docs/agents/issue-tracker.md` § Card names are Scryfall links;
  `bun run card:link`).
- **Parent** — the strongest band umbrella among today's members (the same
  `BAND_UMBRELLAS` / `bandUmbrellaOf` table every other gap files under,
  `scripts/lib/gap-issues.ts`). Getting this exactly right is not load-bearing:
  `gaps:sync`'s band-raise (issue #4680) moves a live cluster's parent up,
  never down, as its membership shifts on later runs.
- **Body** — the family this cluster closes and why its members belong
  together, the member keys and issues known TODAY (a starting list —
  `gaps:sync` regenerates the authoritative `## Adopted gaps` block on its next
  run per ADR 0146 § Decision 6, so do not hand-format that heading), a
  `## Target files` section naming where the fix lives, and `## Blocked by`
  when a member is itself blocked.

```bash
gh issue create --title "[Cluster] bot: never-chosen forEach" --label "ready-for-agent" --label "enhancement" --label "area:game-bot" \
  --body-file "$SCRATCHPAD/cluster-body.md" \
  --parent 4099
```

Read back `subIssuesSummary` on the parent umbrella the way `/new-set` does,
so a failed `--parent` write is caught before `land`, not after.

## §5 — Write the `clusters` rows

One row per cluster in `data/grammar-gaps.json`'s `clusters` array
(`parseClusterRows`, `scripts/lib/targets.ts`; `/cluster-gaps` is its only
author, `gaps:sync` only reads it):

```json
{ "issue": 4900, "kind": "bot", "match": ["never-chosen › * › *forEach*"] }
```

A Standalone Gap points at the single's own existing issue, matches its exact
key, and says why it is alone on purpose:

```json
{
    "issue": 4356,
    "kind": "mechanic",
    "match": ["banding"],
    "standalone": true,
    "reason": "one keyword, no sibling gap shares its class"
}
```

Run `bunx vitest run scripts/__tests__/targets.test.ts scripts/__tests__/gap-issues.test.ts`
before committing — `parseClusterRows` is fail-closed and throws on a
malformed row (unknown field, empty `match`, a Standalone Gap with more than
one key or no `reason`) rather than silently matching nothing.

## §6 — Close the Cluster Cut ticket

Comment on it naming which cluster (or Standalone Gap) each listed single
landed under, then close it: its job — deciding what belongs together — is
done. **Do not close the singles themselves.** `land` runs `gaps:sync` live
after merging this PR (`docs/agents/issue-tracker.md`), and that run is what
absorbs each listed single into its new cluster, closing it with an
`absorbed into issue #N` comment — `/cluster-gaps` only ever writes the
signature that makes the next run's absorption possible.

## §7 — Land

A worktree like any other skill (`bun run wt:new <Cluster Cut ticket #>`);
commit `data/grammar-gaps.json` plus the ticket-closing comment in the PR
description; `TOLARIA_GATE_RUN_KEY=land-<PR#> bun run gate:run land <PR#>`.
The diff is `data/**` only (`engine` lane) unless a member's own fix rides
along in the same PR — it usually should not: cutting the clusters and
implementing a member are different units of work, and bundling them means a
red member blocks the clusters that would otherwise land clean.

## Grouping-only mode — `/new-set` Phase 3

`/new-set` Phase 3 cuts Grammar Cluster tickets from `oracle:report --gaps`'s
**ranked, per-fragment** backlog — gaps that are not yet individually filed as
GitHub issues at all, so there is no Cluster Cut ticket and no `clusters`
signature to write (that backlog is unbounded and one-shot per rollout, never
re-matched by signature the way a filed single is). When `/new-set` invokes
`/cluster-gaps grammar` it is asking only for §§2–3's grouping decision over
its own ranked list, not the full §§4–6 mechanics: which fragments form one
rule family, which are the long tail, and the cap. `/new-set` still authors
its own ticket shape (member counts in the title, `## Grammar Gaps`, its
`compiles` / `corpus` figures, `to-tickets`) — that shape is specific to a
backlog `/cluster-gaps` never sees issue numbers for.
