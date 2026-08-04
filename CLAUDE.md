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

**Key boundary — authority, not imports** (ADR 0074): the frontend **may** import
pure engine modules from `convex/gre/` and `convex/limited/`, and does so
routinely — the vs-AI **Brain** runs client-side (`searchWithTrace`, `evaluate`,
`layers`, `resolveTopOfStack` on a local clone), and the **Draft Lab** runs
whole drafts in-browser off `botDrafter.ts`/`draftEngine.ts`. Sharing the module
is exactly what stops client and server drifting apart.

What the frontend never has is **authority**: no client-side engine run ever
produces state that is persisted or trusted. Every real move goes through a
public mutation in `convex/game.ts`, the server re-validates it, and the client
is a view plus a local simulator. Client-side engine use is confined to
simulation, derivation and display.

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

### Subagent model routing (cost)

A subagent spawned with no explicit `model` inherits the session tier (often Opus/Fable — the most expensive). Read-only or mechanical delegation does not need that tier. **Pass `model: sonnet` when spawning `Explore` or `general-purpose` for read-only work** (locate/map/survey/research); reserve the inherited session tier for subagents doing genuinely hard implementation or reasoning. `cavecrew-*` agents already pin their own model in frontmatter — never override them. `fork` always inherits the parent by design (not controllable). Telemetry `resolved_model` (see `docs/agents/skill-timing-optimization.md`) is the ground truth for auditing leaks.

## Chrome Browser Debug (via claude-in-chrome MCP)

**On-demand only.** Do not launch Chrome to verify new cards or gameplay features by default — vitest + wire format tests + preset scenarios are the standard verification. Use Chrome only when the user explicitly asks ("test in Chrome", "open the browser", "verify in the UI", etc.). When they do: **always debug in solo mode** (one user, two seats, viewer auto-follows priority — no second tab). Full setup batch, storage keys, and the step-by-step quick reference live in `.claude/rules/chrome-debug.md` (auto-loaded) — do not duplicate them here.

## Automated Development Workflow

### Skills (invoke explicitly or auto-triggered)

The **work-intake** skills all converge on the same tail — grill → `/to-prd` → `/to-tickets` → issues labelled `ready-for-agent` — and `/process-gh-issues` is the single implementer that drains that queue. Pick the intake skill by where the work comes FROM:

