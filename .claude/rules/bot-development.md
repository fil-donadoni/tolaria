---
description: Rules for developing the Bot (play AI / draft AI)
globs:
    - "convex/gre/{search,evaluate,moves,applyMove,determinize,difficulty,shouldThink,describeMove}.ts"
    - "convex/gre/ai/**"
    - "src/lib/ai/**"
---

# Bot Development Rules

You are in the Bot subsystem — read `/bot-slice` before changing anything
here; it maps the seams and the full verification doctrine.

- **Every behaviour change ships a `must` blade entry in the same PR**
  (`convex/gre/ai/blade/`) — a discriminating pair when the fix is a
  preference between two moves that both look legal. Blade-slice's step 1;
  don't debug via self-play (`/bot-slice` § Verification doctrine).
- **Fix the class, never the card** — no card names in identifiers, no
  per-card registries (ADR 0102). `/bot-slice` § Seams / step 4.
- **The ladder is for STRENGTH claims only.** Declare the environment rung
  and the pairing dynamics; never use it to explain WHY a decision happened
  (`/bot-slice` § Verification doctrine, item 4).
- **Tests are named `*.bot.test.ts`** — `bot-suite-boundary.test.ts`
  enforces it (`/bot-slice` § Rules that catch the recurring bugs).
- **Determinism is a hard requirement** — fixed `iterations`, never
  wall-clock (`timeMs`), in any test.
