# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Always qualify a reference: `issue #NNN` / `PR #NNN`

Issues and pull requests share one number space, and agent output interleaves
them constantly — "landed #2992, closes #2376, blocked by #1524" is one PR and
two issues, indistinguishable without opening all three. The kind is known at
the moment of writing and is simply not written down.

So in **agent output and every artifact this repo generates** — terminal lines,
commit messages, receipts, the gate's own waiter and reclaim lines — a
reference names its kind: `issue #2999`, `PR #2997`. The one exemption is a
bare `#NNN` inside a GitHub issue or PR body, where the platform itself renders
a type badge and a hovercard; nothing in a terminal or a log does.

The convention is the same class of rule as a CR citation: mechanical, and
worth a lint over the artifacts this repo generates once enough of them follow
it. Until then it is a habit, and a reference you have not qualified is one the
next reader has to look up.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Why the queue is sorted the way it is

**The planner computes this — you do not.** `scripts/lib/queue-plan.ts` owns the sort, the two-stage fetch, the dependency scan, and the disjointness walk; `bun run queue:plan` prints the result (`/next-issue` consumes it with `--cap 1`). What follows is the _rationale_, so a future reader does not "simplify" a key that looks arbitrary. It is not instructions to re-derive the query by hand.

**Why the board field is the ZEROTH key, and why it is not a label.** Every key below it — `bug`, lineage, number — is a _default_: a reasonable guess for issues nobody has ruled on, which is nearly all of them. What the defaults cannot express is the criterion of the moment ("this week, the deckbuilder"), because that criterion changes faster than the queue drains. Writing it onto the issues is the trap: a per-issue priority label means every change of mind is an edit to hundreds of issues, so in practice it is set once and rots. The board's `Priority` field is read at PICK time instead — the maintainer flags the few that matter now, the planner applies it, and next week's re-think costs a few clicks, not a migration. That is also why `P2` beats an unprioritized `bug`: the ordering below the line is a heuristic, and an explicit human judgment outranks a heuristic every time. It is not a label for the same reason it is not a score — an axis with 265 values that a human maintains by hand is an axis that stops being true.

