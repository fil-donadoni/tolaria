# Ralph operator manual — Tolaria

## What this is

`.ralph/` runs Claude Code in a bash loop. Each iteration: pick one
`ready-for-agent` issue from GitHub, implement it end-to-end, open a PR, flip
the label to `ready-for-human`. Exits when no eligible issues remain or
`RALPH_MAX_ITERS` is hit.

## Run

```bash
bash .ralph/ralph.sh                       # default: 15 iters
RALPH_MAX_ITERS=3 bash .ralph/ralph.sh     # smaller batch
```

Logs land in `.ralph/logs/iter-<n>-<timestamp>.log` (gitignored).

## Exit codes

| code | meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | sentinel `<promise>NO_WORK</promise>` — backlog empty        |
| 1    | precondition failed (dirty tree / not on main / missing CLI) |
| 2    | sentinel `<promise>HALT</promise>` — agent gave up; read log |
| 3    | max iterations reached without `NO_WORK`                     |
| 130  | interrupted (Ctrl-C)                                         |

## Preconditions

- On `main`, clean working tree.
- `gh auth status` OK (read+write issues, push branches).
- `claude` CLI in PATH.
- GitHub labels exist: `ready-for-agent`, `ready-for-human`.
- All gates currently green on `main`: `bun run check:all` and `bun run test`.

## Eligibility rule

An open issue is eligible iff:

1. label includes `ready-for-agent`
2. number != 1 (parent PRD)
3. every `#N` in its `## Blocked by` section is closed

Picked oldest-first by number.

## Hard rules (encoded in PROMPT.md)

- Never push to `main` (PR only).
- Never `--no-verify`, never `--force-push`, never auto-merge.
- Never start Chrome / dev server (Chrome is on-demand only per `CLAUDE.md`).
- Never edit `.ralph/` from inside the loop.
- Never touch parent issue (`#1`).
- Halt cleanly if working tree dirty.

## After a run

1. Review each new PR. Run preset scenario in Debug panel + Chrome if needed.
2. Merge → label cleared on close.
3. If a PR is rejected → address feedback in the issue body, re-add
   `ready-for-agent`, next run picks it back up.

## Tuning knobs

| knob            | location              | default                      |
| --------------- | --------------------- | ---------------------------- |
| max iters       | `RALPH_MAX_ITERS` env | 15                           |
| done sentinel   | PROMPT.md + ralph.sh  | `<promise>NO_WORK</promise>` |
| halt sentinel   | PROMPT.md + ralph.sh  | `<promise>HALT</promise>`    |
| QA target label | PROMPT.md step 7      | `ready-for-human`            |
| pickup label    | PROMPT.md step 1      | `ready-for-agent`            |
| tracker         | PROMPT.md (all `gh`)  | `fil-donadoni/tolaria`       |
| permission mode | ralph.sh              | `acceptEdits`                |
