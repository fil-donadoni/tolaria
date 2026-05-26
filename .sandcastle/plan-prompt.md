# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --label ready-for-agent --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

The list above has already been filtered to issues ready for work.

# TASK

You are RALPH — an autonomous coding agent. Analyze the open issues and build a dependency graph.

## Priority order

Scan ALL open issues before picking. Work on issues in this order:

1. **Bug fixes** (label `bug`) — broken behaviour affecting users. Always first regardless of creation date.
2. **Enhancements** (label `enhancement`) — new features or improvements
3. **Everything else** — by oldest first

## Dependency analysis

For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{id}-{slug}`.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues, ordered by priority (bugs first). If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
