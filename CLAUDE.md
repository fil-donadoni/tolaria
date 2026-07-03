# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tolaria is an MTG (Magic: The Gathering) gameplay engine for study and experimentation. Focus is on rules correctness and real-time reactivity between two clients. Not a commercial product — the goal is an extensible engine with a working subset of cards.

## Tech Stack

| Layer           | Technology                     | Notes                                                                               |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Frontend        | React 19 + TypeScript + Vite 8 | React Compiler enabled via `@rolldown/plugin-babel` + `babel-plugin-react-compiler` |
| Backend/DB      | Convex                         | Real-time reactive state, atomic transactional mutations                            |
| Auth            | @convex-dev/auth (Password)    | Email + password + nickname, native to Convex                                       |
| Package manager | bun                            |                                                                                     |

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

### Authentication

`@convex-dev/auth` Password provider. Users sign up with email + password +
nickname (modifiable). Every Convex query/mutation that touches user-owned
data uses `getCurrentUser(ctx)` / `getCurrentUserId(ctx)` from
`convex/auth.ts`. The router root is wrapped in `<AuthGate>`, so every route
requires login. There is no anonymous play. Email verification is **off** by
default for development.

### Player identity in games

`players[].id` is an opaque string handle used by the GRE as
`controllerId`/`ownerId`. For 2-player games it equals the user's
`Id<"users">`; for solo games it is `${userId}-p1` / `${userId}-p2`. The
schema keeps it as `v.string()` to accommodate both shapes — do not type it
as `Id<"users">`. Game mutations (`createGame`, `joinGame`,
`createSoloGame`) derive id and nickname from `ctx.auth`; clients cannot
spoof identity.

### Data model

Two main Convex tables:

- `game_state` — Current snapshot (temporary cache, overwritten on each action). Deleted at end of game.
- `game_events` — Append-only event log (source of truth for replays). Retained 30-90 days.

User decks live in `userDecks` (one row per saved deck, indexed by `userId`).
Preset decks come from `convex/deckPresets.ts` (in-code, served via
`api.decks.list`).

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
├── cards/                     # Card definitions as data
│   ├── index.ts               # Registry: id → CardDefinition
│   ├── types.ts               # Shared types (ManaCost, SpellContext, etc.)
│   └── sets/                  # Card sets (e.g. lea.ts)
└── gre/                       # Game Rules Engine
    ├── engine.ts              # Main loop
    ├── phases.ts              # Phase/turn management
    ├── stack.ts               # Stack and priority
    ├── triggers.ts            # Event/trigger system
    ├── sba.ts                 # State Based Actions
    └── actions/               # Validators per action type
src/                           # Frontend (React + Vite)
├── components/                # Battlefield, Hand, Stack, Card
└── hooks/
    └── useGameState.ts        # Wrapper on Convex useQuery
