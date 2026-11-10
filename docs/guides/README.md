# Guides

**Start here when the question is "how do I run this?"** — as opposed to "why
is it built this way?" (`docs/adr/`) or "what does this term mean?"
(`GLOSSARY.md`).

Everything under `docs/guides/` is written for a human at a terminal: the
commands, in order, with the failure modes named. Nothing here is loaded into
an agent's context automatically — these are read on demand.

## The guides

| Guide                                                 | Answers                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [next-ticket flow](next-ticket-flow.md)               | The pipeline drawn: one session's stages, the queue, batch health and a RED, the AFK dispatcher                                                                                                               |
| [Land and release](land-and-release.md)               | Ship a change: `wt:new`, the PR, `land:ready` to the merge queue; then `release` to production — every phase, every refusal                                                                                   |
| [Browser verification](browser-verification.md)       | Prove a UI change renders: CDP tooling, the viewport matrix, the occlusion probe, the receipt                                                                                                                 |
| [UI runbooks](ui-runbooks.md)                         | Click sequences: solo game from cold, the active-game blocker, deck builder, debug scenarios                                                                                                                  |
| [Bot glossary](bot-glossary.md)                       | The play-Bot's jargon explained for newcomers: search terms (prior, FPU, leaf, rollout), scoring, deck knowledge, Verdicts, held-out agreement, test positions, ladder                                        |
| [Verdict Store](verdict-store.md)                     | Provision the private GCS bucket the Verdict corpus lives in: its two service accounts, where each key lands, how to check the bucket is private                                                              |
| [Catalogue cloud latency](catalogue-cloud-latency.md) | Measure what a request pays for the packed catalogue on Convex cloud: create a throwaway deployment, sweep block sizes, read the verdict, delete the project                                                  |
| [Bot fault repro](bot-fault-repro.md)                 | Reproduce a `[Bot Fault]` issue: `bug-report:pull <reportId>` lowers the row's frozen state to a `ScenarioSpec`, with its `dropped[]` and the client diagnostics                                              |
| [Bot reachability](bot-reachability.md)               | Prove a new card/mechanic is one the Bot can actually PLAY: the three seams, what the existing guards are blind to, what to declare in the PR                                                                 |
| [Runner machines](huawei-runner.md)                   | Set up the Huawei for the batch gates (logind, Playwright, GNU time), its Convex unit and the crons                                                                                                           |
| [Oracle compiler](oracle-compiler.md)                 | Read the grammar backlog: `oracle:report --frames`, the one class-keyed table of what unlocks how many cards, its `--delta` and dated snapshot                                                                |
| [GitHub pipeline](github-pipeline.md)                 | The GitHub-native AFK stack (ADR 0156, PRD #5620): self-hosted runners and their labels, `bun run runner install` / `pause` / `resume`, the repository settings checklist — updated by every slice of the PRD |

## The rest of the map

Not every document is a guide. Where to look for the other kinds:

| You want                                            | Look in                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The norms an agent must follow                      | `CLAUDE.md`, `.claude/rules/**` (both loaded into every session automatically)                                               |
| Why a decision was made                             | `docs/adr/` — index at `docs/adr/README.md`                                                                                  |
| Domain vocabulary                                   | `GLOSSARY.md`                                                                                                                |
| What the quality gates are and why                  | `docs/agents/quality-gates.md`                                                                                               |
| Which docs a change owes, and why prose enforces it | `docs/agents/docs-follow-the-change.md`                                                                                      |
| How the issue queue and its labels work             | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`                                                               |
| What the loop costs, measured                       | `docs/agents/workflow-token-economics.md`                                                                                    |
| How to watch or stop the AFK passes                 | the Actions tab, `bun run cockpit`; `bun run runner pause` / `resume` per machine ([GitHub pipeline](github-pipeline.md))    |
| What a subagent noticed but was not asked to fix    | `docs/findings/` — read with `bun run findings`                                                                              |
| What decks the draft Bot builds, measured           | `bun run draft:audit -- --scope <scope> [--seeds <n>]`; baseline and Floors in `docs/research/draft-table-audit-baseline.md` |
| The workflow skills themselves                      | `.claude/skills/<name>/SKILL.md` (invoked as `/<name>`)                                                                      |

## Every guide carries a glossary

**A reader must be able to resolve an unfamiliar term in zero time, at whatever
point in the prose they hit it.** So every guide here ends with a `## Glossary`
section defining its own jargon, and **every occurrence of a defined term in the
body links to its entry** — not just the first one. Markdown has no footnotes;
in-page anchors are the mechanism:

```markdown
The [dispatcher](#g-dispatcher) starts one job per free slot.

## Glossary

### <a id="g-dispatcher"></a>Dispatcher

`scripts/afk-dispatch.ts` — the job that starts one pass per free runner…
```

Three rules that make it work rather than decorate:

1. **Explicit `<a id="g-term"></a>` anchors**, prefixed `g-`. Auto-generated
   heading anchors collide with body headings of the same name; these do not.
2. **Every instance links**, because a reader who skipped the first mention is
   exactly the reader who needs the link. Linking only the first occurrence
   optimises for someone reading top to bottom, which is not how a guide is used
   at 2am.
3. **Define the term, not the tool.** A glossary entry says what the thing IS and
   why it exists in one or two sentences — "the file that records this checkout
   may run unattended" — never a copy of the command reference above it.

Census the terms when you write the guide, and again when you edit it: a term
introduced by an edit and never linked is the failure mode this rule exists to
prevent.

## Adding a guide

A guide belongs here when a human would otherwise have to reconstruct a
procedure from a script's source or a skill file. Write it, add its row to the
table above, give it a glossary per the section above, and ship it through the
documentation lane:

```bash
bun run wt:docs <slug>     # worktree + branch off origin/<base> (tolaria.config.json)
… write …
bun run docs:ship          # check:docs → PR → merge
```
