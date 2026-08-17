---
description: Rules for React frontend components
globs:
    - "src/components/**/*.tsx"
    - "src/hooks/**/*.ts"
---

# Frontend Component Rules

## Component structure

- ONE component per file — no exceptions
- Extract visual state computation into named functions or dedicated files
- Use `useGameContext()` for shared game state — never prop-drill GameState
- All UI text MUST be in English

## Type safety

- Import types from `convex/` (source of truth) — never define local game types
- Import constants/helpers from `convex/gre/constants.ts` — no local copies
- Frontend MAY import pure engine modules from `convex/gre/` and `convex/limited/` — the client-side Brain and the Draft Lab both do, and sharing the module is what keeps client and server from drifting. What the frontend never has is **authority**: no client-side engine run produces persisted or trusted state. Every real move goes through a public mutation in `convex/game.ts` and is re-validated server-side (ADR 0074)

## After changes

- Run `bun run check:all` — format + lint + type-check must pass
- **Verify in a real browser at three viewports** (desktop, phone portrait, phone landscape) and paste the probe receipt in the PR. The `dom` project runs on happy-dom, which has no layout: it cannot see a collapsed or occluded element. `.claude/rules/chrome-debug.md`
