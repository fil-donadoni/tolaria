---
title: land force-pushes and merges in the same breath, losing to GitHub's mergeability recompute
discoveredBy: 2517
status: draft
confidence: high
---

**What is wrong.** `buildLockedCommand` chains
`git push --force-with-lease && gh pr merge --squash` with nothing between them.
A force-push invalidates GitHub's cached mergeability for the PR: the API
returns `mergeable: null` / `mergeable_state: "unknown"` until a background job
recomputes it, and `mergePullRequest` refuses to act while that is pending. So
the merge can fail purely because it asked too soon — after the full gate has
already run inside the lock.

**Evidence.** First real use of `land`, landing its own PR (#2524), 2026-08-18.
`check:all` green, `test:app` 15583 green, `test:bot` 1413 green, `test:blade`
40 green, force-push succeeded, then:

```
To https://github.com/fil-donadoni/tolaria.git
 + 404c9cd1...26815bd6 fix/issue-2517 -> fix/issue-2517 (forced update)
GraphQL: Pull Request is not mergeable (mergePullRequest)
error: script "land" exited with code 1
```

Polling the same PR a few seconds later, untouched:
`{"mergeable":true,"mergeable_state":"clean"}` — and `main` had not moved, so
this was never a real conflict. The PR merged on a plain retry, and the merged
tip's tree hashed identical to the gated branch tree
(`62c88513780348ca61e5e4ce4602b2ad46ba652b`), confirming nothing about the
landing tree had changed.

**Why this is worse than a normal flake.** It defeats the point of #2517. The
whole design holds the heavy lock across gate→merge so the suite is paid once
per landing; when the merge loses this race, `land` exits non-zero, releases the
lock, and the next attempt re-pays a full heavy gate — reinstating exactly the
N-gates-per-landing behaviour the issue set out to remove, and reopening the
window for another session to land first. It should be reproducible on any
landing, since every `land` run force-pushes immediately before merging.

**Likely fix.** After the push and before `gh pr merge`, poll
`gh pr view <PR> --json mergeable,mergeStateStatus` until it leaves `UNKNOWN`
(bounded, a few seconds), and retry the merge a small number of times on
`not mergeable` while `mergeable_state` is still unsettled. Distinguish that
from a genuine `DIRTY`/conflict, which must still fail loudly. Note the retry
must not re-run the gate — the tree is unchanged and already verified.

**Why it may not deserve its own issue.** It is a defect in code that shipped
hours earlier rather than an independent gap, so it could equally be folded into
whatever follow-up #2517 spawns. Two other round-2/round-3 residuals were left
open in the same PR and are candidates for the same ticket: `SKILL.md` still
grants a byte-identical gate-skip that `land` does not implement, and
`git push origin --delete` sits outside the `--keep` teardown guard, so a kept
worktree loses its upstream.
