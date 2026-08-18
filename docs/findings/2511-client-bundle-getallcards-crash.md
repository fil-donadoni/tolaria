---
title: The dev app does not load at all in a browser — `@convex/cards` has no `getAllCards` in the client bundle
discoveredBy: 2511
status: draft
confidence: high
---

**What is wrong.** On the `main` tip `7d2f0a3b` the whole SPA fails to evaluate
in Chrome: the root renders empty and the console carries one
`Uncaught SyntaxError: The requested module '/convex/cards/client.ts' does not
provide an export named 'getAllCards'`. Every browser-verifiable UI change is
blocked until it is fixed, and no gate catches it — `tsc` resolves the same
specifier to a DIFFERENT module than Vite does.

**Evidence.**

- `src/lib/ai/bot-view.ts:40` — `import { getAllCards, tryGetDefinition } from "@convex/cards";`
  (added by #2530, commit `e130fb4e`, merged 2026-08-18).
- `vite.config.ts:32-34` — an exact-regex alias maps `^@convex/cards$` to
  `convex/cards/client.ts`, deliberately, to keep the ~1.63 MB set-module tree
  out of the client bundle.
- `convex/cards/client.ts:7` — that module is `export * from "./registry";`
  and nothing else.
- `getAllCards` is defined in `convex/cards/catalogue.ts:400`, re-exported only
  through `convex/cards/index.ts`, which the alias deliberately bypasses.
- `tsconfig` path mapping resolves `@convex/*` → `convex/*`, i.e. to
  `convex/cards/index.ts`, which DOES export it — so `bun run check:ts` is
  green while the app is dead.

Reproduced on both dev servers (the shared checkout on :5173 and a fresh
worktree on :5199), so it is the tree, not a stale cache. Verified by adding a
local one-line `getAllCards` stub to `client.ts`: the app then loads normally.

**Why it may not deserve its own issue.** It is a one-line regression from a
PR that landed hours ago and might be fixed by its author before anyone reads
this. What probably DOES deserve a ticket independently is the hole it walked
through: the Vite alias and the TS path mapping resolve `@convex/cards` to two
different modules, so any import of a catalogue-only symbol type-checks and
then breaks the client bundle at runtime, with `check:all` green. A guard —
resolving the client entry's export surface against what `src/**` imports from
that specifier — would have failed the PR that introduced this.
