# A Bot Audit hunts the Evaluation's blind spots as Minimal Pairs: forced-loss pairs become `stretch` Test Positions with one issue per cause, preferences become reviewer-attested Verdicts for the fit

## Status

accepted — grilled 2026-09-30 ("qualita' bot" session). Extends ADR 0124 §5
(Verdicts → fit → report), ADR 0141 §7 (a non-sweep finding owes a
Reproducer), ADR 0070 (`stretch` with its cause classified) and ADR 0148
(a Conditional Verdict owes a Minimal Pair).

## Context

The Bot's knowledge is a deterministic Evaluation plus ISMCTS search; the
project measured, more than once, that a learned model would not pay for
itself (ADR 0124, ADR 0138). What teaches the Evaluation is a corpus of human
Verdicts, and the census (`docs/research/verdict-corpus-coverage.md`) says
where that corpus is silent: zero judgements with a non-empty Stack, zero
targeting, zero mulligan, combat at 21 pairs. Humans judge what they happen
to play.

On 2026-09-30 one session started from one defect and, by READING the
Evaluation's seams rather than playing, found eight more — issues #4896 to
#4904: a probe that stops at the opponent's choice, a flat sacrifice cost,
a `mayPay` exemption, a type-blind Representative Victim. Different cards,
different Decision Classes, one method: walk a seam, ask "what does this term
not read?", build the position that proves it. Nothing in the workflow
institutionalised that method. Every one of those issues was filed on an
argument from the code; none carried a position that had been run and seen
to fail, which is the standard ADR 0141 §7 and proof-of-failure already set
for a finding from any source but the sweep.

Three forces bound the design. **A chosen move is not a right move** (ADR
0129), so an agent's judgement is worth no more than a player's until a
person stands behind it. **The `must` tier admits only a forced loss** (ADR
0070, ADR 0138): half of the questions worth asking — play the tapped land
in the idle turn, kill the planeswalker or the player, a counterspell that
becomes a cycler late — are preferences that can never gate, and a preference
frozen as a Test Position would sit red forever. **The loop drains the queue
and never fills it** (`docs/findings/README.md`): an agent filing its own
work removes the one place a human sets direction.

## Decision

1. **A Bot Audit is a session, seeded with one Audit Theme** — a Decision
   Class crossed with one family of mechanics, from a closed list — or with a
   free question the agent maps onto a theme. Inside the theme the agent reads
   the seams that theme crosses (`evaluate.ts` terms, `OP_VALUERS` /
   `OP_BENEFICENCE`, `aiEffects`, `enumerateMoves`, the probes) and turns each
   suspicion into a **Minimal Pair**: two positions differing by one
   Discriminant, opposite answers. A single entry proves nothing about WHY;
   the pair is the argument (ADR 0148). An Absolute Verdict is the declared
   exception.
2. **Every pair is run through the real search before anyone sees it**
   (`runBladeScenario`, declared budget, several seeds). A pair the Brain
   already answers is not shown; a pair that fails only on some seeds is a tie,
   reported as such. Nothing is filed on an argument from the code alone.
3. **Two doors, by kind, decided in the Audit Review.** The reviewer sees one
   row per wrong pair — label, Discriminant, expected and observed move,
   kind, diagnosed cause, proposed issue — and gives one word per row.
    - **Forced loss** (the wrong move loses a creature, the game, something the
      rules force): the pair lands in the registry as a **`stretch` Test
      Position** with its `beyondBudget.cause` classified per ADR 0070
      (`valuation` for a blind term, `branching` / `horizon` /
      `hidden-information` for a search bound) and its issue named. It is red
      in-tree, report-only, from the audit's own PR; the fix PR promotes it to
      `must` and removes the block in the same diff. The reviewer's `ok` is the
      human decision Admission needs, given early.
    - **Preference** (better, not forced): the pair becomes a **Verdict written
      by the agent and attested by the reviewer** through `verdicts:submit`
      under the reviewer's own account, promoted and fitted in the same
      session. An issue for a preference exists only when the Weight Fit's
      report names the Discriminant no term reads — never before, never from
      the code walk.
4. **One issue per diagnosed CAUSE, never per pair** (ADR 0102, ADR 0146): a
   missing Evaluation term, a blind valuer, a Move never enumerated, a probe
   that stops. The issue carries a `## Test Positions` block naming the
   entries it owes, and its acceptance is mechanical: those entries pass at
   their declared budget as `must` and `blade:robustness` classifies them
   `robust`. A pair whose cause the session cannot diagnose stays `stretch`
   with `note: cause undiagnosed` and is listed under the programme's
   umbrella, not ticketed.
5. **The theme is data.** `BladeScenario.audit?: { theme }` names the Audit
   Theme, from a closed list checked by a test, so coverage is a typed census
   (themes × pairs × red/green) the skill prints on opening, never a ledger.
6. **Filing happens after the Audit Review, never by the agent alone.** The
   session is triggered by hand (`/bot-audit [theme | question]`); `land`
   suggests one — a line, no enforcement — when a landed PR moved the fitted
   weights or brought a new set. One theme per session, on the order of
   4–8 red pairs: the reviewer's attention is the bottleneck, so three short
   sessions beat one long one.

## Considered options

- **Issues alone, as on 2026-09-30.** Cheapest, and half of them would be
  "plausible, never reproduced" — bot-slice Phase 0's own warning. Rejected
  on ADR 0141 §7.
- **The pair inside the issue body, entering the registry only with the fix.**
  No red in the tree, but a spec in prose rots (card names, spec fields) and
  no signal fires when an unrelated fix turns it green. Rejected: the
  registry is the coverage map only if the pair lives there.
- **Agent-attested Verdicts.** Attestation is a person by definition
  (ADR 0128); an agent's word would be fitted as a player's. Rejected.
- **Widening Admission to fixed preferences.** Rewrites ADR 0070 / 0138 for
  the audit's convenience; a gate on "better on average" is a gate on rollout
  noise. Rejected.
- **A scheduled audit.** Fills the queue without a human, against the
  findings-drawer contract. Rejected; event-suggested, hand-run instead.

## Consequences

- The `stretch` tier gains a second population beside "beyond budget":
  known Evaluation gaps with an issue each. Its meaning holds only while
  every audit entry names its issue and its theme; a bare `stretch` entry
  from an audit is a review defect.
- Verdicts written by an agent enter the Verdict Store under the reviewer's
  attestation. The store records only who attested; the audit's session note
  is the provenance. A reviewer who attests without looking has signed a
  Verdict as their own.
- The Weight Fit becomes the filer of preference issues: a preference gap the
  fit CAN satisfy with existing terms is not a gap and gets no ticket.
- One umbrella holds the programme; every cause issue is its sub-issue; the
  umbrella body lists the undiagnosed pairs.
- Owed by the first ticket: the `/bot-audit` skill, the `audit` field and its
  closed theme list with the guard test, the `land` suggestion line.
