# Frontend Component Rules — resident index

**This file is the index; the full text is `src/CLAUDE.md`**, loaded on demand
at the first read of a file under `src/`.

- **ONE component per file** — no exceptions; visual state computation goes in
  named functions or dedicated files.
- `useGameContext()` for shared game state — never prop-drill GameState.
- **All UI text MUST be in English.**
- Types from `convex/`, constants/helpers from `convex/gre/constants.ts`;
  authority stays server-side (ADR 0074) — CLAUDE.md § Code Organization,
  § Key boundary.
- After changes: `bun run check:all`; **`bun run check:ui`** when the diff can
  reach the DOM (`chrome-debug.md`).
