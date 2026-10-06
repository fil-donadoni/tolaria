# /next-ticket — Abort

Reached from `SKILL.md` when this issue cannot land in this pass.

### Abort

An abort is two acts, in this order (issue #4752):

1. **A prerequisite is WIRED, never suggested.** When the session names work
   that must land first, link the existing issue — or file it
   (`/create-ticket`, then `filing.md` for its band) — and wire this issue
   `blocked-by` it in BOTH stores: the native edge
   (`gh issue edit N --add-blocked-by <M>`, read back) AND a `- #M — why`
   line under `## Blocked by` in the body. `bun run queue:lint N` must come
   back clean (its `dependency-parity` rule compares the two). A prose-only
   "suggest: block on #M" is not an abort: the released issue is re-picked by
   the next pass and aborts again. The wired edge is also what lifts #M into
   this issue's priority band (`queue:plan`).
2. **Release as ONE act: `bun run queue:release N`** — it removes
   `in-progress` AND the `@me` assignee and writes the claim journal's
   `released` row. A hand-typed `--remove-label in-progress` leaves the
   assignee, and the planner defers an assigned issue as "someone is working
   it" on every pass, forever — `deny-guard.sh` § 6b denies it. Then remove
   the worktree.

**Done when:** `queue:lint N` is clean, `queue:release N` printed its
`released` row, and the worktree is gone.
