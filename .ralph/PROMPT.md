# Ralph loop — Tolaria

You are operating inside an autonomous loop. Treat this file as your full brief on every iteration. Do exactly the steps below, in order.

You start each iteration on `main` with a clean working tree.

## Mission

Pick the next eligible `ready-for-agent` issue from GitHub, implement it end-to-end, commit, open a PR, flip the label to `ready-for-human`, and return to `main`.

## Repository

- Tracker: GitHub Issues on `fil-donadoni/tolaria`.
- Main branch: `main`.
- Parent / PRD issue to NEVER touch: `#1`.
- Domain rules: read `CLAUDE.md` and `.claude/rules/*.md`. Honor `docs/adr/*.md` in the area you touch.

## Step 0 — Recover leftover state

A previous iteration may have been interrupted (Ctrl-C, crash, network failure). Before picking a new issue, reconcile any leftover state. Skip this step entirely if there is nothing to clean up.

Run:

```bash
git branch --list 'issue-*' --format='%(refname:short)'
```

For each leftover local branch `issue-<N>-<slug>`, derive its state from three signals:

1. **Commits ahead of `main`**: `git rev-list --count main..issue-<N>-<slug>`
2. **Remote PR**: `gh pr list --repo fil-donadoni/tolaria --head "issue-<N>-<slug>" --state all --json number,state,url --jq '.[0]'`
3. **Issue label**: `gh issue view <N> --repo fil-donadoni/tolaria --json labels --jq '[.labels[].name]'`

Then act per the table:

| Commits ahead | Remote PR     | Issue label       | Resume from         | Cleanup                                        |
| ------------- | ------------- | ----------------- | ------------------- | ---------------------------------------------- |
| 0             | none          | `ready-for-agent` | nothing to resume   | `git branch -D issue-<N>-<slug>`               |
| ≥1            | none          | `ready-for-agent` | Step 6 (push + PR)  | after Step 7, `git branch -D issue-<N>-<slug>` |
| ≥1            | open          | `ready-for-agent` | Step 7 (label flip) | `git branch -D issue-<N>-<slug>`               |
| any           | open          | `ready-for-human` | already done        | `git branch -D issue-<N>-<slug>`               |
| any           | merged/closed | any               | already done        | `git branch -D issue-<N>-<slug>`               |

Hard rules during recovery:

- Never run `git commit --amend` on a recovery branch — the commit may already be on a PR.
- Never force-push during recovery — if the remote branch diverges, print `<promise>HALT</promise>` with a one-paragraph explanation and exit.
- If the recovery state does not match any row above (e.g. dirty stash, detached HEAD, multiple commits in unexpected shape), print `<promise>HALT</promise>` and exit.
- If multiple leftover branches exist, recover them oldest-first by issue number, one full pass each.
- Always `git checkout main` between branches and after the last recovery.

After all leftovers are resolved, continue to Step 1.

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

## Step 5b — Rebase on latest main

Main may have advanced while you were implementing (e.g. a previous PR was merged). Rebase to avoid conflicts on the PR:

```bash
git fetch origin main
git rebase origin/main
```

If conflicts arise during rebase:

- Resolve them, then re-run quality gates (Step 4).
- If after 2 attempts the conflicts are unresolvable, print:

    ```
    <promise>HALT</promise>
    ```

    with a one-paragraph explanation of what conflicted and why. Then `git rebase --abort` and exit. Leave the branch local for inspection — do NOT push.

## Step 6 — Push + PR

```bash
git push -u origin "issue-<N>-<slug>"
gh pr create --base main --head "issue-<N>-<slug>" \
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

## Step 7 — Hand off

```bash
gh issue edit <N> --repo fil-donadoni/tolaria \
  --remove-label ready-for-agent \
  --add-label ready-for-human
```

Print: `✓ Issue #<N> handed off as PR <URL>. Returning to main.`

Then `git checkout main`. Exit cleanly — the outer loop starts the next iteration on a fresh `main`.

## Hard rules

- Never push to `main` directly.
- Never force-push.
- Never use `--no-verify`, `--no-gpg-sign`, or any hook-skip flag.
- Never auto-merge a PR — a human does QA and merges.
- Never launch Chrome or the dev server (Chrome verification is on-demand only per `CLAUDE.md`).
- Never edit files under `.ralph/` from inside the loop.
- Never touch parent PRD issue (`#1`).
- If `git status` is dirty at the start of step 1, print `<promise>HALT</promise>` with a one-paragraph explanation and exit.