**Reading the board degrades before it hard-stops (issue #2520).** The board read is a GraphQL call over a 400+-item board, and `gh` has a SEPARATE, much tighter GraphQL budget than REST — with several sessions draining the queue in parallel, that budget was measured gone within the hour (`graphql: {limit: 5000, remaining: 29}` while `core` sat at `{remaining: 4994}`), and the planner's only response used to be a hard stop. Every successful read is now cached to `.claude/telemetry/board-priority.json` (gitignored) with its fetch time. Three outcomes, kept deliberately distinct because conflating any two of them is the failure mode:

- **Fresh cache** (inside a few-minute TTL) — reused with **no GraphQL call at all**. The TTL governs only this: whether the fetch is SKIPPED.
- **Stale-but-present cache, used ONLY after a live read fails with a rate-limit-shaped error** — the plan is built from it regardless of how old it is (the TTL does not gate fallback usability, only the skip-the-fetch decision), and the fallback announces itself loudly with the snapshot's age: `⚠ board unread (GraphQL rate limit); using the priority snapshot from 3m ago`. A snapshot minutes (or hours) old is enormously better than both a stopped loop and a silently unprioritized one.
- **No usable snapshot at all** — the ORIGINAL hard stop is unchanged: `queue:plan` exits non-zero rather than plan without the priorities. A batch ordered on stale DEFAULTS (no maintainer override applied at all) looks exactly like a correct one while implementing four issues in the wrong order, with nothing red anywhere — the same silent-subset class that already cost this loop two incidents (`index("bug")` falsy at position 0; `gh issue list --limit 60` hiding 126 issues).

A NON-rate-limit failure (a permission error, a query shape change, an unranked `Priority` value) is never papered over by a cache, however fresh — only an error shaped like `rate limit` degrades; everything else still hard-stops immediately.

**The read asks for the `Priority` field alone, not for the board.** It is one `gh api graphql --paginate` query, not `gh project item-list`, which requests every field value of every item. Measured 2026-09-07 against a 705-item board, both forms producing a byte-identical 351-entry map: **766 points versus 8**, against a pool of 5000 per HOUR shared by every session and script on the machine. The old read afforded 6.5 board reads an hour in total; the account reached `graphql 0/5000` with REST untouched at `5000/5000`, and `loop:status` reported every `gh`-backed section UNAVAILABLE at once. Two consequences worth knowing before "simplifying" the query back:

- **No owner-type lookup.** `gh project` first resolves whether the owner is a user or an organization; rate-limit that call and it reports `unknown owner type`, which reads as a configuration error and sends the investigation to `gh auth status`. The query's inline fragment on `ProjectV2Owner` covers both kinds at once.
- **No window to size, and no newest-first truncation.** `item-list --limit N` returns the N **newest** items when the board holds more, so the limit had to be sized from a separate `project view` `totalCount`, with headroom, plus a guard for the board growing between the two calls (issue #2520 round 2). Cursor pagination has neither failure mode: pages are walked to completion and the last page's `hasNextPage` says exactly whether anything is outstanding. `gh api graphql --paginate` keys that walk to a variable named exactly `$endCursor` — rename it and the read silently returns page one, i.e. the newest 100 items, with no error anywhere.

`--no-priority` is the deliberate escape and announces itself on stderr, untouched by any of the above. Where each half lives: the READ (the query, the completeness guard) is `scripts/lib/board-priority.ts`, shared with the dashboard's queue reader (#2519) so the two cannot drift; the CACHE and the degrade-vs-hard-stop policy are `scripts/queue-plan.ts`, because that policy is this command's, not the board reader's.

**The loop authenticates as YOU, not as the app.** `.env.local` carries `GITHUB_TOKEN` — the narrow app-scoped PAT `convex/bugReports.ts` uses to file issues from the client — and bun auto-loads that file into `process.env` for every script, so `gh` preferred it over the keyring and the whole loop was quietly running as the bug-report integration. `scripts/queue-plan.ts` strips `GITHUB_TOKEN` before invoking `gh`, leaving `GH_TOKEN` (gh's own variable, the documented CI override) intact. Do not "fix" a project-permission error by widening the app token: it ships to a server-side Convex action, and the board is none of its business.

**Why the lineage and not the issue.** A child inherits its parent's queue position, not its own creation date. Without this, every spec umbrella starves: a PRD opened in July gets its slice tickets cut in August, those sort behind the entire queue, and the PRD never converges — while each fresh audit makes it worse by adding more children at the bottom. Sorting on the parent drains lineages in the order the _work_ was commissioned: all of the oldest PRD's children, then the next PRD's, and so on.

**Sort on the parent's NUMBER, not its `createdAt`.** Issue numbers are monotonic in creation time, so the number is an exact proxy — and it is the only one available: `gh issue list --json parent` returns `{id, number, state, title, url}` and **no `createdAt`**, so a `parent.createdAt` key silently falls back to the child's own date and the whole ordering quietly reverts to the broken behaviour. (Verified 2026-08-04; check the payload before changing this key.) For issues with no parent the two keys agree, so mixing `number` and `createdAt` across the queue is not an option — use `number` for both sides.

The edge is the **native GitHub sub-issue relationship** (`gh issue edit <child> --parent <prd>`), read from the planner's single list call — free, no body fetch. A prose `Split out of #N` line in the body is documentation for humans; it is **not** the sort key, because parsing it would force a body fetch for the whole queue and destroy two-stage selection. When an intake skill cuts children from an umbrella it MUST set `--parent`; a child with no parent edge simply sorts on its own number, so the change degrades gracefully.

`gh issue edit --parent` is **unreliable under rapid fire** — observed exiting non-zero on success, no-opping silently, and once applying the wrong parent when called in a tight loop. Read every edge back (`gh issue view <child> --json parent`) and retry on mismatch; never trust the exit code. (This applies to the intake skills that WRITE edges; the planner only reads them.)
