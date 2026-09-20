# Bot Findings: the measurement is a committed artifact, the proof is per CLASS, a finding's state is DERIVED

## Status

accepted — grilled 2026-09-20 (issue #4149's measurement is its input). Extends
ADR 0105 § 7.2 (the Bot-play sweep) to the hand-written catalogue, and is
bounded by ADR 0102 (fix the class, never the card) and ADR 0124 (a blunder is
a Verdict). The numbers below are that session's, re-derivable with
`bun scripts/target-bot-reach.ts` and `data/oracle-compiled.json`.

## Context

The admin wants one page that answers "which cards can the Bot not play, and
what do I do about it" — and hands the answer to a Claude Code session with a
copy button.

Measured, on `origin/staging` @ `106f6c548`:

| Fact                                                             |                                                          Value |
| ---------------------------------------------------------------- | -------------------------------------------------------------: |
| Corpus cards the Bot-play sweep has ever played                  |                                     3,908 of 34,890 (compiled) |
| Non-`played` verdicts among them                                 | 314 (265 `never-chosen`, 47 `position-unmodelled`, 2 `frozen`) |
| Bot Gap classes carrying them                                    |                                                            120 |
| Hand-written cards in the corpus, never measured                 |                                                          1,712 |
| Whole-Target measurement (`premodern-metagame` + `vintage-cube`) |                                  852 cards, 265 s, 0.31 s/card |
| Same over every hand-written card                                |                                                ~2,050, ~10.6 m |
| Blade entries today                                              |                                     157 (145 must, 11 stretch) |
| `health` batch, end to end                                       |                                                          ~11 m |

Four forces shape the design:

1. **The sweep measures cards; issues are filed per class.** `gaps:sync` files
   one `bot` issue per Bot Gap KEY (`scripts/lib/gap-issues.ts`), labelled
   `ready-for-agent` + `area:game-bot`, and `data/grammar-gaps.json` already
   carries the `{kind: "bot", key, issue}` claims. The page must be per-card —
   that is how the admin thinks ("I want THIS card reliable") — without
   becoming a second filer.
2. **Blade is a curated sample, not a vocabulary.** One entry per fixed CLASS
   keeps it at the order of 120; one entry per card would push it toward the
   corpus and inflate a gated suite. ADR 0102 already forbids the per-card
   registry.
3. **One measurement yields one class per card.** `playBotReach` stops where
   the card stops, so a second blocker behind the first is unknowable until
   the first is closed. A "chain of problems" column would be a fabrication.
4. **A human report is not a Gap.** `CONTEXT.md` reserves Gap for what the
   tooling computed. User-observed bot defects are real but need a different
   admission rule, or the page fills with rows nobody can action.

## Decision

1. **The unit is a Bot Finding**, keyed `(oracleId, source)`: one row per card
   per source, so a measured finding and a human report on the same card never
   overwrite each other. `oracleId`, not a print id — a print is not a card.
2. **The row shows the FIRST VISIBLE blocker, and no history.** One class per
   finding, the current one. Past classes are not carried in the DB or the UI;
   the committed artifact's `git log` holds them for whoever wants them.
3. **The state is derived from two independent facts** — the CLASS's proof and
   the CARD's measurement — and there is no "mark as resolved" button:

    | state             | class has a green `must` blade entry | card's last measurement                        |
    | ----------------- | ------------------------------------ | ---------------------------------------------- |
    | `open`            | no                                   | not `played`                                   |
    | `class-fixed`     | yes                                  | not `played`                                   |
    | `played-unproven` | no                                   | `played`                                       |
    | `resolved`        | yes                                  | `played`                                       |
    | `harness-bound`   | —                                    | cause is `no-progress` / `position-unmodelled` |

    `class-fixed` is the point of the table: it is the evidence that a class fix
    did not generalise, which is the failure mode ADR 0102 exists to catch.
    `harness-bound` owes the SWEEP a better position, never the Bot a fix, and
    is outside the "to fix" count.

4. **The measurement is a committed artifact** (`data/bot-reach-findings.json`:
   one row per card, plus the `sha` and `botHash` it was produced under), seeded
   into Convex by one writer. Measured fields belong to the artifact and are
   rewritten on every sweep; human fields (note, reproducer, linked issue,
   snooze) are never touched by an upsert. The artifact is diffable in a PR; the
   DB is the live view — the `cardProfiles` / `cardRatings` precedent.
5. **Refresh runs on `health`, never on `check:pr` or `land`**, and only when
   the batch's diff touched `BOT_GLOBS`. With the lockfile's own cache rule
   (reuse a verdict while definition AND bot hash are unchanged) an untouched
   Bot costs ~10 s; a touched one costs 265 s — paid exactly on the batches
   whose verdicts would otherwise be false. Scope stays the registered Targets;
   the whole hand-written catalogue would double `health`.
6. **`gaps:sync` remains the only filer.** The dashboard links the class's
   existing issue and never creates one. The findings artifact becomes an
   additional INPUT of that filer, so classes discovered on hand-written cards
   get an issue and an allowlist row like every other Gap.
7. **A non-sweep finding is admissible only with a Reproducer** — a blade entry
   or a saved scenario, named by label. Without one it waits in triage, visible
   but outside every count and without a copy button. Same standard as
   proof-of-failure.
8. **Verdicts are not joined in v1.** A Verdict judges a POSITION; the
   position→card join does not exist and is a project of its own. A Verdict
   enters the dashboard the same way any observation does: as a Reproducer.
9. **The copy payload depends on the row's state.** With an issue:
   `/next-issue <N>` plus the context the issue cannot carry (card in focus,
   reproducer label, measurement sha and bot hash) and one line naming how the
   loop closes (blade entry for the class, then re-measure). Without an issue:
   a filing-ready brief whose cause prose is READ from `gap-issues.ts`, never a
   second copy of it.
10. **Snooze with a mandatory reason is the only human state.** "In progress"
    is not duplicated — the GitHub issue already says it.

## Consequences

- The dashboard can be wrong only by being STALE, never by being invented: a
  row is a measurement plus a proof, both dated.
- A `resolved` row is one nobody can produce by clicking. The cost is that a
  genuinely fixed card stays visible until the next `health` re-measure.
- Blade grows by classes, not cards — bounded by the 120 open classes, and
  shrinking as fixes generalise.
- The page's headline number is honest and small: it counts the measured
  Targets (852 cards), not the catalogue. The unmeasured 1,712 hand-written
  cards are stated, not hidden.
- Extending the measurement to the whole catalogue is a config change, not a
  redesign — at the cost of ~10.6 m per `health` batch that touches the Bot.

## Alternatives rejected

- **A human `reviewed` flag to close a row** (the `cardProfiles` precedent):
  cheap, and it proves nothing — the flag is exactly the artefact this ADR
  exists to avoid.
- **One blade entry per card**: would make every row self-proving, at the price
  of a 35k-entry registry inside a gated suite, and against ADR 0102.
- **Enumerating every class that blocks a card**: impossible for
  `never-chosen` — a card the Bot does not choose has no follow-through to
  observe — so the list would look complete while being partial.
- **A second filer on the page** ("open issue" button): duplicate issues on one
  class within weeks, and it breaks the one-filer invariant in `CONTEXT.md`.
- **A nightly cron re-measure**: always fresh, but spends CPU on a shared
  machine nobody asked for and keeps the measurement out of PR review.
