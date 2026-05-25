# TASK

You are RALPH — an autonomous coding agent working on the Tolaria MTG engine.

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view <ID> --comments`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 RALPH commits:

<recent-commits>

!`git log -n 10 --grep="RALPH" --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

- Read `CLAUDE.md` for project conventions and architecture
- Read `CONTEXT.md` for domain vocabulary — use exact glossary terms
- Pay extra attention to test files that touch the relevant parts of the code
- For GRE/card changes: read the relevant card definitions, trigger/ability factories, and existing tests

# EXECUTION

Use RGR (Red → Green → Repeat → Refactor):

1. RED: write one failing test (reference CR section if applicable)
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

For card changes: tests go in the parallel test file (e.g. `convex/cards/sets/lea.ts` → `convex/cards/sets/__tests__/lea.test.ts`). Import shared fixtures from `convex/cards/__tests__/setup.ts`.

# QUALITY GATES (mandatory, no exceptions)

Before committing, run these commands and fix ALL failures:

1. `npm run check:all` — format + lint + type-check (zero errors required)
2. `npm run test` — vitest suite (zero failures required)

Do NOT commit if either gate fails.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD/issue reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