```

**Key boundary**: Frontend never imports from `convex/gre/` — it communicates only via public mutations in `convex/game.ts`.

## Card Definition System

Cards are defined as **data**, not imperative code. Three complexity levels:

1. **Pure data** — Vanilla creatures and basic lands (stats only)
2. **Declarative behavior** — Triggered/activated/static abilities using structured templates; one-shot spell/ability effects as an **Effect Script** (`effects: EffectOp[]`, ADR 0045) — the DSL-first default, see below
3. **Imperative behavior** — `resolve()` closures, now the escape hatch reserved for protocol-like cards (Word of Command, Camouflage), not the default. Continuous static effects are data: declare `staticEffects[]` and the layer system (`convex/gre/layers.ts`, CR 611/613) computes them at read time. Replacement effects have shipped.

**Effect Script DSL (ADR 0045/0046).** A card's effect is an ordered list of
**Ops** (`dealDamage`, `draw`, `destroy`, `choice`, …) connected by four frozen
structural constructs — `bind`, `ref`, `if`, `forEach` — interpreted by
`convex/gre/effects/interpreter.ts` on top of the existing `SpellContext`
primitives. It applies at every effect site (spell resolution, triggered and
activated ability effects). **DSL-first is mandatory for new cards** —
`resolve()` needs an explicit justification (`.claude/rules/gre-development.md`
§ DSL-first authoring). The **Mechanics Registry**
(`convex/cards/mechanicsRegistry.ts`) is the single authority on keyword-ability
and Op names, enforced by a catalogue-wide CI guard; an uncensused mechanic is
a stop-and-open-an-issue case, never an invented name. Testing shifts from
per-card to per-Op: a DSL card reusing already-exercised Ops needs no
hand-written test (static validation + an auto-generated canned-scenario smoke
test cover it); a card introducing a new Op earns that Op its permanent test.

Key types in `convex/cards/types.ts`: `CardDefinition`, `ActivatedAbility`, `ManaCost`, `SpellContext`, `TargetRequirement`, `TargetSelection`, `EffectOp`.

Mana abilities have `useStack: false` (resolve immediately). SBAs are global game rules in `sba.ts`; cards only declare `sbaMods` for exceptions (indestructible, etc.).

## Code Organization

- **One component per file.** Every React component lives in its own `.tsx` file. No inline component definitions or helper components in the same file as the parent.
- **Extract, don't inline.** When logic grows (visual state computation, interaction handlers, derived data), extract it into named functions or dedicated files — don't let it accumulate inline.
- **Types are centralized.** `convex/` is the source of truth for all shared types (`cards/types.ts`, `gre/types.ts`, `gre/state.ts`). `src/types/` re-exports from there. No local type definitions or constants in components.
- **Constants and helpers are shared.** Constants like `LAND_SUBTYPE_MANA`, `PERMANENT_TYPES` and helpers like `isCreature`, `isLand` live in `convex/gre/constants.ts`. Components import from there — no local copies.

## Collaboration Mode

Claude operates **autonomously**: implements, tests, and validates code end-to-end. The user defines features and high-level strategy — Claude executes the full development cycle including writing code, tests, and running quality gates. Ask the user for confirmation only on significant architectural decisions or when the CR leaves ambiguity that affects game behavior.

## Chrome Browser Debug (via claude-in-chrome MCP)

**On-demand only.** Do not launch Chrome to verify new cards or gameplay features by default — vitest + wire format tests + preset scenarios are the standard verification. Use Chrome only when the user explicitly asks ("test in Chrome", "open the browser", "verify in the UI", etc.).

When the user does request a browser check:

**Always debug in solo mode.** A solo game is a single-user match where one
user controls both players and the viewer auto-follows priority. This removes
the need for a second tab and lets you reach a playable board in two MCP
round-trips. See `.claude/rules/chrome-debug.md` for the full setup batch and
storage-key reference.

Quick reference (full details in the rule file):

1. `tabs_context_mcp(createIfEmpty: true)` — get or create a tab
2. Pre-populate `tolaria:selectedDeckId` + `tolaria:playerName` via
   `javascript_tool`, then `navigate` to `http://localhost:5173` — this skips
   deck selection and name input
3. `find` + click `New Solo Game` (or `Restart Solo` from the Debug panel if
   already in a game)
4. Use `find(query)` + click by `ref` instead of guessing coordinates
5. `read_console_messages(onlyErrors: true)` after any state-changing action
6. `computer(action: screenshot)` for visual verification, `zoom` for small UI
7. Skip `wait` unless waiting for async navigation — check state directly

Do **not** open a second tab to simulate an opponent: solo mode replaces that
workflow.

## Automated Development Workflow

### Skills (invoke explicitly or auto-triggered)

