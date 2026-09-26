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

## `## Unlocks` — what an engine issue unblocks (issue #4052)

An engine issue may carry an `## Unlocks` section naming the computed Gaps it
unblocks. `bun run gaps:sync` reads it and writes BOTH halves of the edge — the
native `blocked by` relationship the board draws, and the `## Blocked by` body
section `queue:plan` defers a pick on. **You never write the edge by hand**: the
gap's issue does not exist yet when the engine issue is filed, and 470
hand-maintained edges rot in a week (issue #3851 decision 2).

One key per list item, no prose — three accepted forms, and a line matching none
of them is reported as residue rather than guessed at:

```markdown
## Unlocks

- addMana
- grammar: (op) › addMana
- mechanic: planned-mechanic › keyword "changeling" is not implemented in the Mechanics Registry
```

A bare Op name is auto-filled to its `(op) › <name>` Grammar Gap key — the
common case (an issue that adds an Op unblocks that Op's census gap) costs no
lookup. `None.` declares nothing. The keys are the allowlist's own
(`data/grammar-gaps.json`), so a typo resolves to nothing and `gaps:sync` prints
it as `unlocks residue` — read those lines, they are the only place a
mistyped key becomes visible.

## `## Cards` — the cards an issue is about (issue #4086)

An issue may carry a `## Cards` section naming the cards it is ABOUT — the
cards it ships, or the cards the engine work waits on. `bun run backlog:triage`
bands the issue by them, exactly as it bands by the cards a claim unlocks or a
title names: a card some ranked Target requires lends that Target's band
(the Targets carrying a `priority` in `data/targets.json`, not yet
`completed`, in `priority` order → P1, P2, P3; a Target with none lends no band). **A card cited as an example or a test case never goes
here** — the section is a declaration, and reading a body's free text instead
would band a framework issue by the card it happens to test on.

One card per list item, the lockfile's name (exact, or the front face), no
prose — one `` ` `` or `**` wrapper is tolerated:

```markdown
## Cards

- Psychatog
- Wan Shi Tong, Librarian
```

`None.` declares nothing. The contract is per LINE: a name the lockfile cannot
resolve does not silence the others — they still band the issue, and the
unresolvable line is printed under `## Cards residue` in the triage report,
the only place a misspelt name becomes visible. A section shown inside a code
fence (like the one above) is an example and is not read.
`backlog:triage --suggest-cards` proposes a block for each residue issue from
its `` `Name` `` / `**Name**` spans — a proposal only: confirm against the
body, then paste.

## Umbrellas partition by Target (issue #4056, ADR 0143)

**Open an umbrella per TARGET, never per type** (issue #3851 decision 7). A
type umbrella is a pile: issue #3972 held 87 Op gaps in no order, and exists
only because GitHub caps a parent at 100 sub-issues. A Target umbrella is a
bounded, ordered slice of the backlog, so the cap stops being reachable. It is
named after its Target, not a band letter (ADR 0143 § Bands follow the
Targets), so a Target completing re-parents nothing. The board `Priority` of an
umbrella is hand-set by the owner (`lib/backlog-triage.ts`, decision 7), again
whenever the roster shifts, and children inherit it (issue #3212).

| Family        | Holds                                                                   | P0    | premodern-metagame | vintage-cube | format-premodern |
| ------------- | ----------------------------------------------------------------------- | ----- | ------------------ | ------------ | ---------------- |
| Grammar Rules | `Grammar Gap:` (`gaps:sync` kind `grammar`), `[Grammar]` rule tickets   | #4091 | #4092              | #4093        | #4094            |
| Ops           | `Quarantine (mechanic):` (kind `mechanic`) — new and existing Ops alike | #4095 | #4096              | #4097        | #4098            |
| Bot Gaps      | `Bot Gap:` (kind `bot`)                                                 | #4099 | #4100              | #4101        | #4102            |
| Hand Tail     | `Hand Tail:` (kind `hand-tail`)                                         | #4241 | #4242              | #4243        | #4244            |

- **The Target is COMPUTED, and the parent follows it.** It is
  `backlog:triage`'s cards source — the strongest registered Target among the
  cards the gap reaches (`strongestCardBand`, ranked by `targetBand()`): the
  hand-written cards using the Op for an Op gap, the quarantined cards for a
  mechanic class, the cards carrying the key as `botGap` for a Bot Gap, the
  card itself for a Hand Tail card. `gaps:sync` files under that Target's
  umbrella and MOVES an open issue when the Target lending its band changes;
  the table lives in code as `BAND_UMBRELLAS` (`scripts/lib/gap-issues.ts`),
  keyed by Target id — plus `P0`. A Target that starts lending a band with no
  row there files as residue, and `gap-issues.test.ts` reds on that drift:
  open the family's umbrella and add the row.
- **P0 is never COMPUTED — it is hand-set, or inherited from the work that
  spawned the gap** (issue #4158). No rule derives it from a Target, so the
  computed band never files into a P0 umbrella and nothing moves an issue out
  of one. What can: `gaps:sync --band P0`, the ORIGIN band of the run. A gap
  that run CREATES (or finds homeless) files under its family's P0 umbrella,
  because a gap born of P0 work is P0 work (an umbrella closes only when its
  last child does, issue #3212). `land` derives the band from the issue the
  landed branch names — its parent PRD's board `Priority` when the parent
  carries one, else its own, the rule `queue:plan` orders by (issue #4371) —
  and passes it; nobody types it after a landing. A P0 session running
  `gaps:sync` by hand passes `--band P0`. Only `P0` acts; any other value
  leaves the computed band in charge, and an existing issue is never pulled
  up.
- **Residue** — no ranked Target among its cards — files under its family's
  umbrella of the **lowest-ranked** Target (`format-premodern`,
  `LOWEST_RANKED_TARGET`) unless a set umbrella claims it at create: an
  unranked gap is deliberately-later work (issue #4110), and the fallback is a
  constant, never a computed umbrella. An
  existing one keeps a parent placed by hand; `gaps:sync` lists it.
- **Kinds with no family yet** fall back to a P3 umbrella of their own:
  Scenario Gaps #4111, Migrations #4112 (a set umbrella still wins at create).
  The table is `KIND_FALLBACK`.
- **PRD #3820 is not a parent of computed gaps** — it is closing, and a child
  inherits its P0 band (issue #3212). Like issue #3972 and #4113 (the single
  Hand Tail pile the Hand Tail family replaced) it is in
  `RETIRED_UMBRELLAS`: a gap under any of them — or under no parent at all, a
  create whose parent write failed — moves to its Target umbrella or its
  fallback.
- **Each umbrella's board `Priority` is its Target's band**, kept by
  `backlog:triage --write` (issue #4212) — a Target completing shifts it with
  no owner edit, the `P0` slot excepted (hand-set, never written); its
  children inherit it (issue #3212).
- **A landed issue leaves its umbrella** (issue #4235). `land` runs
  `bun run umbrella:detach <issue>` for the issue the branch names, after
  `gaps:sync` (which reads the parent edge): a CLOSED child of a band umbrella
  or a kind fallback (`BAND_UMBRELLAS` + `KIND_FALLBACK`) is removed from it,
  so an umbrella lists the open work of its band. An issue still OPEN is never
  detached — a merge whose `Closes` keyword failed leaves it open, and it
  stays listed until it is closed and the command is re-run by hand. Retired
  umbrellas are not in the census; `gaps:sync` empties those.
- **`gaps:sync` closes a claim whose work is done** (issue #4516), so no
  claim waits on a human: a Hand Tail claim its card's `hand-tail:` marker
  settles or whose card now compiles `ready`, and a Grammar Gap / mechanic /
  scenario / Bot Gap claim whose key the run no longer computes anywhere in
  the corpus — Bot Gaps only while `data/bot-reach-findings.json` agrees with
  the lockfile. Each close comments the reason and the tip; the claim row
  stays. Only an issue `gaps:sync` filed (title opens with the kind's prefix) closes — an adopted or hand-authored one is reported `foreign` — and a pass over `CLOSE_CAP` open closes refuses whole. Never closed: an `(op) ›` row (`check:gaps` owns it), a migration, a
  Hand Tail claim settled by ANOTHER issue's marker (printed as `settled`, a
  human reconciles it), and a Grammar Cluster while any of its rows is live.
- **A hand-filed `[Grammar]` ticket** goes under the Grammar Rules umbrella of
  the Target its cards compute — `gaps:sync` does not file those. It is a
  **Grammar Cluster** (`/new-set` Phase 3): it claims several gap keys, and
  `gaps:sync` leaves a multi-claimed issue's body and parent alone.

A new family gets one umbrella per ranked Target plus a `P0`, a
`BAND_UMBRELLAS` row and a row here — never one umbrella by type.

## Card names are Scryfall links (issue #3666)

Every card name in the BODY of an issue an intake skill generates — Agent
Brief, PRD umbrella, slice ticket — is a Markdown link to the card's Scryfall
page, with a text tooltip:

```markdown
[Lightning Bolt](https://scryfall.com/card/d573ef03-4730-45aa-93dd-e45ac1dbaf4a "{R} · Instant")
```

Never build the URL by hand: **`bun run card:link "<Card Name>" […]`** prints
one ready-to-paste link per name. It takes the Scryfall id from
`data/card-index.json` and the tooltip from the committed Full Catalogue, and
asks the Scryfall API (exact name) only for what the tree lacks. On a name
nothing resolves it exits non-zero and names the card — fail-closed, no
guessed URL.

- **The id, never a name search.** `scryfall.com/card/<id>` redirects to the
  card's page; a `?q=` search lands on a results list whenever a name has
  several printings.
- **Why a text tooltip, and no hover image or new tab.** GitHub sanitizes JS
  and CSS out of an issue body and strips `target` from links, so an image
  overlay and forced new-tab opening are both impossible there. The link
  title (`<mana cost> · <type line>`) is the one hover GitHub renders. Do not
  retry the image.
- **Body only.** GitHub renders an issue title as plain text, so a title keeps
  the bare name.
- **Exempt:** fenced code (logs, specs, quoted templates) and the
  `## Cards` declaration (section above), whose items are bare lockfile names
  by contract.
- **Forward-only.** Existing issues are not rewritten; PR bodies, commit
  messages, findings drafts and code comments are out of scope.

`bun run queue:lint` reports a bare multi-word catalogue name as the advisory
`unlinked-card-name` (never blocking) and its fix line is the `card:link`
command for exactly those names. Single-word names (Island, Fog, Shock …) are
not checked — they collide with ordinary English.

A skill that hands its drafting off to `/to-prd` or `/to-tickets` tells them
to apply this rule; those two stay MTG-agnostic.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Why the queue is sorted the way it is

**The planner computes this — you do not.** `scripts/lib/queue-plan.ts` owns the sort, the two-stage fetch, the dependency scan, and the disjointness walk; `bun run queue:plan` prints the result (`/next-issue` consumes it with `--cap 1`). What follows is the _rationale_, so a future reader does not "simplify" a key that looks arbitrary. It is not instructions to re-derive the query by hand.

**Why the board field is the ZEROTH key, and why it is not a label.** Every key below it — `bug`, lineage, number — is a _default_: a reasonable guess for issues nobody has ruled on, which is nearly all of them. What the defaults cannot express is the criterion of the moment ("this week, the deckbuilder"), because that criterion changes faster than the queue drains. Writing it onto the issues is the trap: a per-issue priority label means every change of mind is an edit to hundreds of issues, so in practice it is set once and rots. The board's `Priority` field is read at PICK time instead — the maintainer flags the few that matter now, the planner applies it, and next week's re-think costs a few clicks, not a migration. Since ADR 0143's amendment (issue #4228) that reading holds on a residue row — an issue no card bands — where `Priority` is a classic hand priority over all four values, while on a card-bearing row it is the milestone band, so board-wide `P1` reads _critical track or the owner says now_ (`docs/adr/0143-roadmap-to-diffusion.md` § Bands follow the Targets). The field offers FOUR values — `P0`, `P1`, `P2`, `P3` — and they rank in that order, with "no value set" strictly BELOW all four: `P0 < P1 < P2 < P3 < unprioritized`. `P3` is a ruling ("somebody looked at this and put it last") and an empty field is the absence of one ("nobody has looked yet"); collapsing them onto one rank is the bug the sentinel guards against, which is why `UNPRIORITIZED` is defined as one past the last named band and moves whenever a band is added (issue #4051). That is also why `P2` beats an unprioritized `bug`: the ordering below the line is a heuristic, and an explicit human judgment outranks a heuristic every time. It is not a label for the same reason it is not a score — an axis with 265 values that a human maintains by hand is an axis that stops being true.

**Why a PRD's children inherit its band (issue #3212), and why the PRD GOVERNS it (issue #4371).** A P0 umbrella is P0 because it must CLOSE soon, and an umbrella closes only when its last child does — so the board's strongest statement buys nothing if its slices compete as their own `P1`s. The zeroth key is therefore the BAND: the parent PRD's `Priority` when the parent carries one, else the issue's own. Measured on the live queue the day inheritance shipped: 39 of 221 ready-for-agent issues rose into the P0 band, 20 of them P1 slices that would otherwise have interleaved with unrelated standalone P1 work.

Inheritance originally took the STRONGER of the two, never demoting. Issue #4371 reversed that: **the parent's value wins outright, demotions included.** The umbrella is the ruling a maintainer actually maintains — one row, re-read whenever the plan changes — while a child's own `Priority` is set per-slice, usually at filing time, and it rots there. Under "stronger wins", every such slip became a board-wide override nobody ruled on again, and the queue showed it: children mis-marked `P0` under a correctly-`P1` PRD were being picked ahead of unprioritized children of a `P0` umbrella. The child's own value is not discarded — it is the key that orders the slices INSIDE their umbrella's turn. A parent with no board value states nothing, so the band degrades to the child's own; an unprioritized umbrella never buries its children.

Between those two keys sits **standalone-before-slice**: inside one band, an issue with no PRD leads the children of a PRD that landed in the same band, because `P0` on an issue with no umbrella points at that issue and nothing else, while a `P0` slice is one of several ways into the same epic. The full order the maintainer enumerated: no PRD + `P0` · PRD `P0` + `P0` · PRD `P0` + anything weaker · `P1` with no PRD · PRD `P1` + … , with `bug` below all three priority keys.

Inheritance walks ONE level, because `--json parent` carries no grandparent and the band is a lookup into the map already in hand, so it costs no extra API call. A plan echoes `priorityBand` only when the band DIFFERS from the issue's own priority: present means "this did not compete on its own priority, here is the band it competed in", and echoing it always would hide exactly that case. The demotion is the reading that most needs it — a `P0` slice planned under a `P1` band looks like a planner bug until the band is on the row beside it.

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
