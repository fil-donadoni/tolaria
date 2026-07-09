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
- Frontend NEVER imports from `convex/gre/` engine modules — only via public mutations in `convex/game.ts`

## After changes

- Run `bun run check:all` — format + lint + type-check must pass
- Browser verification is on-demand only. Do not auto-launch Chrome for new cards or features — run it only when the user explicitly asks.
