# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tolaria is an MTG (Magic: The Gathering) gameplay engine for study and experimentation. Focus is on rules correctness and real-time reactivity between two clients. Not a commercial product — the goal is an extensible engine with a working subset of cards.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 + TypeScript + Vite 8 | React Compiler enabled via `@rolldown/plugin-babel` + `babel-plugin-react-compiler` |
| Backend/DB | Convex | Real-time reactive state, atomic transactional mutations |
| Auth | Clerk | External auth provider |
| Package manager | bun | |

- **TypeScript ~5.9** (strict, project references: `tsconfig.app.json` for src, `tsconfig.node.json` for config files)
- **ESLint 9** flat config with `typescript-eslint`, `react-hooks`, and `react-refresh` plugins

## Commands

- `bun run dev` — Start dev server with HMR
- `bun run build` — Type-check with `tsc -b` then build with Vite
- `bun run lint` — ESLint across the project
- `bun run preview` — Preview production build locally

## Architecture

### System overview

```
Client React (P1) ──┐
                    ├── Convex (game state) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

The gameplay domain is architecturally separated from surrounding features (matchmaking, profiles, collections).

### Game Rules Engine (GRE)

The GRE is the core of the system, runs **server-side** in Convex mutations. The client never validates rules — it's only a view of the state.

- **Authoritative**: every move is validated server-side before being applied
- **Deterministic**: given the same event log, always produces the same state
- **Isolated**: rules logic is independent of the transport layer

### Data model

Two main Convex tables:
- `game_state` — Current snapshot (temporary cache, overwritten on each action). Deleted at end of game.
- `game_events` — Append-only event log (source of truth for replays). Retained 30-90 days.

State is saved **only at stable points** (when waiting for human input).

### Action flow

```
1. Client sends action → Convex mutation
2. GRE validates (is it legal?)
3. GRE applies effect in memory
4. GRE generates internal events (SPELL_RESOLVED, PERMANENT_ENTERED, etc.)
5. GRE scans triggers on permanents in play
6. Triggers found → go to stack (do NOT auto-resolve)
7. State Based Actions applied (automatic, no priority)
8. Stable state reached → save to game_state + append to game_events
9. Both clients react automatically (Convex reactivity)
```

### Stack and priority

The stack resolves **one item at a time**, top to bottom. After each resolution, priority restarts from the active player. Both players must pass consecutively to proceed. Priority timeout is 30 seconds, managed via `ctx.scheduler.runAfter` with seq-based cancellation.

### Turn structure

Phases: BEGINNING (untap/upkeep/draw) → PRECOMBAT_MAIN → COMBAT (5 substeps) → POSTCOMBAT_MAIN → ENDING (end step/cleanup). Untap and cleanup are automatic (no priority).

## Project Structure (target)

```
convex/                        # Backend
├── schema.ts                  # Table definitions
├── game.ts                    # Public mutations/queries
└── gre/                       # Game Rules Engine
    ├── engine.ts              # Main loop
    ├── phases.ts              # Phase/turn management
    ├── stack.ts               # Stack and priority
    ├── triggers.ts            # Event/trigger system
    ├── sba.ts                 # State Based Actions
    ├── actions/               # Validators per action type
    └── cards/                 # Card definitions as data
        ├── index.ts           # Registry: id → CardDefinition
        ├── types.ts           # Shared types (ManaCost, Effect, etc.)
        └── sets/              # Card sets
src/                           # Frontend (React + Vite)
├── components/                # Battlefield, Hand, Stack, Card
└── hooks/
    └── useGameState.ts        # Wrapper on Convex useQuery
```

**Key boundary**: Frontend never imports from `convex/gre/` — it communicates only via public mutations in `convex/game.ts`.

## Card Definition System

Cards are defined as **data**, not imperative code. Three complexity levels:

1. **Pure data** — Vanilla creatures and basic lands (stats only)
2. **Declarative behavior** — Triggered/activated/static abilities using structured templates
3. **Imperative behavior** — Replacement effects, layer system (out of initial scope)

Key types in `convex/gre/cards/types.ts`: `CardDefinition`, `ActivatedAbility`, `TriggeredAbility`, `Effect`, `ManaCost`, `StaticAbility`, `ChoiceRequest`.

Mana abilities have `useStack: false` (resolve immediately). SBAs are global game rules in `sba.ts`; cards only declare `sbaMods` for exceptions (indestructible, etc.).

## Out of Scope (initial)

- Layer system for static effects (Anthem, Humility)
- Replacement effects ("instead" effects)
- Complex choice triggered abilities
- Simultaneous trigger APNAP ordering
- Full card catalog — starting with a controlled limited set