| Skill              | Trigger                               | What it does                                                                                                                                     |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/mtg-rules-check` | Before implementing any game mechanic | Fetches CR text, finds implementation, reports gaps                                                                                              |
| `/new-card`        | When adding a new card                | Fetches Scryfall data, generates a CardDefinition as an Effect Script by default (DSL-first, ADR 0045), validates against the Mechanics Registry |
| `/gre-test`        | When adding/modifying GRE logic       | Generates vitest tests following project patterns                                                                                                |

### Path-specific rules (auto-loaded)

- `convex/gre/**` and `convex/cards/**` → CR compliance, testing requirements, code patterns
- `src/components/**` → One-component-per-file, type sourcing, UI testing

### Development cycle

1. **Discuss** — User describes the feature/rule at high level
2. **Verify rules** — `/mtg-rules-check` to get exact CR text and current implementation status
3. **Plan** — Agree on scope: what to implement now, what to defer
4. **Implement** — Write a card's effect as an **Effect Script** (`effects: EffectOp[]`) by default — the DSL-first mandate (ADR 0045). Consult the Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) for the keyword/Op name before writing anything; an uncensused mechanic is a stop-and-open-an-issue case, not an invented name. Reach for `resolve()` only for a genuinely protocol-like card, with a recorded justification (`.claude/rules/gre-development.md` § DSL-first authoring). Otherwise follow CR and project patterns as usual.
5. **Test** — For a `resolve()` card (or a DSL card introducing a new Op): write tests at ALL layers — GRE unit tests, backend integration (game.ts mutations), frontend utils, AND wire format. Two pieces passing individually but failing together is a shipped bug. Every feature that crosses the GRE → game.ts → UI boundary MUST have at least one integration test exercising the full path. For a DSL card that only reuses already-exercised Ops, the per-Op regime applies instead: the catalogue-wide `validateEffectScript` sweep plus the auto-generated canned-scenario smoke test cover it — no hand-written per-card test required. While iterating, run only the **targeted tests** for what you changed (`bun run test <path>`); the full `bun run test` suite is part of the pre-done gate (step 6, see § Quality gates for cadence).
6. **Validate** — Run the full gate once, before marking done: `bun run check:all` (zero errors) + full `bun run test` (zero failures). See § Quality gates.
7. **Preset scenario** — For any new card or gameplay feature, add a dedicated entry to `PRESET_SCENARIOS` in `src/components/debug/debug-panel.tsx` so the user can load it one-click from the Debug panel and exercise the feature end-to-end. Choose cards/zones/phase/`landCount` that hit the golden path (and ideally a key edge case). Skip only for pure refactors with no user-visible behavior change.
8. **UI verify** — Only when the user explicitly requests browser verification. Do NOT auto-test new cards or gameplay features in Chrome — preset scenarios + vitest + wire format tests are the default verification. The user will ask for a Chrome run when they want one.

### Quality gates (mandatory, no exceptions)

The full gate is **mandatory before a task is marked done / before merge** — never skipped. It is the slow checks that get deferred, not removed.

**Cadence** (the suite is slow — don't pay for it on every edit):

- **While iterating** — run only the **targeted tests** for the module you're touching (`bun run test <path>` / `vitest run <path>`). Formatting is automatic: `husky` + `lint-staged` runs `prettier --write` on every commit, so you never run a formatter by hand mid-work. Do **not** run `check:all`, full `lint`, `check:ts`, or the full `test` suite repeatedly mid-iteration.
- **Before marking the task done / before merge** — run the full gate once:
    1. `bun run check:all` — format + lint + type-check (zero errors)
    2. `bun run test` — full vitest suite (zero failures)

**Zero-red is absolute (green-main invariant).** `main` is always green — zero failing tests, no exceptions. "Not my test" / "this failure is unrelated to my change" is **not** an exemption: a red suite blocks the merge regardless of who caused it. If the baseline is red before you start, fix the reds first (or stop and surface them) — never branch off red, never merge on top of red, never silence a test to go green. The full gate is the only done/not-done signal; a red baseline poisons it for every subsequent change.

Browser visual verification is NOT a default gate. Run it only when the user explicitly asks for a Chrome check.

## Rules Implementation Process

When implementing a new MTG rule or card ability, always cross-reference the user's instruction with the official Magic: The Gathering Comprehensive Rules. Before writing code, discuss with the user any details not covered in their instruction — edge cases, interactions, timing — and decide together what to implement now vs defer.

## Implemented engine capabilities

The engine follows the Comprehensive Rules. The following were once deferred but
have since **shipped** — do not treat them as out of scope:

- **Continuous static effects via the layer system** (`gre/layers.ts`, CR 611/613):
  P/T (layers 7a–7e, ADR 0017), color (5), type/subtype add (4), ability grant /
  removal / loss (6), control change (2), text-changing (3, ADR 0011). Anthems
  (Crusade) and ability-stripping (Humility-style) are expressible as `staticEffects[]`
  with an `applies` predicate.
- **Replacement effects** (`gre/replacements.ts`) — damage, destroy (ADR 0020), etc.
- **Complex / choice triggered abilities** and **simultaneous-trigger APNAP ordering**
  (CR 603.3b).
- **Effect Script DSL** (`gre/effects/interpreter.ts`, ADR 0045) — declarative
  card effects at spell/triggered/activated sites, the four frozen structural
  constructs (bind/ref/if/forEach), a growing Op vocabulary, and the Mechanics
  Registry (`cards/mechanicsRegistry.ts`, ADR 0046) as the name authority.
  DSL-first is now the mandatory authoring default for new cards — see
  `.claude/rules/gre-development.md` § DSL-first authoring.

## Out of Scope

- **Full card catalog** — a controlled, growing set, not all ~80k cards.
- **3+ player multiplayer** — only 2-player and solo (one user, two seats).
- **Ante & subgames** — Shahrazad, ante cards (ADR 0010).

When a card needs a capability that genuinely isn't built yet, flag it explicitly
rather than assuming it's deferred — most mechanics are now supported.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `fil-donadoni/tolaria`. Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, default names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: `CONTEXT.md` (when created) + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

ADRs are **not** auto-loaded into context. `docs/adr/README.md` is the queryable
index — read it first to discover which records exist, then open only the
relevant ones. **Every new ADR MUST add its row to `docs/adr/README.md`** (number
= filename number, one-line decision, link) in the same change that creates the
ADR. An ADR without an index row is incomplete.
