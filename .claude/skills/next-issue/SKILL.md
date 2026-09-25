---
name: next-issue
description: Close ONE ready-for-agent issue end-to-end in THIS session — the single-session pipeline (ADR 0110). Use when the user says "next issue", "prendi la prossima issue", "close issue N", or invokes /next-issue [N].
---

# /next-issue — one context closes one issue

One session, one issue, no orchestrator, no implement subagents (ADR 0110).
Target: a median issue lands in **60 minutes** wall — the measured-supported
figure (issue #3079) that replaced ADR 0110's unchecked 10-15, against a
measured 85m median wall / 67m median machine time. `bun run telemetry:latency`
is how anyone checks; the baseline and the arithmetic are in
`docs/agents/quality-gates.md` § Latency per issue. Everything below happens in
THIS session's context.

## Context hygiene — the contract

One long context is the whole design (ADR 0110), and its one weakness is that
**nothing ever leaves it**. Every token a tool result adds is re-read as
cache-read by every later turn, so a session's cost is super-linear in its
length: measured over 2026-08-28 → 2026-09-05, a turn cost **$0.074 at 93k of
context and $0.186 at 353k** — 2.5x — and the back half of a session burned
**62% of main-thread spend for 50% of the turns**. The baseline and the command
that re-derives it: `docs/agents/quality-gates.md` § Context hygiene.

This is prose, not a gate — deliberately (issue #3078). It is three habits:

1. **Ask `gh` for fields, not for a page.** `gh issue view N` and `gh pr view N`
   render the whole record; name what you will read instead —
   `gh issue view N --json number,title,body,labels,state`, adding `comments`
   only when you are going to read them (§0 wants the comments, not the
   reactions and the project cards). One field is one field:
   `gh pr view N --json state --jq .state`, never a full view to check whether a
   PR is still open. `--jq` any list down to the columns you will use, and cap
   `--limit` — an unfielded `gh issue list` measured 7.6k tokens in one call,
   and `gh` as a bucket runs 919 tokens a call against a 512-token `git`.

2. **Noisy stdout goes to a file; the verdict comes back.** Gates, test runs,
   builds and broad searches reach the transcript as an exit code plus the lines
   that carry the answer, with the full log left on disk for a targeted re-read:

    ```bash
    L="$SCRATCHPAD/check-lane.log"   # session scratchpad — NEVER a shared /tmp
    bunx vitest run <path> >"$L" 2>&1; echo "exit=$?"; grep -E 'Tests|FAIL|✗' "$L"
    ```

    `land` is the one thing that does NOT go in this shape — it runs the lane
    gate behind the machine-wide mutex and can outlive the tool's own cap, so
    it goes through `gate:run` below.

    `deny-guard.sh` § 3 already refuses a `bun run` piped into a pager, and this
    is the idiom it is asking for. The same applies to reading: `grep -c` or
    `grep -n 'export function'` before `cat`, `sed -n 'A,Bp'` for a known region,
    `--files-with-matches` when you only need the list. `fs` calls were the
    single largest sink measured — 7.9k calls, 5.2M tokens, p90 2.1k per call.

3. **Never poll.** A `sleep N; echo` round-trip is a full-price turn at tail
   context carrying zero information, and 437 of them were measured in one week.
   Background work that is NOT a gate re-invokes you when it exits — start it
   with `run_in_background` and answer the notification. For external state the
   harness cannot see (a deploy, a remote queue), use `Monitor` with an
   until-loop, not a sequence of turns. **A GATE IS THE ONE EXCEPTION, and it
   is not an exception to this bullet but to `run_in_background` itself** — see
   the rule below, which is the same text `deny-guard.sh` § 3b carries.

<!-- <<<GATE-RULE>>> -->

RUNNING A GATE. A gate never runs detached from the call that must read its
verdict: not `run_in_background` (the notification never arrives — under `claude
-p` the end of a turn is the end of the process), and not piped into a pager
(the exit code becomes the pager's). A gate that can outlive the Bash tool's cap
— `land`, and any lane gate run by hand, both of which queue behind the
machine-wide gate mutex — runs through `bun run gate:run <script>` instead,
issued with the tool's `timeout` set to its 600000ms MAXIMUM, because the
120000ms DEFAULT is shorter than the wait this script does: each call blocks in
the FOREGROUND for at most 480s and then either returns the gate's real exit
code or exits 75, "still running"; re-running the IDENTICAL command re-attaches
to the same run and never starts a second gate. Re-run it until an exit code
comes back. This rule is the same attended and unattended — the only difference
is the cost of breaking it: an attended session that lets a gate be promoted to
the background sees the promotion and can re-attach by hand, a driven pass dies
with the turn and takes the gate's verdict with it.

<!-- <<<END GATE-RULE>>> -->

Waiting inside ONE foreground call is not polling: `gate:run` blocks in the
shell, so the transcript grows by one line per call, not by one turn per
`sleep`.

None of this narrows what you may read. It is about the SHAPE of what enters
the transcript: read the whole issue, run the whole gate — just don't carry
the rendering of either for the rest of the session.

## 0. Pick

- `/next-issue 1234` → that issue. Otherwise: `bun run queue:plan --cap 1
--pretty` picks the top unclaimed `ready-for-agent` issue by priority BAND
  (P0 → P1 → P2 → P3 → unprioritized), then standalone-before-slice, then own
  priority, then bugs, then oldest.
  The band is the parent PRD's whenever the PRD carries one — a P0 umbrella's
  slices all clear before the P1 band opens, because an umbrella closes only
  when its last child does (issue #3212), and a slice's own `P0` does NOT lift
  it out of a P1 umbrella's band (issue #4371). A plan echoing `priorityBand`
  on an issue is saying "this did not compete on its own priority, and here is
  the band it competed in" — lift or demotion alike.
- **"finish PRD #N" is `--lineage <N>`, never a hand-picked batch** (issue
  #2327): it restricts the candidate set to that umbrella's open sub-issues,
  read from the native edges, and runs the pipeline unchanged over them — same
  sort, same dependency scan, same disjointness, same model resolution. A
  target that is not an umbrella, or one with no open children, exits non-zero
  naming which of the two it was; nothing falls back to the whole queue.
- **`queue:plan` refuses the pick in two cases, and each names its exit**
  (ADR 0136 §6-7). **Cap**: live claims are at `sessions.cap` in
  `tolaria.config.json` (3 — the measured knee, derivation in
  `docs/agents/quality-gates.md` § Session admission); the refusal names the
  claimed issues, and `--no-cap` plans past it deliberately. **RED**: the
  durable release-health marker is up; the refusal names the sha and the
  failing step, and the exit is `bun run health:fix` — fixing the base tip
  comes before taking new work, so do that instead of picking another issue.
  (`land` still only WARNS on RED, so a session already mid-issue finishes.)
- Read the issue and its comments IN FULL before touching anything. The
  body's `Target files:` section (one path per line) is the declared blast
  radius — use it to scope your reading and to route the review in §4; a
  missing or comma-joined section is worth fixing in the issue while you are
  there.

## 1. Model check (before any work)

**The `model:*` label is the routing authority — there is no second criterion
here.** Absence of a label IS the answer: the issue runs on the default tier
(Sonnet). The full test and its rationale live in ONE place,
`docs/agents/triage-labels.md` § Model-routing labels — do not restate it, and
never re-derive a tier from the area an issue touches. Area-based escalation is
what the 2026-08 audit found had put half the queue on Opus for no measured
quality gain, and a prose list here that disagrees with the filing skill is how
this section shipped contradicting `/new-qa-issue` (a bot-search issue with a
mandatory blade pair is unlabelled BY DESIGN, and was being stopped as
"opus-class" anyway).

Say the tier out loud in one line, then:

- **Carries `model:opus` / `model:fable`, session runs a lower tier** → **stop
  here**: tell the user to relaunch (`claude --model opus`). Do not "try
  anyway" — the 2026-08 data shows underpowered attempts pay for themselves
  again in review rounds.
- **Unlabelled** → proceed on this session's tier, whatever it is. A higher
  tier than the label asks for is never a reason to stop.
- **Unlabelled, but reading the issue convinces you it meets the label's
  criterion** (a wrong mental model no gate catches — not "it touches the
  engine", not file count): apply the label FIRST —
  `gh issue edit N --add-label model:opus` — and only then stop or continue.
  A stop that leaves no label re-derives the same judgment next session and
  gives the filing criterion no feedback.

Likewise, if review later finds a wrong-mental-model defect (not a mechanical
slip), add `model:opus` to the issue so the NEXT routing is right.

## 2. Claim + worktree

- Claim: `bun run queue:claim N` — ONE locked act (issue #4375): it re-reads
  the live claims under the claim lock, refuses at `sessions.cap` (`--no-cap`
  is the announced escape, never for a pass) or when a live session already
  holds N, then writes the label and the journal row. A refusal is the exit:
  `claimed` → pick the next issue; `cap` → stop, as §0 would have. Never type
  `gh issue edit N --add-label in-progress` — `deny-guard.sh` § 6 denies it.
- Ephemeral worktree (bootstrap is ~2s warm — never reuse a standing one):
  `cd "$(bun run --silent wt:new N)"` (`--fix` for bugs). It branches from
  `origin/<base>` — the base branch named in `tolaria.config.json`, never
  the primary checkout's HEAD (ADR 0116).

## 3. Implement — in THIS context

**The DIFF's LANE decides what this section owes, not the session** (ADR 0136
§8). Commit, then ask the classifier — `bun run check:lane --plan` prints the
lane and runs nothing, so asking costs no gate:

- **`cards`** (the diff is entirely under `convex/cards/sets/**` plus the
  regenerated `data/**`, with prose free to ride along — ADR 0136 §3): the
  SHORT PATH — write the definition, the
  `## Preset scenario` JSON and the regenerated artefacts, confirm the CR
  lines (`bun run cr <id>`, then `bun run cr:ledger confirm <file>:<line>`).
  **No hand-written test, no proof-of-failure, no bot or frontend seam walk**:
  ADR 0045's per-Op regime already covers a card built from exercised Ops
  (static sweep + generated smoke test), and the lane runs the catalogue
  guards and the three bot censuses on the rebased tip anyway. Best observed:
  24 min wall, ~4 implementing.
  **The tripwire: a session that finds itself writing a test for a `cards`
  diff has found an unexercised Op** — stop, file it per `/new-op`, and let
  the Op earn its permanent test. A card that introduces an Op touches
  `convex/gre/**` and is not this lane.
- **any other lane** (`engine`, `skin`, `full`) — everything below applies in
  full.

The short path is keyed on the LANE, never on how simple the card reads: a
judgment ("vanilla creature, no test needed") is what shipped untested Ops,
and the classifier is the only thing that knows `data/**` rode along or that
a file slipped in under `convex/gre/`.

The path-specific rules apply unchanged (`.claude/rules/gre-development.md`,
`frontend-components.md`, `bot-development.md`): CR printed not recalled,
DSL-first, frontend wiring walk, proof-of-failure for every guarding test.
Iterate with targeted runs only (`bunx vitest run <path>`). Card variants in
tests go through `withTemporaryDefinition` — the catalogue is frozen. Added or
retitled a test block that pins a constant or asserts object identity? Run
`bun run check:test-hygiene` (guard-cached, ~7 s) before the PR: a block not
named in `scripts/lib/identity-test-allowlist.json` lands green and reds the
next `health` run instead (issue #4490, issue #4686).

**Touching the Bot (`convex/gre/{search,evaluate,moves,applyMove,ai}`,
`src/lib/ai/`, `convex/limited/botDrafter`)? Invoke `/bot-slice` FIRST**
and find your row in its **Seams** table. A missed bot seam fails no
suite — it just makes the bot quietly stupid, or makes the change
invisible in the DecisionTrace you would debug it with (#2686).

**COMMIT BEFORE YOU BREAK ANYTHING.** Proof-of-failure means editing the
subject and reverting it, and with no orchestrator there is no second copy of
your work: `git checkout <file>` on a file with uncommitted changes discards
the IMPLEMENTATION, not the break. So commit the work first, then break →
run → revert against a clean baseline. Both failure modes are silent, and
both were observed the first time this skill was run for real (#2789):

- reverting a break wiped the whole implementation of the file, which then had
  to be rewritten from context;
- the SECOND revert left a later break's `perl` substitution matching nothing,
  so the test passed, and a vacuous-looking green nearly got recorded as a
  proof. **Assert the patch applied** (`grep -c` the broken text) before
  believing a red — and before believing a green.

## 4. Review — ONE round, routed by risk

Pick by the DIFF (not the issue label alone):

| Diff touches                                 | Reviewer                   |
| -------------------------------------------- | -------------------------- |
| `convex/gre/**`, `**/ai/**`, or `model:opus` | one spawn, `model: opus`   |
| anything else with code                      | one spawn, `model: sonnet` |
| docs/markdown only                           | no review                  |

Spawn exactly one reviewer subagent (`description: "review PR …"`, explicit
`model` — spawn-guard enforces both) scoped to the diff plus whatever context
it asks to read. Blocking findings: fix them HERE, in this session, re-run
the targeted tests, and answer in the PR thread. **No re-review round** — the
lane gate at `land` catches regressions; if the reviewer found a
wrong-mental-model defect, see §1's escalation note.

## 5. Land

- **No pre-PR gate** (ADR 0136 §1). Before the PR, the session's signal is
  its targeted `bunx vitest run` and the §4 review — nothing else. The lane is
  paid ONCE, by `land`, on the rebased tip inside the mutex. A lane gate run
  here certified a tree that never landed: at 2.5 PR/h the base moved during
  it, and `land` paid the lane again anyway. Commit, push, open the PR.
- PR body: what changed, tests + proof-of-failure line, `{ label, spec }`
  scenario for any new card/gameplay feature (ADR 0044), UI receipt only if
  the diff can reach the DOM (`bun run check:ui`).
- **The scenario is a ```json fence under a `## Preset scenario` heading**, and
  `land` refuses the merge without one whenever the diff touches
  `convex/cards/sets/**` or `convex/gre/**`. Say "none owed" in that section
  when it genuinely isn't. You do NOT run the insert — `land` seeds it after
  the merge. (Between ADR 0110 retiring the orchestrator and this being wired,
  every emitted spec was silently dropped: 33 were recovered by
  `bun run seed:backlog`.)
- **Land from the worktree, with an explicit run key:**
  `TOLARIA_GATE_RUN_KEY=land-<PR#> bun run gate:run land <PR#>`. `land` refuses
  to run from the base branch — it lands the branch you are on — and it DELETES
  this worktree when it merges. `gate:run` keys a run on its cwd by default, so
  without the key the follow-up call (from a directory that now exists, since
  this one does not) would compute a different key and start a SECOND `land`,
  re-paying the whole gate. With the key, re-issue the identical command from
  anywhere — including the primary checkout — and it re-attaches.
- Exit 75 means "still running": issue the identical command again, as many
  times as it takes, until an exit code comes back. Never end the turn on a 75.
- `bun run gate:run land <PR#>` rebases onto the base branch, runs the lane
  gate under the machine mutex, merges into the base branch, tears down the
  worktree and both branch refs. Its log says `lane: ran`, or
  `lane: skipped (gated <sha> against <base>)` when that exact rebased tip was
  already gated green against that exact base — a `land` retried after a
  merge refusal does not pay the lane twice. No health gate per landing: `land`
  records the tip and detaches the batch decision, which runs the full gate on
  the current base tip at the 5th landing since the last GREEN or 2 h after the
  first un-healthed one (ADR 0136 §6); `bun run release` re-proves the tip
  before the release branch moves. If `land` warns that a health RED marker exists,
  read `bun run health:status` first: fixing the base tip comes before
  landing new work. `land` refuses a PR whose base is not the base branch —
  `gh pr edit <PR#> --base <base>` is the fix.
- **Never do that catch-up by hand.** The merge lands through the API, so
  only `origin/<base>` moves; `land` owns pulling a checked-out local base
  branch up and deleting the local branch, because a rule that CAN be a
  script is not prose. A `could not fast-forward local <base>` line from
  `land` is the whole handover — say so in §6 rather than fixing the user's
  checkout for them.
- **A `convex/cards/sets/**`diff owes`bun run seed:preset --all`AFTER the
merge** (issue #3254; the sweep's own header carries the derivation).`land`seeds the
PR's preset SCENARIO and knows nothing about preset DECKS, and the slice that
lands a decklist's LAST card has no idea it was the last one — which is how
Parallax Replenish reached 21/21 and stayed unplayable as a preset. It is
upsert-by-slug and idempotent, so running it on a slice that completed
nothing costs one line of output. Not a gate:`presetDecks` is
  deployment-local, so no deployment means nothing owed.
- **`land` files the computed Gap issues under the BAND of the issue you
  closed** (issue #4158). It reads that band before the merge — the parent
  umbrella's board `Priority` when the umbrella carries one, else the issue's
  own: the rule `queue:plan` orders by (issue #4371), demotions included — and
  passes it to `gaps:sync --band`; under a P0
  umbrella every Bot / Op / mechanic gap the landing creates goes into the
  family's **P0** umbrella instead of the band its Target computes. Nothing
  to do by hand. If `land` prints `gaps:sync gets no --band (…)` the band
  could not be read: say so in §6 and move the new gaps yourself
  (`gh issue edit <gap> --parent <P0 umbrella>`; umbrellas in
  `docs/agents/issue-tracker.md`).
- Issue not auto-closed by the merge → close it with a one-line comment.
  On abort: remove `in-progress`, remove the worktree.

## 6. Report

Five lines, no more: issue, PR, what landed, what the review caught (or
"clean"), anything flagged for the user. Quote `land`'s own lane receipt in
the "what landed" line — `lane: ran` or
`lane: skipped (gated <sha> against <base>)` (ADR 0136 §2) — so the reader
sees which lane paid for this tree and whether it was paid at all. Then STOP — one issue per
invocation. The user (or the budgeted AFK driver, ADR 0109) decides whether
there is a next one.
