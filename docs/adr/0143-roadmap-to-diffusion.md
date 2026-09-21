# Roadmap to Diffusion: milestones are Target Lists completed in order, and the board's bands follow them

## Status

accepted — grilled 2026-09-20 (issue #3854, the final ticket of the roadmap
map, issue #3846). Builds on ADR 0137 (grammar-first authoring), ADR 0138 (bot
strength is Held-out Agreement) and the resolutions of the map's tickets:
Target List + Coverage Invariant (issue #3848), the clause census (issue
#3849), the backlog triage rule (issue #3851), the Diffusion checklist (issue
#3853), Target timelines (issue #4085) and the whole-Target Bot-play
measurement (issue #4149). **Amends the band rule of issue #3851**: a band is
no longer an id hard-coded in `targetBand()`, it is derived from the Target
registry (§ Bands follow the Targets).

**Amended 2026-09-21** (issue #4228, the ruling of issue #4222): the v1 gate
gains a fourth clause (§ The v1 gate); an issue that touches no card reaches
`P1` through three doors, and `Priority` is a hand priority on such a row
(§ Bands follow the Targets). "A band means a milestone, and nothing else" is
retired, and the hand source is now `user-decision`.

## Context

Tolaria is deployed and played by a few friends. The owner asked for the road
from here in short / medium / long-term vocabulary, with gates that are
numbers. Eight tickets of the map measured the ground first; this ADR is what
they add up to.

Measured on 2026-09-20 (`bun run oracle:report --targets`, base tip
`8120bceed`): `premodern-metagame` **208 of 310 playable (67.1%)**, 68 `ready`;
`vintage-cube` 472 of 542 playable. The grammar-first window is days old —
`ready` on the metagame went 40 → 68 in one day — so every rate below is a
prior, not a trend.

Three measurements shaped the decisions:

- **The two first Targets share almost no grammar.** Of 66 above-floor gaps on
  each, one is common. The cube inherits nothing from the metagame work; they
  are sequential, not overlapping.
- **Leverage on a Target is ~1 card per rule.** The keyword-line wave the map
  was charted around is real but small on the metagame: Cycling, Echo,
  Madness, Protection, Flashback and Morph sit in its top 20 gaps (~15 cards);
  the corpus's top gap ("Enchant creature", 894 cards) is not among them — it
  is a pool gap.
- **The Bot half was under-priced.** On the playable cards of the metagame the
  Bot-owed rate is **15%** (30 of 201: 26 `never-chosen` in 20 classes, 4
  `frozen` in one), against a 5% prior, at ~1.3 cards per fix instead of 2.7. A
  further 12 cards are unmeasured by a bound of the sweep itself (9
  `no-progress`, 3 `position-unmodelled`).

And one finding about the board: 158 open issues sit in `P1`, most by
inheritance from PRDs hand-set months ago — cube mechanics, a Shortcut PRD,
accessibility work — while the umbrellas that should hold the v1 critical
track (Ops, Bot Gaps) are empty and a Hand Tail umbrella for the metagame does
not exist. The band rule works; its roots are stale, and nothing in it moves
when a Target completes.

## Decision

### Milestones are Target Lists, completed in registry order

A milestone is a **Target List** reaching `completed`; the order is the
`priority` column of `data/targets.json`. The three terms the owner reads the
roadmap in are defined by EVENTS; a date beside one is a forecast published at
its pessimistic end (issue #4085), never a commitment.

| Term       | Milestone                                                                              | Opens when                                                        | Closes when                               | Forecast                                          | Band            |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- | --------------- |
| **Short**  | **v1 — Diffusion**: `premodern-metagame` completed, announced to strangers             | now                                                               | the v1 gate is green, plus one fixed week | 2026-11-02 – 2026-11-25, re-priced below          | `P1`            |
| **Medium** | **v1.1** — `vintage-cube` completed (Supported); then **`format-premodern`** completed | the metagame's grammar-owed queue is empty (§ The exit threshold) | `format-premodern` is `completed`         | cube to 2027-01-19; the premodern pool is undated | `P2`, then `P3` |
| **Long**   | **v2** — constructed formats beyond premodern (pauper, legacy, vintage, modern, …)     | `format-premodern` is `completed`                                 | —                                         | undated; revisit 2026-10-19                       | none            |

The premodern pool moves from "v2, first" (the map's charting) into the medium
term: it is the third Target, so it is the third band. v2 is what lies beyond
it.

**After v2, ordered but unplanned:** full-block Limited, the DraftBot doctrine
(the same Verdict → fit → held-out loop over pick scores), multiplayer for
three or more players, a public player profile. **Out of the roadmap:** an RPG
around the game, ante and subgames (ADR 0010), a neural evaluation over the raw
board.

### The v1 gate

`premodern-metagame` (25 archetypes, one pinned list each, 310 cards):

1. **100% playable** — every card `ready` or hand-written, the Hand Tail
   declared by name; never 100% grammar (issue #3848).
2. **The Coverage Invariant green** on the Target (`check:targets`).
3. **Bot-play green**, which means exactly three clauses:
    - **`frozen` = 0, hard.** A freeze breaks a stranger's game. Today: the
      four Elemental Blasts, one class.
    - **Every `never-chosen` card is either fixed or covered by a `must` Test
      Position** that shows the Bot playing it in a position where playing it is
      sensible. The sweep judges in one generic position — a wrath with no enemy
      board, a ritual with nothing to cast — so part of the 26 are artefacts of
      that position; a Test Position closes such a card with a proof instead of
      a valuation change. Declared by name, like the Hand Tail; never silent.
    - **Harness-bound cards do not gate v1 and are listed by name.** Neither
      cause is a claim about the Bot, the engine or the compiler; both are
      limits of `convex/gre/ai/botReach.ts`. `position-unmodelled` (a spell that
      needs a spell or ability on the stack to target) is fixed in the sweep's
      position generator. `no-progress` is **undiagnosed**: twelve follow-through
      decisions are too many for Opt to be a tight bound, so the first Bot
      ticket is to diagnose it on one simple card, not to raise the bound — and
      if the loop exists in the live driver too, those cards are `frozen` and
      fall under the first clause.
4. **No open defect that falsifies or blocks a game, that breaks the
   first-session path, or that stops the pipeline.** Three doors, defined in
   § Bands follow the Targets; each is a defect that keeps the announcement
   from being made:
    - **Falsifies or blocks a game** — a loss or a stall, corrupted state, no
      workaround. _This prevents the announce to strangers._
    - **Breaks the first-session path** — a defect on one of the five surfaces
      a stranger meets first. _This prevents the announce to strangers._
    - **Stops the pipeline** — the gate, `land`, the worktree, the queue: it
      blocks v1 by blocking everyone building v1. _This prevents the announce
      to strangers._

    The clause counts defects, not cards, so it is not a condition of a Target
    List's `completed`. A `P1` the owner sets by the override (§ Bands follow
    the Targets) is a priority, not a door, and does not gate v1 by itself.

5. **Every deck of the Target seeded as a preset.**
6. The Diffusion readiness PRD (issue #4063) done, its children promoted when
   the pessimistic forecast is three weeks away or less.

Then one fixed week for the owner's checklist and a friends' dry run, and the
announcement: targeted (the premodern communities), promising Premodern only.
The Vintage Cube ships at launch as **Beta**.

**Bot strength does not gate v1.** Held-out Agreement (ADR 0138) is published
and followed without a threshold: the Verdict corpus and its split do not exist
yet, so any number chosen today would be invented. The promise to a stranger is
"the Bot plays every card", not "the Bot plays well".

**Re-pricing.** Issue #4085 priced the Bot half at 6–12 fixes; measured, it is
~21 classes sharing the grammar slots. The pessimistic end moves by one to two
weeks past 2026-11-25; the first re-measure (2026-10-04) states the new figure.

### The steering metric

Tickets are ranked by **cards unlocked per Grammar Rule per Target List**, in
registry order, the corpus count as the leverage tie-break. Line-level corpus
counts mislead (median leverage of a blocking line is 1.0); per-Target ordering
buys 1.5–2× on its Target at equal effort. The unit of a FORECAST is different
and stays so: rules per week plus hand-written cards per week, two parallel
tracks (issue #4085).

### The order of work

1. **Pilot** — PRD #3820 and the APC set, `P0`, in flight.
2. **Inside `P1`**, in this order:
    1. the `frozen` class and the `no-progress` diagnosis — cheap, and the
       diagnosis may uncover more freezes;
    2. the metagame's Grammar Gaps (keyword-line and templating first, by the
       steering metric), its Ops, and its Hand Tail in parallel — a card that is
       not playable has no Bot verdict, so playable precedes Bot-play;
    3. `never-chosen` fixes **batched after playability**, because every newly
       playable card brings its own verdict; exception: a class of three or more
       cards is taken at once (today only the mass-destroy sorceries);
    4. defects through the three doors of the v1 gate's fourth clause
       (§ Bands follow the Targets).
3. **The exit threshold** — below.
4. **The cube compositional wave** (planeswalker, saga, class, leveler,
   adventure, MDFC frames), then the premodern pool.

The Held-out build (issue #3980) and the Diffusion readiness PRD are `P2`
fillers for free slots — never the critical track; the latter returns to `P1`
on its numeric trigger.

Declared risk: batching `never-chosen` puts ~20 fixes in the last weeks. If at
90% playable more than 15 classes are open, the pessimistic date slips and the
re-measure says so.

### The exit threshold

Grammar slots leave the metagame for the cube when **the metagame's
grammar-owed queue is empty** — every residual Grammar Gap at or above
`handTailFloor` closed or with its PR open. It is an event read off
`oracle:report --targets`, it is NOT the v1 gate (Hand Tail, Bot fixes and
Diffusion readiness close v1 in parallel), and it is deliberately not a pool
percentage: a threshold on the premodern pool would be a medium-term number
smuggled into the short term. Until then the pool receives only the rules the
metagame needed, the corpus breaking ties.

### Bands follow the Targets

A band means a milestone for every issue a card can band. An issue that
touches no card — the **residue** — is banded by three doors and a default
(below), and `Priority` is no longer milestone-only on it.

| Band   | Means                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| `P0`   | in flight, hand-set — never written or cleared by a script                                |
| `P1`   | the critical track of the first Target not yet completed                                  |
| `P2`   | the second                                                                                |
| `P3`   | the third                                                                                 |
| (none) | not on the road: everything past the premodern pool, and a residue row that nothing bands |

- **`P1` holds what the v1 gate counts**: the metagame's Grammar Rules, Ops,
  Hand Tail and Bot Gaps, each under its umbrella, an engine issue that blocks
  a metagame card through a native `## Unlocks` edge, and a defect through one
  of the three doors. On a residue row it also holds what the owner says is
  now (§ `Priority` is no longer milestone-only, below).
- **Three doors to `P1`, for an issue that touches no card.** The card sources
  give such an issue no band, and this section's previous clause for it —
  engine defects "banded by severity", the rest by the cards they touch —
  could not fire for a UI bug, which touches no card. An issue that passes one
  door is `P1`, because it is a v1 blocker in its own right (§ The v1 gate,
  fourth clause):
    1. **Falsifies or blocks a game** — loss or stall, corrupted state, no
       workaround.
    2. **Breaks the first-session path** — a defect on one of the surfaces
       enumerated by the Diffusion checklist (issue #3853, PRD #4063): the
       lobby **welcome panel**, the **first game against the Bot** ("Play your
       first game"), the **controls sheet**, the **report tool**, and
       **sign-in / registration**. Never "the UI that matters": the boundary is
       fixed by this list, and a sixth surface is an amendment of it — otherwise
       the door grows to cover all of `src/`.
    3. **Stops the pipeline** — the gate, `land`, the worktree, the queue. The
       other two doors measure an effect on a player and a loop defect has
       none, so without this door `area:workflow` falls to `P3` while "`land`
       is wedged" outranks nearly everything in `P1`. It enters through the
       gate like the others.
- **The rungs below `P1`.** `P2` — reachable in normal play, with a
  workaround (the game stands). `P3` — a corner case, cosmetic, or an
  owner-only surface: admin, monitoring, limited-bot, docs, tooling. `P0` is
  unchanged: hand-set only, never written or cleared by a script.
- **`Priority` is no longer milestone-only.** "A band means a milestone, and
  nothing else" is **amended, not extended**. On a residue row `Priority` is a
  classic hand priority with all four values, none capped, and board-wide
  `P1` reads _critical track **or** the owner says now_. This is a partial
  return to the field's original rationale in `docs/agents/issue-tracker.md`
  ("the maintainer flags the few that matter now"), which this ADR had
  narrowed to milestone. The alternative — a `P2` cap on the residue, keeping
  `P1` single-meaning — was put and declined: the owner wants the override.
- **The write rule and the default.** No `## Band` line → the band is the
  default computed from the labels; a `## Band` line present → it is the
  truth, always. A hand ruling travels as a `## Band` section in the issue
  body (`P1 — <reason>`), never as a hand-typed board value: the board field
  is the OUTPUT of `backlog:triage --write`, and the board stores a value, not
  its author, so a script could not tell its own default from a ruling. The
  source that reads the line is `user-decision`. The default is deliberately
  coarse — the hand corrects it:
    - `user-report` → `P1`
    - `bug` + `area:mechanics`, `area:game-bot`, `area:ui-ux` or `area:cards`
      → `P2`
    - `bug` + any other area → `P3`
    - `enhancement` → `P3`
    - `prd` → no default, listed only
    - `P0` → never written by the machine

    The machine cannot tell "`land` is broken" from "a scorecard column is
    crooked": both are `bug` + `area:workflow`, both default to `P3`, and the
    first is exactly the row a `## Band` line promotes through door three. The
    sibling slices of PRD #4207 build the rule; this ADR states it.

- **The band is derived, not written in code.** `targetBand()` becomes: the
  position of the Target among the NOT completed Targets that carry a
  `priority`, in `priority` order. Today: metagame → `P1`, cube → `P2`,
  `format-premodern` → `P3`; every other `set-*` / `format-*` row has
  `priority: null` and lends no band — which also ends the undifferentiated
  `P3` that held the premodern pool beside every other set and format. The
  `tier1-*` lists stop lending `P1` (they are subsets of the metagame).
- **`completed` is computed, never typed**: the three conditions of the gate
  (playable, Coverage Invariant, Bot-play), printed by one status command. When
  the metagame turns `completed`, the next `backlog:triage --write` lifts the
  cube to `P1` and the pool to `P2` with no code change.
- **Umbrellas are named after their Target, not their band** ("Grammar Rules —
  premodern-metagame"); the umbrella's board value follows its Target and the
  children inherit it as they do today, so a band shift re-parents nothing. A
  gap that serves several Targets lives under the strongest one not completed.

This is a small build (registry-derived band, the status command, the umbrella
rename) and it goes BEFORE the re-banding of the stale roots, so the roots are
not banded twice. The re-banding itself is one owner session over the ~20 root
issues that lend a band by inheritance, then `backlog:triage --write`; the
residue (240 issues on 2026-09-20) is ruled by `## Band` lines in batches
(issue #4202), in parallel, and blocks nothing — the default fills the rest.

### Format Tiers

What a player is told about a format is derived from the Target registry,
never set by hand: **Supported** (its Target is `completed`), **Beta** (a
registered Target at 85% playable or more — "Beta — N of 542 cards"),
**Experimental** (everything else). At launch: Premodern Supported, Vintage
Cube Beta.

### What is NOT fixed here

**The numbers of the medium and long term.** The clause census puts the
premodern pool near 45% `ready` at 800 rules, and 72% of blocking clause shapes
match no known verb rule: the lever past that point is unknown. This ADR
therefore gives `format-premodern` a gate of SHAPE (`completed`, as above) and
no number. It is amended — a dated section in this file, not a new ADR — at the
2026-10-19 revisit or when the effect-verb lever is identified, whichever comes
first.

### Re-measure

Every two weeks from 2026-10-04, with the existing commands
(`oracle:report --targets`, the grammar/card PR count, the whole-Target Bot
sweep), as a comment on issue #3854 (closed; it stays the roadmap's log). A block of more than two days on the critical track waiting for the
owner slips the forecast by as much, declared at the next re-measure.

## Consequences

- The board says what the roadmap says: reading `P1` is reading the short
  term. The price is that a PRD the owner cares about but that is not on the
  road (Shortcut, replacement ordering, Preparation) loses its band and must be
  argued back in by a `## Band` line (the `user-decision` source).
- Completing a Target is an operation (`backlog:triage --write`), not a
  re-planning session.
- The v1 promise is narrow by construction — Premodern, a Bot that plays every
  card — and every other format wears its tier until its Target completes.
- A Bot that plays every card badly would pass the gate. Accepted: the
  strength loop has no corpus to set a threshold from, and ADR 0138's number
  is printed from the first Promotion on.
- Pool completeness remains the differentiator against permissive parsers, but
  it is now explicitly a medium-term claim with no date.

## Alternatives considered

- **A literal "zero ignored" Bot gate.** Unreachable by construction (the
  harness-bound cards) and it would spend valuation fixes on artefacts of the
  sweep's one position.
- **Waiting for 2026-10-19 to write this with v2's numbers.** It would hold the
  short term — which IS measurable — hostage to the term that is not.
- **An exit threshold as a pool `ready` percentage.** The charting-time idea;
  superseded once v1 became a Target List and the two gap sets proved disjoint.
- **Band-named umbrellas kept, children re-parented at each shift.** Dozens of
  edits per shift for no information the Target name does not already carry.
- **A `Wave` or milestone field on the board.** Rejected by issue #3851 and
  again here: the band already is the milestone.
- **A parallel urgency axis for bugs (a second board field).** Rejected for
  `Wave`'s reason: `Priority` is the zeroth key of `queue:plan`, and two
  meanings on one key make the planner arbitrate a comparison nobody defined.
  A bug earns its band through the v1 gate instead.
- **A `P2` cap on the residue**, keeping `P1` single-meaning. Put and
  declined (§ Bands follow the Targets): the owner wants the override.
