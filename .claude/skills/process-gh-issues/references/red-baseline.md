# Red-baseline triage (§0b)

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered only when the green-main precondition fails. The loop must neither branch off red nor halt
silently, so the red is CLASSIFIED first — and exactly one class is the loop's to repair.

---

#### 0b. Red-baseline triage (self-heal, narrowly)

Identify what broke it before doing anything: `git log --oneline -15`, then map each failing test/type-error to the commit that introduced it (`git log -S '<symbol>' -1 --format='%H %an %s' -- <file>`).

| Cause                                                                                                | Action                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flake** (re-run the failing set once, alone)                                                       | green on re-run → proceed, and note it in the final report. Do not chase it                                                                                                                                                                                                                                                                                                                       |
| **A commit THIS loop merged** (it is in your session's merge list, and the gate was green before it) | **revert it** — `git revert --no-edit <squash-sha>`, re-gate, push. The green-main invariant outranks the PR. Then reopen its issue (`gh issue reopen N`) with a comment linking the revert and the failure, remove `in-progress`, and let a later pass redo it. This is the only case where the loop rewrites `main` on its own, and it is safe because it restores a tree a gate already passed |
| **Anything else** — a direct push to `main`, another session's merge, a human's in-flight refactor   | **not yours to revert.** Open one `bug` issue (title `fix: main is red — <failing set>`), body = the failing output + the culprit commit + author, label it `bug` and `ready-for-human`, and **stop the loop** reporting that issue. Do not attempt a fix-forward on a tree you did not break: a half-understood repair on top of someone's live refactor is worse than the red                   |

Reverting a commit the loop did not merge, or force-pushing `main`, is never allowed regardless of cause.
