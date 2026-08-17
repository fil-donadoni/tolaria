# Guides

**Start here when the question is "how do I run this?"** — as opposed to "why
is it built this way?" (`docs/adr/`) or "what does this term mean?"
(`CONTEXT.md`).

Everything under `docs/guides/` is written for a human at a terminal: the
commands, in order, with the failure modes named. Nothing here is loaded into
an agent's context automatically — these are read on demand.

## The guides

| Guide                                           | Answers                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [AFK loop](afk-loop.md)                         | Run the queue unattended: `bun run loop:afk`, monitoring, stop reasons, what to fix by hand   |
| [Browser verification](browser-verification.md) | Prove a UI change renders: CDP tooling, the viewport matrix, the occlusion probe, the receipt |
| [UI runbooks](ui-runbooks.md)                   | Click sequences: solo game from cold, the active-game blocker, deck builder, debug scenarios  |

## The rest of the map

Not every document is a guide. Where to look for the other kinds:

| You want                                         | Look in                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| The norms an agent must follow                   | `CLAUDE.md`, `.claude/rules/**` (both loaded into every session automatically) |
| Why a decision was made                          | `docs/adr/` — index at `docs/adr/README.md`                                    |
| Domain vocabulary                                | `CONTEXT.md`                                                                   |
| What the quality gates are and why               | `docs/agents/quality-gates.md`                                                 |
| How the issue queue and its labels work          | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`                 |
| What the loop costs, measured                    | `docs/agents/workflow-token-economics.md`                                      |
| What a subagent noticed but was not asked to fix | `docs/findings/` — read with `bun run findings`                                |
| The workflow skills themselves                   | `.claude/skills/<name>/SKILL.md` (invoked as `/<name>`)                        |

## Adding a guide

A guide belongs here when a human would otherwise have to reconstruct a
procedure from a script's source or a skill file. Write it, add its row to the
table above, and ship it through the documentation lane:

```bash
bun run wt:docs <slug>     # worktree + branch off origin/main
… write …
bun run docs:ship          # check:docs → PR → merge
```
