---
name: retro
description: Read a session and propose ranked changes to the agent's environment (checks, pointers, deletions) — not to the code.
disable-model-invocation: true
argument-hint: "[session id or log path — default: this session]"
---

# /retro — a session retrospective that edits the environment

Owner-invoked only. Never part of a driven pass; no other skill invokes it
(PRD #5096 D9). Pruning passes decayed because they were one-off: this is the
standing version. Question per candidate: **which pointer, check or deleted
sentence would have made this session cheaper, or prevented its mistake?**

## Where the evidence is

- **This session**: the conversation in context.
- **A past session**: `~/.claude/projects/-Users-filippo-code-mtg-tolaria/<session-id>.jsonl`
  (the owner names the id or path). Grep it by tool name or `is_error`;
  never `cat` it.
- **Telemetry store**: `.claude/telemetry/telemetry.db` (primary checkout
  only — a worktree has none). `bun run telemetry:context` (per-turn cost,
  context growth by bucket) and `bun run telemetry:latency` read it; read
  those before hand-written SQL.

## Method

1. **Read the existing checks first**: `package.json` scripts,
   `scripts/check-*.ts`, `.claude/hooks/`, `scripts/lib/`, `docs/agents/gre-guards.md`.
   A check that exists but is unwired (not in `check:lane`, `check:guards` or
   a hook) is the finding — never a reinvention.
2. Walk the session for: repeated tool failures, re-reads, hook denials,
   wrong guesses a later turn corrected, large tool results, steps the owner
   had to correct.
3. **Classify BEFORE proposing** (a candidate with no class is dropped):

| Class      | Becomes                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mechanical | a gated script, hook or lint, at the tier its measured cost puts it in (`docs/agents/quality-gates.md` § Guard tier is measured cost). Measure it; state the number |
| judgement  | a standard handed to the reviewer `/next-ticket` spawns (`.claude/skills/next-ticket/SKILL.md` § 4) — never a resident line                                         |
| no-op      | a deletion: an instruction nothing in the session obeyed or needed                                                                                                  |

## Categories — each with its "use when"

- **Navigation pointer** — use when the session searched for a file or
  doc a one-line pointer in a disclosed file would have found.
- **Automated check** — use when a mistake was mechanical and a script,
  hook or lint can refuse it; prefer wiring an existing one.
- **Reviewer standard** — use when the mistake was a judgement a reviewer
  can catch from the diff.
- **Steering out of resident files** — use when a resident line
  (`CLAUDE.md`, `.claude/rules/*`, memory index) served one branch only: move
  it to a nested `CLAUDE.md`, a skill sibling file or `docs/agents/`.
- **No-op instruction** — use when a line was obeyed by nothing or
  duplicates a hook (the hook wins; delete the prose).
- **Tool economy** — use when tool output was large, polled or repeated:
  `--json`/`--jq` fields, output to a file, a cheaper command.
- **Information access** — use when the session lacked a fact it needed
  (log, receipt, id lookup) and a script could surface it.

## Hard rules

- **Never proposes a new resident line, and says so.** A candidate that can
  only be a resident line is reported as **"needs a skill or a check"**.
- **Proposes and stops — the owner picks.** `/retro` files no issue itself and writes no file outside the session scratchpad. What
  the owner picks is filed through the project's filing skill
  (`/create-ticket`) with the stamp in `docs/agents/triage-labels.md`
  § Every new issue is stamped at filing.
- **Ranked by severity, capped**: at most 8 candidates, worst first
  (a mistake that reached a PR > wasted turns > wasted tokens), one line each
  plus a one-line fix, so the report is read in one screen. Overflow is
  named as a count, not listed.

## Output

```
retro <session> — N candidates (M dropped unclassified)
1. [mechanical|judgement|no-op|needs a skill or a check] <category> — <what happened, evidence>
   → <proposed change, tier + measured cost if mechanical>
...
Owner: pick numbers to file.
```

**Done when:** the report is printed and the turn stops.
