# Frontend Component Rules — resident index

**This file is the index; the full text is `src/CLAUDE.md`**, which the harness
loads on demand the first time a session reads a file under `src/`.

- **ONE component per file** — no exceptions. Extract visual state computation
  into named functions or dedicated files.
- Use `useGameContext()` for shared game state — never prop-drill GameState.
- **All UI text MUST be in English.**
- **Import types from `convex/`** (source of truth) — never define local game
  types; constants and helpers from `convex/gre/constants.ts`, no local copies.
- The frontend MAY import pure engine modules from `convex/gre/` and
  `convex/limited/`; what it never has is **authority** — every real move goes
  through a public mutation in `convex/game.ts` and is re-validated
  server-side (ADR 0074).
- After changes: `bun run check:all`, and **`bun run check:ui`** whenever the
  diff can reach the DOM (`.claude/rules/chrome-debug.md`).
