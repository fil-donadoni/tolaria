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

- Clean working tree.
- On `main`, or on a leftover Ralph branch (`issue-<N>-*`) — the script auto-checks out `main` in that case so Step 0 inside the loop can reconcile state.
- `gh auth status` OK (read+write issues, push branches).
- `claude` CLI in PATH.
- GitHub labels exist: `ready-for-agent`, `ready-for-human`.
- All gates currently green on `main`: `bun run check:all` and `bun run test`.

## Recovery

If a previous iteration was interrupted (Ctrl-C / crash), the next run reconciles automatically:

1. `ralph.sh` switches to `main` when the current branch matches `issue-<N>-*` and the tree is clean.
2. Step 0 in `PROMPT.md` inspects every leftover `issue-*` local branch and derives the right resume point from (commits-ahead, remote PR state, issue label). See the table in `PROMPT.md`.

A non-Ralph branch (anything not matching `issue-<N>-*`) still aborts the run — that protects in-progress user work.

## Eligibility rule

An open issue is eligible iff:

1. label includes `ready-for-agent`
2. number != 1 (parent PRD)
3. every `#N` in its `## Blocked by` section is closed

Picked oldest-first by number.

## Sliced refactors with a hot file

A "sliced refactor" is a multi-issue feature where each slice touches the
same hot file (e.g. `convex/gre/phases.ts` during the untap-restriction
migration: #23 → #24 → #25 → #26). Naive parallel execution opens each
slice's branch from main at issue-creation time, then every subsequent
merge invalidates the others, producing inevitable conflicts that Ralph
cannot self-resolve.

Convention:

1. **Identify hot files at parent-PRD time.** When the umbrella issue
   names a single file every slice will touch, flag it explicitly in the
   PRD (`## Hot files: convex/gre/phases.ts`). The next slice cannot be
   eligible until its predecessor merges.
2. **Sequential ordering on hot files.** Add `## Blocked by: #<prev>` in
   each slice's PRD so the eligibility rule (point 3 above) automatically
   serializes them. The umbrella PRD's slice table is the source of
   truth.
3. **Stacked PRs are the alternative** when latency matters more than
   review simplicity: branch S(N+1) off S(N) rather than off main. PR
   base = previous branch. When S(N) merges to main, S(N+1) auto-rebases
   onto main and conflicts only on real content overlap. Use this for
   long chains (≥4 slices) where waiting for sequential merges is
   wasteful.
4. **Disaggregate the hot file** if the same file appears as hot in ≥3
   consecutive refactors. Extract per-family primitives (one file per
   restriction family, one file per trigger family) so future slices
   touch disjoint files. One-time cost, permanent benefit.
5. **Combined PR** is acceptable only when two adjacent slices are
   trivially small (≤2 files each) and review burden is negligible —
   prefer it over an exotic dependency dance.

Default: option (1)+(2) — sequential, with `Blocked by` markers. Option
(3) is the escape valve. Options (4) and (5) are situational.

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

## Live output

Each iteration tees Claude's stdout to both the terminal and `iter-<n>-<ts>.log` in real time. Claude is invoked with `--verbose`, so tool calls and assistant turns stream as they happen — not only the final response.

If output looks chunked (block-buffered) instead of streamed, opt in to a pseudo-TTY wrapper:

```bash
RALPH_PTY=1 bash .ralph/ralph.sh
```

This wraps Claude in `script -q /dev/null` so it sees a TTY and flushes per line. Off by default because `script` has BSD/macOS/Linux variants that occasionally interfere with stdin redirection.

Alternative: leave Ralph running and `tail -f .ralph/logs/iter-*.log` in a second terminal.

## Tuning knobs

| knob            | location              | default                      |
| --------------- | --------------------- | ---------------------------- |
| max iters       | `RALPH_MAX_ITERS` env | 15                           |
| live TTY        | `RALPH_PTY` env       | `0` (off)                    |
| done sentinel   | PROMPT.md + ralph.sh  | `<promise>NO_WORK</promise>` |
| halt sentinel   | PROMPT.md + ralph.sh  | `<promise>HALT</promise>`    |
| QA target label | PROMPT.md step 7      | `ready-for-human`            |
| pickup label    | PROMPT.md step 1      | `ready-for-agent`            |
| tracker         | PROMPT.md (all `gh`)  | `fil-donadoni/tolaria`       |
| permission mode | ralph.sh              | `acceptEdits`                |
