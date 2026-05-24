# Ralph loop — Tolaria

You are operating inside an autonomous loop. Treat this file as your full brief on every iteration. Do exactly the steps below, in order.

You start each iteration on `main` with a clean working tree. The loop stacks PRs: `main` may already contain commits from prior iterations (merged locally only). The env var `$RALPH_PREV_BRANCH` holds the previous iteration's branch name (empty on the first iteration).

## Mission

Pick the next eligible `ready-for-agent` issue from GitHub, implement it end-to-end, commit, open a PR, flip the label to `ready-for-human`, and return to `main`.

## Repository

- Tracker: GitHub Issues on `fil-donadoni/tolaria`.
- Main branch: `main`.
- Parent / PRD issue to NEVER touch: `#1`.
- Domain rules: read `CLAUDE.md` and `.claude/rules/*.md`. Honor `docs/adr/*.md` in the area you touch.

## Step 1 — Pick the next issue

Run:

```bash
gh issue list --repo fil-donadoni/tolaria \
  --state open --label ready-for-agent \
  --json number,title,body --jq 'sort_by(.number)'
```

Walk candidates in order. For each:

1. If `number == 1` → skip (parent PRD, never picked).
2. Parse the `## Blocked by` section in `body`.
    - If it contains `None` (case-insensitive) → eligible.
    - Else extract every `#<N>` reference. For each blocker, run `gh issue view <N> --json state`. If any blocker is still `OPEN` → skip this candidate.
3. First eligible candidate wins.

If no candidate is eligible (or the list is empty), print exactly the line:

```
<promise>NO_WORK</promise>
```

and exit immediately. Do not continue to step 2.

## Step 2 — Branch

From `main`:

```bash
git checkout -b "issue-<N>-<slug>"
```

`<slug>` = first 4-6 lowercase-kebab words of the issue title, no punctuation. Example: issue 6 "Slice 5: enteredTrigger factory + migrate LEA ETB-triggers" → `issue-6-slice-5-enteredtrigger-factory-migrate`.

## Step 3 — Implement

Read the issue body fully. Follow `CLAUDE.md`, `.claude/rules/gre-development.md`, `.claude/rules/frontend-components.md`, and relevant ADRs.

Honor the acceptance criteria literally. Do NOT modify the parent PRD (#1) or other open issues. Do NOT edit `.ralph/`.

If the issue touches `convex/gre/**` or `convex/cards/**`: CR references in code comments are mandatory (per `gre-development.md`).

If the issue touches new cards: every card with non-trivial behavior gets a dedicated `describe` block in the parallel test file of its set (see `gre-development.md` "Card testing convention").

## Step 4 — Quality gates (mandatory, in order)

```bash
bun run check:all
bun run test
```

Both must pass with zero errors / zero failures.

If a gate fails:

- Fix the cause. Do not bypass it (`--no-verify`, `eslint-disable`, skipped tests, `xfail`, `as any` to silence types).
- If after 3 honest attempts you still cannot make them pass, print:

    ```
    <promise>HALT</promise>
    ```

    with a one-paragraph explanation of what failed and why. Then exit. Leave the branch local for inspection — do NOT push.

## Step 5 — Commit

One commit per iteration. Message:

```
<type>: <short summary> (#<N>)

<body explaining why, referencing CR sections / ADRs where relevant>

Closes #<N>

Co-Authored-By: Claude <noreply@anthropic.com>
```

Stage explicitly. Do NOT `git add -A`. List files individually or use targeted paths.

## Step 6 — Push + PR

```bash
git push -u origin "issue-<N>-<slug>"
gh pr create --base "${RALPH_PREV_BRANCH:-main}" --head "issue-<N>-<slug>" \
  --repo fil-donadoni/tolaria \
  --title "<issue title> (#<N>)" \
  --body "$(cat <<EOF
Closes #<N>

## Summary
<one-paragraph summary of the change>

## Test plan
- [x] bun run check:all
- [x] bun run test
- [ ] manual QA in browser (solo mode, preset scenario if relevant)
EOF
)"
```

The `--base` is the previous iter's branch when `$RALPH_PREV_BRANCH` is set, so the GitHub PR diff is scoped to this iter's commits only. When `$RALPH_PREV_BRANCH` is empty (first iter), base is `main`.

## Step 7 — Hand off

```bash
gh issue edit <N> --repo fil-donadoni/tolaria \
  --remove-label ready-for-agent \
  --add-label ready-for-human
```

Print exactly two lines (the loop parses the branch sentinel):

```
<branch>issue-<N>-<slug></branch>
✓ Issue #<N> handed off as PR <URL>. Loop will stack onto local main.
```

Then exit cleanly. Do NOT `git checkout main` — the loop merges your branch into local main with `--no-ff` before the next iteration.

## Hard rules

- Never push to `main` directly.
- Never force-push.
- Never use `--no-verify`, `--no-gpg-sign`, or any hook-skip flag.
- Never auto-merge a PR — a human does QA and merges.
- Never launch Chrome or the dev server (Chrome verification is on-demand only per `CLAUDE.md`).
- Never edit files under `.ralph/` from inside the loop.
- Never touch parent PRD issue (`#1`).
- If `git status` is dirty at the start of step 1, print `<promise>HALT</promise>` with a one-paragraph explanation and exit.
