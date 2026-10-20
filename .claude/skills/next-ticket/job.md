# /next-ticket — inside an `afk-pass` job

Reached from `SKILL.md` when `GITHUB_ACTIONS=true` (an `afk-pass` job, ADR
0156, `docs/guides/github-pipeline.md` § A pass inside a job). An attended
terminal never has that variable and follows `SKILL.md` as written; nothing
here changes it. A job differs in five places, and ONLY these:

| Step                | Attended                                          | In a job                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| § 0 Pick            | `queue:plan`, or `/next-ticket N`                 | The prompt is `/next-ticket N`: the dispatcher already picked N. Never run `queue:plan`; read the issue and its comments in full.                                                                                                         |
| § 1 Model check     | read the `model:*` label and stop on a lower tier | The dispatcher chose the tier from the label and launched this session on it. Say the tier in one line and go on; a label above the running tier is the dispatcher's defect: abort (below) and say so.                                    |
| § 2 Claim, worktree | `queue:claim N`, `wt:new N`                       | The claim is the `in-progress` label the dispatcher set: read it back (`gh issue view N --json labels --jq '[.labels[].name]'`), never set it. The [job worktree](#the-worktree) is the shell's directory. No `queue:claim`, no `wt:new`. |
| § 3 Implement       | commit when the work is a unit                    | Commit **and push early and often** (below): a killed job is resumed from its pushed branch.                                                                                                                                              |
| § 5 Hand off        | `land:ready <PR#>`                                | The same: `bun run land:ready <PR#>`. It labels the PR `ready-to-land` and the pass ends.                                                                                                                                                 |

## The worktree

The job's first step cut a worktree of the machine's primary checkout at
`$GITHUB_WORKSPACE`, on a detached HEAD at the base tip, and `worktree:init`
already ran. Name the branch the way `wt:new` would — `feat/issue-N`, or
`fix/issue-N` for a bug — and push it at once:

```bash
git switch -c feat/issue-N
git push -u origin HEAD
```

A **resume** (the dispatcher re-fired the issue because its claim has no live
run) finds the branch on `origin` instead: `git fetch origin feat/issue-N` (or
`fix/`), `git switch feat/issue-N`, `git status`. An open PR → read it against
the issue and go to § 5; a branch and no PR → finish § 3–§ 4, open the PR.

## Push early

A job has a hard `timeout-minutes` and can be killed by a runner restart; its
disk dies with it. Whatever is not on `origin` is lost. After the worktree
step, and after **every** commit: `git push origin HEAD`. A WIP commit
(`wip: <what is left>`) is fine — the branch is squashed on merge. The push
goes to the feature branch only: `deny-guard` refuses a push naming the base
or release branch (§ 2b, issue #5641).

## No raw output into the log

Logs of a public repository are readable by every signed-in GitHub user. The
pass prints numbers and ids, never a transcript, a token, or an env dump; keep
long output in a file under `$SCRATCHPAD`, as § Context hygiene says.

## A repair pick

The queue (Mergify, or the land-runner while it stands) labelled the PR
`land-failed` and commented the reason. In a job the failing run's log is on
GitHub, not on a machine's disk:

```bash
gh pr checks <PR#> --json name,state,link --jq '.[] | select(.state=="FAILURE") | "\(.name) \(.link)"'
gh run view <run-id> --log-failed >"$SCRATCHPAD/failed.log" 2>&1; grep -nE 'FAIL|Error|✗|refusing' "$SCRATCHPAD/failed.log" | head -40
```

`<run-id>` is the number in the check's link (`…/actions/runs/<run-id>/…`).
Then follow `land-failures.md` for what each failure asks of the repair; its
"the full log is on the MacBook" does not apply here.

## Abort

`abort.md` applies, with one change to its last paragraph: the release is the
label, not the journal. `queue:release N` writes a journal row this flow does
not read; release the claim as ONE act with
`gh issue edit N --remove-label in-progress --remove-assignee @me` (label and
assignee together, as `deny-guard` § 6b requires), then read the labels back.
There is no worktree to remove: the job's last step does it.

**Done when:** the claim was read back, never set; the branch is on `origin`
and every commit is pushed; `land:ready` labelled the PR `ready-to-land` (or the claim
is released with the abort's comment) and nothing printed a secret.
