# Grammar-first authoring: the Oracle Compiler is the authoring path, hand-writing is the Guard C fallback

## Status

accepted — grilled 2026-09-17. Amends ADR 0105 (its § 7 carries the mechanics
this decision needs: quarantine classes, the Bot-play sweep, the derived Op
census). Supersedes the hand-authoring default of `/new-set`, `/new-card` and
`/new-op` as written before this date. Pilot: the Apocalypse rollout (PRD
issue #3795); done-criterion recorded there.

## Context

PRD #2693 built the Oracle Compiler (ADR 0105) and foresaw the migration of
the authoring workflow onto it (its user story 25, "`/new-set` v2 consumes the
per-set unparsed list as its backlog") — and deferred it out of acceptance
without cutting a follow-up. Measured on 2026-09-17: the corpus stood at 2,613
`ready` of 34,890 (7.5 %); ten of the Mechanics Registry's 102 Ops appeared in
a `ready` Compiled Definition and 87 had never been emitted; 156 of the 162
`compiler-gap` markers pointed at the closed PRD; since 2026-08-23 the tree
had 24 commits under `convex/oracle` against 150 under `convex/cards/sets`.
The engine kept growing by hand while the grammar stood still, and every new
Op or cube card widened the distance the compiler would later have to close.

## Decision

The compiler is the way a card enters the catalogue. A card is hand-written
only when the grammar does not reach it, and then under Guard C with a marker
that names an OPEN Grammar Gap issue — hand-writing is the fallback, never the
plan. Concretely:

- **The unit of card work is the Grammar Rule**, not the card: one clause form
  accepted by a slot or a shared sub-grammar, delivered with golden fixtures
  per form (the Oracle text of a real corpus card and the Compiled Definition
  it must produce). Where hand-written gold exists the ≥ 99 % precision gate of
  ADR 0105 § 4 still applies; where it does not, the fixtures are the gold.
- **The backlog is derived, never declared.** Fragments (the lockfile's
  refused lines) are attributed to Grammar Gaps by a compiler-side diagnostic
  and ranked by the cards they unlock in the set being rolled out and across
  the corpus. `/new-set` v2 cuts one ticket per gap; the residue is a queue of
  cards hand-written under Guard C.
- **An implemented Op owns the grammar that emits it.** Coverage is a derived
  census (ADR 0105 § 7.3): an Op emitted by no Compiled Definition must sit in
  an allowlist of Grammar Gaps, each with its issue, and the allowlist only
  shrinks — a new Op never enters it. `/new-op` therefore ends with the rule
  that emits the Op, or with the open gap.
- **Bot reachability is computed, not walked.** Every newly `ready` card is
  played by the Bot at both seats in its generated scenario (ADR 0105 § 7.2);
  `frozen` withholds the card, `ignored` ships it and opens a Bot Gap. Gap
  issues — grammar and bot alike — are filed idempotently by `gaps:sync`,
  run by the authoring skills and by `land` after a merge; `health` verifies
  offline that every gap in the lockfile has its allowlist row and issue.
  This is a deliberate exception to "the loop drains the queue, never fills
  it": these issues come from a computed gate, carry card, form and count, and
  are never a subagent's judgement.

Three guards keep this from becoming Forge (a per-card script language, hand
maintained, ever fatter): the structural grammar of the Effect Script stays
frozen at ADR 0045's four constructs — a Grammar Rule may add Ops, never
constructs; an Op is named and shaped for the mechanic, never for the Oracle
line that asked for it (issue #1917, primitive reuse); and the parser stays
fail-closed (ADR 0105 § 2) — coverage is earned by rules, never by leniency.

## Consequences

- 105 open issues cut for hand-authoring (APC, PLS, INV, Vintage Cube) are
  frozen and rewritten as Grammar Gaps after the pilot; the umbrella scope
  manifests stay valid as inputs.
- The first set pays the grammar; later sets inherit it (the corpus is
  Zipfian per line but compositional per rule — `Enchant creature` alone
  gates 894 corpus cards). Expected per-set `ready` before any new rule is a
  number to measure per set, not a promise.
- Manual play-testing (debug scenarios, blade) stays a verification, not a
  prerequisite: the gap issue exists before anyone opens the client.

## Alternatives considered

- **Keep hand-authoring, use the compiler opportunistically.** Rejected: it is
  the status quo that produced the numbers in Context.
- **One skill (`/new-op`) for Op + grammar.** Rejected: most Grammar Gaps
  need no new Op (keyword parameters, trigger heads, effect clauses on
  existing Ops), so the skill would be the wrong door most of the time.
- **Gate `ignored` as well as `frozen`.** Rejected: it would keep
  human-playable cards out of the catalogue for a valuation defect of the Bot.

## References

- PRD #2693 (Oracle compiler), PRD issue #3795 (APC pilot), issue #3721
- ADR 0045 (frozen structural grammar), ADR 0046 (registry seam), ADR 0105
  (fail-closed compiler, amended), ADR 0110 (single-session pipeline),
  ADR 0116 (health cadence)
- `CONTEXT.md`: Fragment, Grammar Rule, Grammar Gap, Compile State, Round-Trip
