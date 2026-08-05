# Claim collisions and stalled subagents

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered when a claim probe trips, a branch/worktree already exists, or a subagent has gone quiet.
Every rule here exists because several loops run under the SAME GitHub account, so an assignee tells
you nothing about WHICH session owns an issue.

---

**Collision detection is by label + branch/PR existence — NEVER by assignee.** Multiple loops commonly run under the **same GitHub account**, so both appear as the _same_ assignee: an assignee check can never tell "me, this session" from "me, another session" and will pass a collision straight through. The reliable signals that a live session **already owns** an issue are, in priority order:

1. a `feat/issue-N` / `fix/issue-N` **branch already exists** on the remote, or
2. an **open PR** already targets that issue, or
3. the `in-progress` label was **already present before you added it**.

`git ls-remote` / `gh pr list` are the ownership tokens because a subagent creates the branch early (the worktree step below) — that branch creation, not the label, is the atomic claim.

**Read-before-write.** For each `#N`, probe BEFORE writing the label:

```bash
gh label create in-progress --color FBCA04 --description "Claimed by an agent currently working it" 2>/dev/null || true

# collision probe (read-only — no writes yet)
git ls-remote --heads origin feat/issue-N fix/issue-N   # branch present? (a PR can't exist without its head branch, so this subsumes the open-PR check)
gh issue view N --json labels -q '[.labels[].name]'     # is in-progress ALREADY here?
```

- **Any signal present** (branch exists, open PR exists, or `in-progress` already there) → **another session owns it.** Do NOT add the label, do NOT spawn a subagent, drop `#N` from the batch, re-select from the top. **Never touch that issue's label / branch / worktree / PR** — they belong to the other session, and the shared assignee means removing the label would unclaim _their_ work.
- **All clear** → claim it, then re-probe once to catch a competitor that raced you between probe and write:
    ```bash
    gh issue edit N --add-label in-progress --add-assignee @me
    git ls-remote --heads origin feat/issue-N fix/issue-N   # did a branch appear meanwhile?
    ```
    If a branch/PR appeared in the interim, the other session created the branch first and wins → drop `#N` and **leave the label as-is** (it is correctly "in progress" for them; do not remove it — the shared account means your `--remove-label` would clear their flag too).

The atomic tiebreak is the branch: even if both sessions pass the probe and both add the label, only one subagent's `git worktree add -b feat/issue-N` succeeds (`references/subagent-brief.md`, step 1) — the other gets `branch already exists` and **must abort as a collision** (not resume it as a WIP). See that brief.

Track **every claimed issue in the batch** — each one, on every exit path (merge, failure, interrupt, dependency-skip), must be released (see SKILL.md § Release). A claim you dropped because another session owns it is **not** yours to release — leave its label/branch/PR untouched.
