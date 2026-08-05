# Why the queue is sorted the way it is

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

The planner (`scripts/lib/queue-plan.ts`) owns this sort. What follows is the RATIONALE, so a future
reader does not "simplify" a key that looks arbitrary — it is not instructions to re-derive the query
by hand.

---

**The planner computes this — you do not.** `scripts/lib/queue-plan.ts` owns the sort, the two-stage fetch, the dependency scan, and the disjointness walk; `bun run queue:plan` prints the result (SKILL.md §1). What follows is the _rationale_, so a future reader does not "simplify" a key that looks arbitrary. It is not instructions to re-derive the query by hand.

**Why the lineage and not the issue.** A child inherits its parent's queue position, not its own creation date. Without this, every spec umbrella starves: a PRD opened in July gets its slice tickets cut in August, those sort behind the entire queue, and the PRD never converges — while each fresh audit makes it worse by adding more children at the bottom. Sorting on the parent drains lineages in the order the _work_ was commissioned: all of the oldest PRD's children, then the next PRD's, and so on.

**Sort on the parent's NUMBER, not its `createdAt`.** Issue numbers are monotonic in creation time, so the number is an exact proxy — and it is the only one available: `gh issue list --json parent` returns `{id, number, state, title, url}` and **no `createdAt`**, so a `parent.createdAt` key silently falls back to the child's own date and the whole ordering quietly reverts to the broken behaviour. (Verified 2026-08-04; check the payload before changing this key.) For issues with no parent the two keys agree, so mixing `number` and `createdAt` across the queue is not an option — use `number` for both sides.

The edge is the **native GitHub sub-issue relationship** (`gh issue edit <child> --parent <prd>`), read from the planner's single list call — free, no body fetch. A prose `Split out of #N` line in the body is documentation for humans; it is **not** the sort key, because parsing it would force a body fetch for the whole queue and destroy two-stage selection. When an intake skill cuts children from an umbrella it MUST set `--parent`; a child with no parent edge simply sorts on its own number, so the change degrades gracefully.

`gh issue edit --parent` is **unreliable under rapid fire** — observed exiting non-zero on success, no-opping silently, and once applying the wrong parent when called in a tight loop. Read every edge back (`gh issue view <child> --json parent`) and retry on mismatch; never trust the exit code. (This applies to the intake skills that WRITE edges; the planner only reads them.)