| Skill                | Trigger                                     | What it does                                                                                                                                                                       |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/new-card`          | One new card (rare — most cards ride a set) | Checks it isn't already shipped, fetches Scryfall oracle, maps it to Ops / flags capability gaps, grills only if a gap needs a decision, then PRD + tickets                        |
| `/new-set`           | A whole set rollout                         | Profiles the set from MTGJSON, triages every card into done/staged/free/capability/out-of-scope, grills the capability clusters, emits an umbrella PRD + dependency-ordered issues |
| `/new-qa-issue`      | A bug / enhancement you observed            | Explores the codebase, drafts one agent-readable issue with acceptance criteria, posts after confirmation                                                                          |
| `/audit-tracker <N>` | A roll-up issue listing gaps has gone stale | Re-verifies every listed gap against HEAD, corrects wrong premises, cuts one slice ticket per survivor, re-points `tracked-by:` markers, retires the tracker                       |
| `/process-gh-issues` | Draining the `ready-for-agent` queue        | Selects a file-disjoint batch, fans out one implement-subagent + worktree per issue, reviews each PR, integrates through a serial rebase + re-gate merge-train, closes on success  |
| `/mtg-rules-check`   | Before implementing any game mechanic       | Fetches CR text, finds the implementation, reports gaps                                                                                                                            |
| `/gre-test`          | When adding/modifying GRE logic             | Generates vitest tests following project patterns                                                                                                                                  |
| `/new-op`            | A card needs a DSL verb that doesn't exist  | Walks all seven Op registration sites across six files (three of which no guard covers) and the Op's permanent test                                                                |
| `/bot-slice`         | Any change to the play Bot or the draft Bot | Maps the AI subsystem, walks the seams a change must touch, enforces the verification doctrine (blade scenario first, self-play only for strength claims)                          |

**Workflow skills are versioned in this repo.** `/process-gh-issues` lives in
`.claude/skills/process-gh-issues/` and is tracked by git like any other source
file: a change to it goes through a branch, a PR, a review and the gate, and
`scripts/__tests__/project-skills.test.ts` fails if it drifts back to the
user-level directory (where it would be invisible to every PR and would shadow
the repo copy). When the workflow stabilises it can be extracted into a
shareable package; until then it belongs to Tolaria.

A rule that CAN be enforced mechanically belongs in a script the gate runs
(`scripts/queue-plan.ts` computes the batch, `scripts/gate.ts` blocks the full
suite in an issue worktree), not in the skill's prose. Prose is the fallback for
judgment, not the default home for an invariant.

### Path-specific rules (auto-loaded)

- `convex/gre/**` and `convex/cards/**` → CR compliance, testing requirements, code patterns
- `src/components/**` → One-component-per-file, type sourcing, UI testing

### Development cycle

1. **Discuss** — User describes the feature/rule at high level
2. **Verify rules** — `/mtg-rules-check` to get exact CR text and current implementation status
3. **Plan** — Agree on scope: what to implement now, what to defer
4. **Implement** — Write a card's effect as an **Effect Script** (`effects: EffectOp[]`) by default — the DSL-first mandate (ADR 0045). Consult the Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) for the keyword/Op name before writing anything; an uncensused mechanic is a stop-and-open-an-issue case, not an invented name. Reach for `resolve()` only for a genuinely protocol-like card, with a recorded justification (`.claude/rules/gre-development.md` § DSL-first authoring). Otherwise follow CR and project patterns as usual.
5. **Test** — For a `resolve()` card (or a DSL card introducing a new Op): write tests at ALL layers — GRE unit tests, backend integration (game.ts mutations), frontend utils, AND wire format. Two pieces passing individually but failing together is a shipped bug. Every feature that crosses the GRE → game.ts → UI boundary MUST have at least one integration test exercising the full path. For a DSL card that only reuses already-exercised Ops, the per-Op regime applies instead: the catalogue-wide `validateEffectScript` sweep plus the auto-generated canned-scenario smoke test cover it — no hand-written per-card test required. **Frontend wiring is not optional** — a card correct in the GRE is routinely dead in the UI because a client view reducer (`buildTriggerStateView`, `projectPublicState`) drops a field the affordance reads; every new card/mechanic MUST walk the reducers per `.claude/rules/gre-development.md` § Frontend wiring analysis, and any SURFACE test must run through the reducer (a hand-built view masks the bug). While iterating, run only the **targeted tests** for what you changed (`bunx vitest run <path>`); the full `bun run test` suite is part of the pre-done gate (step 6, see § Quality gates for cadence). **Every test that guards a behaviour must be proven to fail** — break the code it covers, watch it go red, revert, and say what you broke (`.claude/rules/gre-development.md` § Proof-of-failure). A test that passes when it should fail is silent forever, and nothing else in the workflow distinguishes it from a real one.
6. **Validate** — Run the full gate once, before marking done: `bun run check:all` (zero errors) + full `bun run test` (zero failures). See § Quality gates.
7. **Preset scenario** — For any new card or gameplay feature, add a scenario so the user can load it one-click from the Debug panel and exercise the feature end-to-end (ADR 0044, issue #770: scenarios are `debugScenarios` DB rows — the DB is the **single source of truth**, there is no code-array/file path anymore, issue #1455). Two authoring paths — pick by whether you have a live browser:
    - **Automated / headless work (agents, `/process-gh-issues`) — DB-direct, post-merge.** A subagent has no browser and cannot open the Debug panel, so it does NOT insert the scenario itself. Instead it emits one `{ label, spec }` object (spec = `debugSetupScenario`'s args minus `gameId`) in its **PR receipt**. After that PR merges and the deployment redeploys (so the card exists in the catalogue the loadability guard checks), the **orchestrator** registers the scenario by calling the `seedScenarioDirect` internalMutation against the deployment — `npx convex run debugScenarios:seedScenarioDirect '{"label":"…","spec":{…}}'` (or via the Convex MCP). It upserts by label (re-run patches, never duplicates). **Accepted tradeoff:** the row is DEPLOYMENT-LOCAL — not in git / the PR diff / other deployments — which is the point of retiring the code-array path (no file edit + merge-train append-conflict just to register a scenario).
    - **Interactive human work (live browser).** Fastest path: open the Debug panel → Scenarios → "Save scenario" and insert a spec via `saveDebugScenario` (`convex/debugScenarios.ts`) — a runtime DB insert, no code edit.
    - Either way: choose cards/zones/phase/`landCount` that hit the golden path (and ideally a key edge case). Skip only for pure refactors with no user-visible behavior change.
8. **UI verify** — Only when the user explicitly requests browser verification. Do NOT auto-test new cards or gameplay features in Chrome — preset scenarios + vitest + wire format tests are the default verification. The user will ask for a Chrome run when they want one.

### Quality gates (mandatory, no exceptions)

The full gate is **mandatory before a task is marked done / before merge** — never skipped. It is the slow checks that get deferred, not removed.

**Cadence** (the suite is slow — don't pay for it on every edit):

- **While iterating** — run only the **targeted tests** for the module you're touching (`bunx vitest run <path>`). Formatting is automatic: `husky` + `lint-staged` runs `prettier --write` on every commit, so you never run a formatter by hand mid-work. Do **not** run `check:all`, full `lint`, `check:ts`, or the full `test` suite repeatedly mid-iteration.
- **Before opening a PR (the light pre-PR gate)** — `bunx vitest run <paths touched>` + **`bun run check:pr`**. `check:pr` runs `check:all:inner` (format + lint + type-check + `check:ids` + `check:index` + `check:stubs`) **plus `check:guards`**, on the **light** tier — no machine-wide mutex, so it does not queue behind another session's suite. Never hand-pick a subset: the three `check:*` scripts cost <0.2s each, and omitting `check:index` is what made every card-shipping PR fail at the merge-train on the card-index lockfile.

    **`check:guards` — the bot fast lane (issue #1912).** `check:pr` used to run **no tests at all**, and the catalogue-wide GUARDS all live in the **bot** suite: `aiEffectsGuard` (a new `resolve()`/`resolveSteps` card with no AI valuation), `pickRatings` (a cube card with no pick rating), `opValuerCoverage` (a new Op with no valuer), the `moves`/`cardProfile` censuses. Shipping a card trips them routinely — three consecutive card PRs reached a green `check:pr` while **red in the bot suite**, each caught only by review or by CI afterwards. `check:guards` runs the bot suite through the `TOLARIA_BOT_FAST=1` lane: everything except `HEAVY_BOT_GLOB` in `vitest.config.ts`. Cost: ~60s for 65 files (measured `ai-diagnosis.bot.test.ts` alone is 163s of the suite's 188s; the other 65 files total ~25s of test time). It is a **deny-list, not an allow-list of guard files**, so a newly added guard is covered for free — an allow-list silently stops covering everything written after it. The deferred files still run in the full `bun run test:bot`; `scripts/__tests__/bot-fast-lane.test.ts` fails if the deny-list drifts from the config or grows past 4 entries.

    `check:guards` also runs **`scripts/__tests__`** (12 files, ~4s) — the repo's own hygiene guards (`worktree-bootstrap`, `bot-suite-boundary`, `migration-classifier`, `client-bundle-purity`, …). They live in the APPLICATION suite, so before #1912 a change to the gate's own wiring could not be caught by running the gate: the `check:pr`-shape assertion in `worktree-bootstrap.test.ts` went red in CI while `check:pr` reported green locally. Everything else in the application suite stays out — it is 770 files and belongs to the full gate.

- **Before marking the task done / before merge** — run the full gate once:
    1. `bun run check:all` — format + lint + type-check (zero errors)
    2. `bun run test` — full vitest suite (zero failures)

**Two hooks, because `pre-commit` alone does not hold.** `.husky/pre-commit`
(`lint-staged` → `prettier --write` on the staged files) is a convenience, not a
gate: git does **not** invoke it for a merge commit (that is
`pre-merge-commit`), nor for `git rebase` / `git cherry-pick`, which replay
commits without it — and it only ever touches the files in that one commit,
while CI's `format:check` checks the whole repo. `.husky/pre-push` closes that:
`prettier --check` on the files in the commits **being pushed** (diff-scoped,
sub-second; a repo-wide `format:check` is ~43s and would not survive contact
with a quick push). Both hooks are tracked in git and guarded by
`scripts/__tests__/worktree-bootstrap.test.ts` — a missing husky hook is
**silent** (`.husky/_/h`: `[ ! -f "$s" ] && exit 0`), which is how
`.husky/pre-commit` vanished in a 2026-06-17 merge resolution and stayed gone
for six weeks, every `linter` CI failure in that window being its Format step.

**`check:all` VERIFIES formatting, it does not fix it.** Its first step is
`format:check` (`prettier --check`). On drift it fails with a pointer to
`bun run format` — fix it and re-run. It used to call `bun run format`
(`prettier --write`), which silently repaired drift and therefore could never
fail on it: CI's `quality` job sat red on `main` for days with 20 unformatted
files while every local gate reported green. A gate that repairs what it is
supposed to check is not a gate.

**Two test suites: application and bot.** `bun run test` runs both, in sequence, and is still the one gate command — but they are separate vitest invocations:

| Command            | Covers                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `bun run test`     | everything (`test:app` then `test:bot`) — the gate                                                          |
| `bun run test:app` | application suite: rules/GRE/cards/UI — every `*.test.ts` that is not `*.bot.test.ts`                       |
| `bun run test:bot` | bot/AI suite: ISMCTS search, evaluation, move enumeration, bot driver, self-play, drafter — `*.bot.test.ts` |

A bot test declares itself by **filename**: `search.bot.test.ts`, not `search.test.ts`. Bot tests run real searches over full game states, so mixed into the ~580-file application suite they lose the CPU race and their heavy episodes time out; separate invocations (not merely separate vitest projects — projects share one worker pool) give the bot suite an uncontended run. **Name any new bot/AI test `*.bot.test.ts`** — `scripts/__tests__/bot-suite-boundary.test.ts` fails the app suite when a plain `*.test.ts` imports a bot-only module. Config and rationale: `vitest.config.ts`.

**CPU admission control — the gate is machine-wide serialized (`scripts/gate.ts`).** Several sessions/subagents work this repo concurrently, each in its own worktree, and each used to spawn `ncpu - 1` vitest workers plus a `tsc -b` plus an eslint. On 8 cores that measured a load average of 45, made every gate 1.5–3× slower than solo, and pushed the bot suite past its 60s per-test ceiling — false reds whose debugging cost dwarfs the slowdown. Two tiers now:

| Tier      | Commands                                                           | Behaviour                                                                                                                                                  |
| --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **heavy** | `bun run test`, `test:app`, `test:bot`, `check:all`                | hold a machine-wide exclusive mutex (`~/.cache/tolaria/gate.lock`), run at `ncpu - 1` workers. One at a time — callers queue and print `[gate] waiting …`. |
| **light** | `bunx vitest run <path>`, `check:pr`, `check:ts`, `lint`, `format` | no lock, vitest capped at **2 workers** (`TOLARIA_VITEST_WORKERS`, default in `vitest.config.ts`). Four concurrent light jobs fit in `ncpu`.               |

A queued heavy gate is _not_ a hang: it is the machine refusing to run two full suites at 1/2 speed each. Stale locks (dead pid, or held > 45 min) are pruned automatically. Override the cap for a one-off solo run with `TOLARIA_VITEST_WORKERS=7 bunx vitest run <path>`.

**The full gate is blocked inside an issue worktree.** In a `feat/issue-N` / `fix/issue-N` worktree, `bun run test` and `bun run check:all` exit 1 with a pointer to the light gate. The full suite is orchestrator-owned: it runs once per landing tree in the merge-train (`/process-gh-issues` §4 step 4), on the rebased state that actually lands, so a per-branch run is re-paid there anyway. The merge-train gates from a dedicated **gate worktree** (detached HEAD, not an issue branch) or prefixes its command with `TOLARIA_ALLOW_FULL_SUITE=1` — that env var is the escape hatch for any genuine exception.

**A fresh worktree is not runnable — bootstrap it with one command.** `git worktree add` gives you a tree whose gitignored inputs are all missing: `node_modules`, `convex/_generated` (codegen output), `.env.local`, and husky's generated `.husky/_`. Run **`bun run worktree:init`** as the first command in any new worktree (`scripts/bootstrap-worktree.ts` — idempotent, copies from the primary checkout, installs deps, regenerates the hook shims; `--force` re-copies). Two failure modes it exists to prevent:

- Without `convex/_generated`, ~216 test **files** fail at _import_ (`Cannot find module './_generated/api'`). The tell is **`216 files failed, 0 tests failed`** — a setup error that reads as a catastrophic red baseline and sends you debugging the wrong thing.
- Without `.husky/_`, `core.hooksPath` (repo-level, shared by every worktree, and **relative** — resolved per working tree) points at nothing, so pre-commit silently skips `lint-staged` and prettier drift reaches the merge-train.

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

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
