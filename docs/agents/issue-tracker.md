# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Always qualify a reference: `issue #NNN` / `PR #NNN`

Issues and pull requests share one number space, and agent output interleaves
them constantly — "landed #2992, closes #2376, blocked by #1524" is one PR and
two issues, indistinguishable without opening all three. The kind is known at
the moment of writing and is simply not written down.

So in **agent output and every artifact this repo generates** — terminal lines,
commit messages, receipts, the gate's own waiter and reclaim lines — a
reference names its kind: `issue #2999`, `PR #2997`. The one exemption is a
bare `#NNN` inside a GitHub issue or PR body, where the platform itself renders
a type badge and a hovercard; nothing in a terminal or a log does.

The convention is the same class of rule as a CR citation: mechanical, and
worth a lint over the artifacts this repo generates once enough of them follow
it. Until then it is a habit, and a reference you have not qualified is one the
next reader has to look up.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
