# CLAUDE.md

Guidance for Claude Code in this repository. Norms here are terse by design;
each carries a `#NNN` / ADR ref where the full history lives — read the ref
before relitigating a rule.

## Project Overview

Tolaria is an MTG (Magic: The Gathering) gameplay engine for study and
experimentation. Focus: rules correctness and real-time reactivity between two
clients. Not commercial — an extensible engine with a working subset of cards.

## Tech Stack

| Layer           | Technology                     | Notes                                      |
| --------------- | ------------------------------ | ------------------------------------------ |
| Frontend        | React 19 + TypeScript + Vite 8 | React Compiler enabled                     |
| Backend/DB      | Convex                         | Real-time reactive state, atomic mutations |
| Auth            | @convex-dev/auth (Password)    | Email + password + nickname                |
| Package manager | bun                            |                                            |

TypeScript ~5.9 strict (project refs: `tsconfig.app.json` src, `tsconfig.node.json` config). ESLint 9 flat config (`typescript-eslint`, `react-hooks`, `react-refresh`).

## Commands

- `bun run dev` — dev server with HMR
- `bun run build` — `tsc -b` then Vite build
- `bun run lint` — ESLint
- `bun run preview` — preview production build

## Architecture

```
Client React (P1) ──┐
                    ├── Convex (game state) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

Gameplay domain is architecturally separated from surrounding features
(matchmaking, profiles, collections).

### Game Rules Engine (GRE)

Runs **server-side** in Convex mutations. The client never validates rules —
it is only a view of the state.

- **Authoritative**: every move validated server-side before applying
- **Deterministic**: same event log ⇒ same state
- **Isolated**: rules logic independent of transport

### Authentication

`@convex-dev/auth` Password provider (email + password + nickname). Every
query/mutation touching user-owned data uses `getCurrentUser(ctx)` /
`getCurrentUserId(ctx)` from `convex/auth.ts`. Router root wrapped in
`<AuthGate>` — every route requires login, no anonymous play. Email
verification off in development.

### Player identity in games

`players[].id` is an opaque string handle used by the GRE as
`controllerId`/`ownerId`. 2-player: equals `Id<"users">`; solo:
`${userId}-p1` / `${userId}-p2`. Schema keeps it `v.string()` — do NOT type
it as `Id<"users">`. Game mutations derive id and nickname from `ctx.auth`;
clients cannot spoof identity.

### Data model

- `game_state` — current snapshot (cache, overwritten per action, deleted at game end)
- `game_events` — append-only event log (source of truth for replays, 30-90 days)

User decks in `userDecks` (indexed by `userId`); preset decks in
`convex/deckPresets.ts` (served via `api.decks.list`). State saved **only at
stable points** (waiting for human input).

### Action flow

```
1. Client sends action → Convex mutation
2. GRE validates → applies in memory → generates internal events
3. Trigger scan → triggers go to stack (never auto-resolve)
4. SBAs applied (automatic, no priority)
5. Stable state → save game_state + append game_events → clients react
```

### Stack, priority, turn structure

Stack resolves one item at a time, top-down; after each resolution priority
restarts from the active player; both must pass consecutively to proceed.
Priority timeout 30s via `ctx.scheduler.runAfter` with seq-based cancellation.
Phases: BEGINNING (untap/upkeep/draw) → PRECOMBAT_MAIN → COMBAT (5 substeps) →
POSTCOMBAT_MAIN → ENDING. Untap and cleanup are automatic (no priority).

## Project Structure

```
convex/            # Backend
├── schema.ts      # Tables
├── game.ts        # Public mutations/queries
├── cards/         # Card definitions as data (index.ts registry, types.ts, sets/)
└── gre/           # Engine: engine.ts, phases.ts, stack.ts, triggers.ts, sba.ts, actions/
src/               # Frontend (React + Vite)
├── components/    # Battlefield, Hand, Stack, Card
└── hooks/         # useGameState.ts (wrapper on Convex useQuery)
```

**Key boundary — authority, not imports** (ADR 0074): the frontend MAY import
pure engine modules from `convex/gre/` and `convex/limited/` (client-side
Brain, Draft Lab do so routinely — sharing the module prevents drift). What
the frontend never has is **authority**: no client-side engine run produces
persisted or trusted state; every real move goes through a public mutation in
`convex/game.ts` and is re-validated server-side.

## Card Definition System

Cards are **data**, not imperative code. Three levels:

1. **Pure data** — vanilla creatures, basic lands
2. **Declarative behavior** — triggered/activated/static abilities as
   structured templates; one-shot effects as an **Effect Script**
   (`effects: EffectOp[]`, ADR 0045) — the mandatory DSL-first default
3. **Imperative `resolve()`** — escape hatch for protocol-like cards only
   (Word of Command, Camouflage), never the default

Continuous static effects are data: `staticEffects[]` computed by the layer
system (`convex/gre/layers.ts`, CR 611/613). Replacement effects shipped
(`gre/replacements.ts`).

**Effect Script DSL** (ADR 0045/0046): ordered `EffectOp[]` (`dealDamage`,
`draw`, `destroy`, `choice`, …) + four frozen structural constructs (`bind`,
`ref`, `if`, `forEach`), interpreted by `convex/gre/effects/interpreter.ts` at
every effect site. The **Mechanics Registry**
(`convex/cards/mechanicsRegistry.ts`) is the single authority on keyword and
Op names (CI-enforced) — an uncensused mechanic is stop-and-open-an-issue,
never an invented name. Testing is per-Op, not per-card: a DSL card reusing
exercised Ops needs no hand-written test (static sweep + generated smoke test
cover it); a card introducing a new Op earns that Op its permanent test.
`resolve()` needs an explicit justification
(`.claude/rules/gre-development.md` § DSL-first authoring).

Key types: `convex/cards/types.ts` (`CardDefinition`, `ActivatedAbility`,
`ManaCost`, `SpellContext`, `TargetRequirement`, `EffectOp`). Mana abilities
have `useStack: false`. SBAs are global rules in `sba.ts`; cards declare only
`sbaMods` exceptions.

## Code Organization

- **One component per file.** No inline/helper components beside the parent.
- **Extract, don't inline.** Growing logic moves to named functions/files.
- **Types are centralized.** `convex/` is the source of truth
  (`cards/types.ts`, `gre/types.ts`, `gre/state.ts`); `src/types/` re-exports.
  No local type definitions in components.
- **Constants/helpers are shared.** `LAND_SUBTYPE_MANA`, `PERMANENT_TYPES`,
  `isCreature`, `isLand`, … live in `convex/gre/constants.ts` — no local copies.

## Collaboration Mode

Claude operates **autonomously**: implements, tests, validates end-to-end.
The user defines features and strategy. Ask only on significant architecture
decisions or genuine CR ambiguity affecting behavior.

### Subagent model routing (cost)

**Enforced by `.claude/hooks/spawn-guard.sh`** (prose alone measured 12% of
spawns leaking to the inherited tier over 30 days):

- Every `Agent` spawn MUST pass an explicit `model` (except `fork`).
  **`model: sonnet` for all read-only/mechanical delegation** (locate, map,
  survey, research); the session tier only for genuinely hard implementation
  or reasoning.
- Every `description` MUST be role-prefixed — `implement` / `review` /
  `fixup` / `investigate` / `research` / `verify` / `migrate` / `audit` —
  it is what attributes tokens to a role in the scorecard.
- Cavecrew agents are the caveman **plugin's**: spawn as
  `caveman:cavecrew-investigator` / `-builder` / `-reviewer`, always with
  `model: sonnet` (they pin no model of their own; the duplicate user-level
  copies were removed in #2189).

## Browser verification

**Mandatory for any diff that can change what a user sees** — component, CSS,
layout, responsive rule, overlay, scroll container — at five viewports, with a
measured receipt, because happy-dom has no layout and cannot see a collapsed
or occluded element. Run **`bun run check:ui`** (#2580): it drives headless
Chrome through the runbook surfaces, probes + axe, and fails on
`scripts/ui-gate/budgets.json`; its output IS the receipt — paste it
byte-exact, banner + coverage line included (#2760; `bun run land` enforces
this — see `.claude/rules/chrome-debug.md`).
Engine/Convex/script work owes nothing here. Rule:
`.claude/rules/chrome-debug.md` (auto-loaded); procedure and click sequences:
`docs/guides/browser-verification.md`, `docs/guides/ui-runbooks.md`.

## Automated Development Workflow

### Skills

Work-intake skills converge on: grill → `/to-prd` → `/to-tickets` → issues
labelled `ready-for-agent`; `/process-gh-issues` is the single implementer
draining that queue. Pick intake by where work comes FROM:

| Skill                | Trigger                         | Does                                                                |
| -------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `/new-card`          | One new card                    | Scryfall oracle → Ops mapping / gap flags → PRD + tickets           |
| `/new-set`           | Whole set rollout               | MTGJSON profile, per-card triage, capability clusters, umbrella PRD |
| `/new-qa-issue`      | Observed bug/enhancement        | Explores, drafts one agent-readable issue, posts after confirmation |
| `/audit-tracker <N>` | Stale roll-up issue             | Re-verifies gaps vs HEAD, slices survivors, retires the tracker     |
| `/process-gh-issues` | Draining the queue              | File-disjoint batch, parallel implement, review, serial merge-train |
| `/mtg-rules-check`   | Before any game mechanic        | CR text + implementation status                                     |
| `/gre-test`          | Adding/modifying GRE logic      | Generates vitest tests per project patterns                         |
| `/new-op`            | Card needs a missing DSL verb   | Walks all seven Op registration sites + the Op's permanent test     |
| `/bot-slice`         | Any play-Bot / draft-Bot change | Maps the AI subsystem, walks seams, enforces verification doctrine  |

**Workflow skills are versioned in this repo** (`.claude/skills/…`), changed
via branch + PR + gate like any source file
(`scripts/__tests__/project-skills.test.ts` guards against drift to the
user-level directory). A rule that CAN be enforced mechanically belongs in a
script the gate runs (`scripts/queue-plan.ts`, `scripts/gate.ts`, hooks) —
prose is the fallback for judgment, not the home of invariants.

### Path-specific rules (auto-loaded)

- `convex/gre/**`, `convex/cards/**` → CR compliance, testing, patterns
- `src/components/**` → one-component-per-file, type sourcing, UI testing
- `convex/gre/ai/**`, `src/lib/ai/**` → Bot verification doctrine — blade first

### Development cycle

1. **Discuss** — user describes the feature/rule
2. **Verify rules** — `/mtg-rules-check` for CR text + current status
3. **Plan** — agree scope: implement now vs defer
4. **Implement** — Effect Script by default (ADR 0045); consult the Mechanics
   Registry before writing; `resolve()` only for protocol-like cards with
   recorded justification
5. **Test** — `resolve()` cards and new Ops: tests at ALL layers (GRE unit,
   game.ts integration, frontend utils, wire format — two pieces passing
   individually but failing together is a shipped bug; every feature crossing
   GRE → game.ts → UI needs one full-path integration test). DSL cards on
   exercised Ops: the per-Op regime covers them (static sweep + generated
   smoke test), no hand-written test. **Frontend wiring is not optional**:
   walk the view reducers per `.claude/rules/gre-development.md` § Frontend
   wiring analysis; SURFACE tests must run through the reducer. While
   iterating run only targeted tests (`bunx vitest run <path>`). **Every
   guarding test must be proven to fail** (break the subject, watch red,
   revert, say what you broke — § Proof-of-failure).
6. **Validate** — full gate once before done: `bun run check:all` +
   `bun run test`, both zero-error
7. **Preset scenario** — for any new card/gameplay feature (ADR 0044; DB is
   the single source of truth, #770/#1455). Headless agents do NOT insert it:
   emit one `{ label, spec }` in the PR receipt; the orchestrator registers
   it post-merge via `npx convex run debugScenarios:seedScenarioDirect`
   (upserts by label; row is deployment-local by design). Interactive work:
   Debug panel → Scenarios → "Save scenario" (`saveDebugScenario`). Skip only
   for pure refactors.
8. **UI verify** — mandatory whenever the diff can change what a user sees
   (`bun run check:ui`, five viewports + probe receipt,
   `.claude/rules/chrome-debug.md`); nothing owed when the diff cannot reach
   the DOM

### Quality gates (mandatory, no exceptions)

Rationale, lane contents and measurements: `docs/agents/quality-gates.md`.

| When              | Run                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Iterating         | targeted only — `bunx vitest run <path>`. Formatting is automatic.                               |
| Pre-PR            | `bunx vitest run <paths touched>` + **`bun run check:lane`** (falls back to `check:pr` verbatim) |
| Before done/merge | **`bun run check:all`** + **`bun run test`**, both zero-error                                    |

- **`bun run check:lane` is the default pre-PR path** (#2738/#2741/#2743). It
  classifies the diff into `skin` (`src/**` only) / `engine` (no `src/**`) /
  `full`, runs exactly the checks that lane's plan names, and prints a
  per-check receipt. On anything it cannot affirmatively place — a mixed
  diff, `package.json`, a lockfile, `.claude/**`, an unrecognised path —
  it degrades to `check:pr` **verbatim**, unchanged, so the fallback can never
  rot. **No lane ever scopes a project's tests to the diff** — the `skin`
  lane's `node[src,scripts]` carries a path argument (`src/ scripts/`), but
  it is a fixed, declared subset of the lane, not one computed from the
  changed files; every other admitted project runs whole, exactly as
  `check:pr` runs it. The diff decides whether a project runs at all, never
  a diff-derived slice of it (ADR 0104, which also records why this does not
  revert #2431/#2655).
- **Never hand-pick a subset of `check:pr`** — omitting `check:index` once
  broke every card-shipping PR at the merge-train.
- **`check:all` VERIFIES formatting**, it does not repair it — on drift run
  `bun run format` and re-run (#1807).
- **`bun run test` is three suites** — `test:app` → `test:bot` → `test:blade`.
  **Name any new bot/AI test `*.bot.test.ts`**; `bot-suite-boundary.test.ts`
  enforces it.
- **Cover `src/` changes with targeted runs** — the dom project is outside the
  light gate.
- **There is no CI: the local gate is the only gate.** Nothing may be left to
  CI, and the merge-train always takes Lane B (local full gate on the rebased
  tree).

**CPU admission control** (`scripts/gate.ts`) — several sessions share this
machine:

| Tier      | Commands                                                           | Behaviour                                                             |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **heavy** | `bun run test`, `test:app`, `test:bot`, `check:all`                | machine-wide mutex (`~/.cache/tolaria/gate.lock`), `ncpu - 1` workers |
| **light** | `bunx vitest run <path>`, `check:pr`, `check:ts`, `lint`, `format` | no lock, vitest capped at 2 workers (`TOLARIA_VITEST_WORKERS`)        |

A queued heavy gate is not a hang. **The full gate is blocked inside an issue
worktree** (`feat/issue-N`/`fix/issue-N` → exit 1); `TOLARIA_ALLOW_FULL_SUITE=1`
is the orchestrator-only escape hatch.

**Worktree isolation — the shared checkout is read-only.** Every file you
author goes in a worktree, **including one line of markdown** (markdown is
gated too, so an unfinished ADR there reds `check:all` for every other session
on this machine). Enforced by `deny-guard.sh` § 0; gitignored paths stay
writable; per-session hatch `TOLARIA_ALLOW_MAIN_EDIT=1 claude`. Docs-only
lane — `bun run wt:docs <slug>` → write → `bun run docs:ship` (`check:docs`:
seconds, no lock). Anything else: own worktree + full gate. Rationale and
measurements: `docs/agents/quality-gates.md` § Worktree isolation.

**Merging goes through `bun run land <PR#>`, from anywhere** (#2537). The gate
mutex serialises gating; `land` extends it across rebase → gate → push → merge,
so the tree that lands is the tree that was gated. `deny-guard.sh` § 1 denies a
hand-typed `gh pr merge` in every directory; if only the MERGE failed, retry
`bun scripts/pr-merge.ts <PR#>` — never a second `land`, which re-pays the whole
gate. Per-command hatch: `TOLARIA_ALLOW_MANUAL_MERGE=1`.

**Fresh worktrees need `bun run worktree:init`.** The tell for a missing
bootstrap: **`216 files failed, 0 tests failed`** (import errors, not a red
baseline).

**Zero-red is absolute (green-main invariant).** `main` is always green. "Not
my test" is not an exemption; never branch off red, never merge on red, never
silence a test. Red baseline → fix or surface first.

**Browser verification is a gate for UI-affecting diffs** — `bun run check:ui`,
five viewports, `.claude/rules/chrome-debug.md`. It stays outside `check:all`
(the full gate is offline by contract; this lane needs a live Convex
deployment and a browser), so nothing fails on its absence: the receipt in the
PR is the whole enforcement. A surface the lane could not reach prints
`UNWALKED` and exits non-zero — a coverage hole is a red, not a pass.

## Rules Implementation Process

Always cross-reference against the official CR. Before writing code, discuss
uncovered details (edge cases, interactions, timing) and decide implement-now
vs defer together.

**The CR is vendored, and it is the only source** (ADR 0098):
`data/cr/comprehensive-rules.txt` + `data/cr/VERSION.json`, sliced by
`bun run cr 605.1a` / `bun run cr grep "<keyword>"` — offline, exact, no
fetch. Third-party mirrors (yawgatog, ancestral.vision — the latter frozen at
2022-10-07) are removed, and an ad-hoc `curl` of a remembered
`MagicCompRules YYYYMMDD.txt` URL is the habit this replaced: twelve distinct
versions, back to 2022, appear in past session transcripts. **Never cite a rule
number you have not printed** — 44 of the 850 distinct ids cited in this repo
resolved to nothing, and nearly all of them never existed in any revision; all
44 were corrected in #2429 and **`bun run cr:lint` now runs in `check:guards`**,
so a new one cannot land **on a line of its own or in a slash-list** (the
scanner resolves every bare `NNN.Nx` token on any line mentioning `CR ` — two of
the 44 ids, 10 sites, hid in exactly that shape and survived the first
correction pass). Three things still get past it: a citation **wrapped across
two comment lines** — so keep one on a single line; an id on a line mentioning
`CR ` **nowhere** (1,795 today, 597 of them in `mechanicsRegistry.ts` alone — a
deliberate boundary, since reaching them reds the gate on 16 ids that are mostly
not citations at all — including the happy-dom benchmark seconds quoted a few
sections above); and a **resolvable but wrong** id, since the scan only asks
whether an id exists.

**Resolvable-but-wrong is now covered for keywords.** `cr:lint` also runs a
SECOND scan (`scripts/cr-keyword-citations.ts`): for every `CR 701.N`/`702.N`
citation it reads the section TITLE out of the vendored document and reds when
the line names a different keyword — "701.19 search" is Regenerate, "701.16
sacrifice" is Investigate, "702.13 landwalk" is Intimidate. Wizards inserts
keyword actions alphabetically, so the 701 block renumbers every few revisions
and citations rot silently; keying the check on titles rather than numbers means
the NEXT renumbering reds the gate instead of going unnoticed. 793 sites stood
wrong when it was added (plus ~200 more, bare ids on keyword-less lines, found
by hand in the same pass). It sees only lines that name a keyword: keep the
citation and its keyword word on ONE line. Outside 701/702 the old caveat
stands — a citation "corrected" to a plausible-but-wrong number passes, which is
why the correction has to come from `bun run cr <id>` printing text that matches
the claim. Wizards
republishes roughly per set at
<https://magic.wizards.com/en/rules>; `bun run cr:check` says whether a newer
document exists, `bun run cr:sync` takes it. `cr:check` is deliberately outside
`check:all` — the gate is offline by contract.

## Implemented engine capabilities

Once deferred, since **shipped** — do not treat as out of scope:

- **Layer system** (`gre/layers.ts`, CR 611/613): P/T (7a–7e), color (5),
  type add (4), ability grant/removal (6), control (2), text-changing (3).
  Anthems and ability-stripping are `staticEffects[]` with `applies`.
- **Replacement effects** (`gre/replacements.ts`)
- **Complex/choice triggers**, simultaneous-trigger APNAP ordering (CR 603.3b)
- **Effect Script DSL** + Mechanics Registry (ADR 0045/0046) — the mandatory
  authoring default

When a card needs a capability that genuinely isn't built, flag it explicitly
— most mechanics are supported.

## Out of Scope

- **Full card catalog** — controlled growing set, not ~80k cards
- **3+ player multiplayer** — 2-player and solo only
- **Ante & subgames** (ADR 0010)

## Agent skills

- **Guides**: `docs/guides/` answers "how do I RUN this?" (AFK loop, …) —
  index at `docs/guides/README.md`. Read on demand, never resident.
- **Issue tracker**: GitHub Issues, `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Findings drawer**: `docs/findings/` = what a subagent noticed but was not
  asked to fix — draft, never an issue (the loop drains the queue, never
  fills it). Read via `bun run findings`; format in `docs/findings/README.md`.
- **Triage labels**: five canonical roles + model-routing labels. See
  `docs/agents/triage-labels.md`.
- **Domain docs**: `CONTEXT.md` + `docs/adr/`. ADRs are not auto-loaded —
  `docs/adr/README.md` is the queryable index; **every new ADR MUST add its
  index row** in the same change.

This project uses [Convex](https://convex.dev). When working on Convex code,
**always read `convex/_generated/ai/guidelines.md` first** — it overrides
training-data knowledge of Convex APIs. Convex agent skills:
`npx convex ai-files install`.
