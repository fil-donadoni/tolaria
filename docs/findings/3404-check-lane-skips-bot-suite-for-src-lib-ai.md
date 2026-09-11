---
title: check:lane's skin lane skips the bot suite for a src/lib/ai/** diff
discoveredBy: 3404
status: draft
confidence: high
---

**What is wrong.** `bun run check:lane` classifies a diff touching only `src/**`
as the `skin` lane and skips the bot fast lane with the reason _"no changed path
under `convex/**` or `scripts/**` — the bot suites cannot go red"_. That reason
is false for `src/lib/ai/**`, which is a member of `BOT_GLOBS` and whose tests
(`src/**/*.bot.test.{ts,tsx}`, the `bot-dom` vitest project) are excluded from
the `dom` project the skin lane DOES run. So a `src/lib/ai/**` change can break
its own bot tests while `check:lane` — and therefore `bun run land` — stays
green.

**Evidence.** Issue #3404's diff touches `src/lib/ai/{trace-store,eval-term-labels,decision-phrases}.ts`
and ships `src/lib/ai/__tests__/decision-phrases.bot.test.ts` +
`src/components/debug/__tests__/ai-decision-trace.bot.test.tsx`. `check:lane`
printed `run: format(diff) lint(diff) tsc[app,scripts] bundle cr:lint
node[src,scripts] dom` and `skip: bot fast lane — no changed path under
convex/** or scripts/**`. Neither new test file is in any project that lane
runs: `vitest.config.ts` excludes `BOT_GLOB_DOM` from the `dom` project
(`vitest.config.ts:257`) and routes it to `bot-dom` (`:288`), which only
`test:bot` selects. `scripts/lib/bot-globs.ts:15-19` lists `src/lib/ai/**` as a
bot path — the single source of truth the lane's predicate does not consult.

**Why it may not deserve its own issue.** The hole is bounded: `bun run release`
runs all three suites on the base tip, so a break is caught before the release
branch moves — just later than the merge that caused it, and against whoever
lands next rather than its author. The fix looks small (route `BOT_GLOBS`
through `classifyPath()` in `scripts/check-lane.ts` so a `src/lib/ai/**` path
adds the bot fast lane rather than skipping it), which may make it a line on an
existing gate tracker rather than a ticket of its own.
