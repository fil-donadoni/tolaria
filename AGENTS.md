<!-- GENERATED FILE — DO NOT EDIT.
     Source: CLAUDE.md + .claude/rules/*.md
     Regenerate: bun run agents:build
     Guarded by: scripts/__tests__/agents-md-drift.test.ts
     Edit the source, never this file. -->

# AGENTS.md

Project instructions for **Codex** and **opencode**. Claude Code reads
`CLAUDE.md` and `.claude/rules/*.md` instead; this file is generated from
exactly those sources so all three harnesses act on the same rules.

Everything below the horizontal rule is the path-specific rule set. Claude
Code loads it lazily, per directory; Codex and opencode cannot, so it is
inlined here in full. The deeper reference material lives in
`convex/CLAUDE.md` and `src/CLAUDE.md` — read the one that covers the code
you are touching.

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

**Mandatory for any diff that can change what a user sees**, at five viewports
with a measured receipt (happy-dom has no layout): **`bun run check:ui`**, its
output pasted byte-exact, `bun run land` enforcing it. Engine/Convex/script
work owes nothing here. Rule: `.claude/rules/chrome-debug.md` (resident);
procedure and click sequences: `docs/guides/browser-verification.md`,
`docs/guides/ui-runbooks.md`.

## Automated Development Workflow

### Skills

Work-intake skills converge on: grill → `/to-prd` → `/to-tickets` → issues
labelled `ready-for-agent`; **`/next-issue` drains that queue one issue per
session** (ADR 0110 — single-session pipeline). Pick intake by where work
comes FROM:

| Skill                | Trigger                         | Does                                                                                                           |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/next-issue`        | Draining the queue              | ONE issue end-to-end in this session: pick → worktree → implement → one routed review → land                   |
| `/new-card`          | One new card                    | Scryfall oracle → Ops mapping / gap flags → PRD + tickets                                                      |
| `/new-set`           | Whole set rollout               | MTGJSON profile, per-card triage, capability clusters, umbrella PRD                                            |
| `/new-qa-issue`      | Observed bug/enhancement        | Explores, drafts one agent-readable issue, posts after confirmation                                            |
| `/audit-tracker <N>` | Stale roll-up issue             | Re-verifies gaps vs HEAD, slices survivors, retires the tracker                                                |
| `/process-gh-issues` | LEGACY fan-out (ADR 0110)       | File-disjoint batch, parallel implement, review, serial merge-train — being retired in favour of `/next-issue` |
| `/mtg-rules-check`   | Before any game mechanic        | CR text + implementation status                                                                                |
| `/gre-test`          | Adding/modifying GRE logic      | Generates vitest tests per project patterns                                                                    |
| `/new-op`            | Card needs a missing DSL verb   | Walks all seven Op registration sites + the Op's permanent test                                                |
| `/bot-slice`         | Any play-Bot / draft-Bot change | Maps the AI subsystem, walks seams, enforces verification doctrine                                             |

**Workflow skills are versioned in this repo** (`.claude/skills/…`), changed
via branch + PR + gate like any source file
(`scripts/__tests__/project-skills.test.ts` guards against drift to the
user-level directory). A rule that CAN be enforced mechanically belongs in a
script the gate runs (`scripts/queue-plan.ts`, `scripts/gate.ts`, hooks) —
prose is the fallback for judgment, not the home of invariants.

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
8. **Bot reachability** — a new card/mechanic must be one the Bot can PLAY: no
   freeze, no silent ignore. Three seams per
   `.claude/rules/gre-development.md` § Bot reachability; declare the outcome
   in the PR like a preset scenario. The guards cover valuation only, and the
   `blade` receipt field fires on `BOT_GLOBS`, which a new card never touches.
9. **UI verify** — mandatory whenever the diff can change what a user sees
   (`bun run check:ui`, five viewports + probe receipt,
   `.claude/rules/chrome-debug.md`); nothing owed when the diff cannot reach
   the DOM

### Quality gates (mandatory, no exceptions)

Rationale, lane contents and measurements: `docs/agents/quality-gates.md`.

| When       | Run                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iterating  | targeted only — `bunx vitest run <path>`. Formatting is automatic.                                                                                      |
| Pre-PR     | `bunx vitest run <paths touched>` + **`bun run check:lane`** (falls back to `check:pr` verbatim)                                                        |
| Merge      | `bun run land <PR#>` — rebase + **`check:lane`** under the machine mutex (ADR 0110)                                                                     |
| Post-merge | **`bun run health:main`** (detached by `land` automatically) — `check:all` + full 3-suite `test` on the merged tip; verdict via `bun run health:status` |

- **`bun run check:lane` is the default pre-PR path** (#2738/#2741/#2743). It
  classifies the diff into `skin` (`src/**` only) / `engine` (no `src/**`) /
  `docs` (markdown under `docs/**`, a root `.md`, or a nested
  `CLAUDE.md`/`AGENTS.md`, delegating to `check:docs` verbatim) / `full`, runs
  exactly the checks that lane's plan names, and prints a per-check receipt. On
  anything it cannot affirmatively place — a mixed diff (**prose mixes with
  nothing**), `package.json`, a lockfile, `.claude/**`, an unrecognised path —
  it degrades to `check:pr` **verbatim**, so the fallback can never rot.
  **No lane ever scopes a project's tests to the diff**: the diff decides
  whether a project runs at all, never a diff-derived slice of it (ADR 0104,
  derivation in `docs/agents/quality-gates.md`).
- **Never hand-pick a subset of `check:pr`** — omitting `check:index` once
  broke every card-shipping PR at the merge-train.
- **`check:all` VERIFIES formatting**, it does not repair it — on drift run
  `bun run format` and re-run (#1807).
- **`bun run test` is three suites** — `test:app` → `test:bot` → `test:blade`.
  **Name any new bot/AI test `*.bot.test.ts`**; `bot-suite-boundary.test.ts`
  enforces it.
- **Cover `src/` changes with targeted runs** — the dom project is outside the
  light gate.
- **There is no CI: the local gates are the only gates.** Nothing may be left
  to CI. The full offline gate runs post-merge (`health:main`, ADR 0110) —
  running it by hand before a merge is never wrong, just not owed.

**CPU admission control** (`scripts/gate.ts`) — several sessions share this
machine:

| Tier      | Commands                                                           | Behaviour                                                             |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **heavy** | `bun run test`, `test:app`, `test:bot`, `check:all`                | machine-wide mutex (`~/.cache/tolaria/gate.lock`), `ncpu - 1` workers |
| **light** | `bunx vitest run <path>`, `check:pr`, `check:ts`, `lint`, `format` | no lock, vitest capped at 2 workers (`TOLARIA_VITEST_WORKERS`)        |

A queued heavy gate is not a hang: the waiter names its holder, **`bun run
gate:who`** prints that plus its CPU, and a holder whose subtree stops burning
CPU stops heartbeating and is reclaimed (issue #2999).
**The full gate is blocked inside an issue worktree**
(`feat/issue-N`/`fix/issue-N` → exit 1); `TOLARIA_ALLOW_FULL_SUITE=1` is the
orchestrator-only escape hatch.

**Worktree isolation — the shared checkout is read-only.** Every file you
author goes in a worktree, **including one line of markdown** (markdown is
gated too, so an unfinished ADR there reds `check:all` for every other session
on this machine). Enforced by `deny-guard.sh` § 0; gitignored paths stay
writable; per-session hatch `TOLARIA_ALLOW_MAIN_EDIT=1 claude`. Docs-only
lane — `bun run wt:docs <slug>` → write → `bun run docs:ship` (`check:docs`:
seconds, no lock). Anything else: own worktree + full gate. Rationale and
measurements: `docs/agents/quality-gates.md` § Worktree isolation.

**Merging goes through `bun run land <PR#>`, from anywhere** (#2537). The gate
mutex serialises gating; `land` extends it across rebase → `check:lane` →
push → merge, so the tree that lands is the tree that was gated, then detaches
the post-merge health gate (ADR 0110). It also fast-forwards the primary
checkout's local `main` onto the merged tip — the API merge moves only
`origin/main`, and the next worktree must not branch from a stale one. Never
do that catch-up by hand. `deny-guard.sh` § 1 denies a
hand-typed `gh pr merge` in every directory; if only the MERGE failed, retry
`bun scripts/pr-merge.ts <PR#>` — never a second `land`, which re-pays the whole
gate. Per-command hatch: `TOLARIA_ALLOW_MANUAL_MERGE=1`. A `skin`-lane PR owes
a byte-exact `check:ui` receipt only if its diff can reach the DOM — a
test-only `src/**` diff is exempt (ADR 0110 §4).

**Fresh worktrees need `bun run worktree:init`.** The tell for a missing
bootstrap: **`216 files failed, 0 tests failed`** (import errors, not a red
baseline).

**Green-main invariant (ADR 0110): `main` is green within one health cycle.**
`land` proves the lane; `health:main` proves the rest on the merged tip and
leaves a durable `RED` marker on failure (`bun run health:status`). A RED
marker means fix-forward FIRST — never stack unrelated work on a red tip,
never silence a test, "not my test" is not an exemption. (The old per-PR
full gate did not actually keep `main` green under concurrency — see ADR
0110 §3 for the incident.)

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
fetch. Third-party mirrors are removed; an ad-hoc `curl` of a remembered
rules URL is the habit this replaced.

**Never cite a rule number you have not printed.** `bun run cr:lint` runs in
`check:guards` and reds on an id that resolves to nothing, plus a second scan
that reds when a `CR 701.N`/`702.N` line names a different keyword than the
section title (Wizards renumbers the 701 block alphabetically every few
revisions, so keyword citations rot silently).

**Keep the citation, its `CR ` prefix and its keyword word on ONE line** —
that single habit covers every blind spot the scanner has. What it cannot
catch at all is a **resolvable but wrong** id outside 701/702: the scan only
asks whether an id exists, so the correction must come from `bun run cr <id>`
printing text that matches the claim.

`bun run cr:check` says whether a newer document exists, `bun run cr:sync`
takes it; `cr:check` is deliberately outside `check:all` — the gate is offline
by contract. Derivation and the correction-pass numbers:
`docs/agents/gre-guards.md` § CR citation linting.

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

- **Ante & subgames** (ADR 0010)

## Agent skills

- **Guides**: `docs/guides/` answers "how do I RUN this?" (AFK loop, …) —
  index at `docs/guides/README.md`. Read on demand, never resident.
- **Issue tracker**: GitHub Issues, `gh` CLI. See `docs/agents/issue-tracker.md`.
  In agent output and generated artifacts (terminal, commits, receipts)
  **qualify every reference: `issue #NNN` / `PR #NNN`.**
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

---

# Path-specific rules (inlined)

## Rules

<!-- source: .claude/rules/bot-development.md -->

# Bot Development Rules

You are in the Bot — read `/bot-slice` first; full seam map + doctrine.

- Every behaviour change ships a `must` blade entry in the same PR
  (`convex/gre/ai/blade/`) — a discriminating pair when the fix is a
  preference. Don't debug via self-play.
- Fix the class, never the card — no card names in identifiers, no
  per-card registries (ADR 0102).
- Ladder is for STRENGTH claims only — declare rung + pairing dynamics;
  never to explain WHY a decision happened.
- Tests are `*.bot.test.ts` (`bot-suite-boundary.test.ts` enforces it).
- A new `EvalTerms` key needs its row in `src/lib/ai/eval-term-labels.ts`
  — the ONE table the DecisionTrace line and its legend render from
  (`Record<keyof EvalTerms, …>`, so `tsc` reds on a missing row). #2686
  shipped `manaDevelopment` and it was invisible in both.
- Determinism required — fixed `iterations`, never wall-clock (`timeMs`).
- A NEW CARD owes a Bot reachability walk too, though its diff touches no bot
  path (`gre-development.md` § Bot reachability).

## Browser Verification Rules

<!-- source: .claude/rules/chrome-debug.md -->

**A change that can alter what a user SEES is not done until a real browser has
shown it.** happy-dom has no layout engine, so "the card is in the document"
passes on a screen where the card sits in a 24px-tall container.

**Applies to** any diff reaching a component, CSS, layout, responsive rule,
overlay/z-index or scroll container. Not to engine/Convex/script/doc changes —
say so in one line and move on.

**Run `bun run check:ui`** (#2580). It owns its own Vite + headless Chrome,
signs in, walks the runbook surfaces at all five viewports (ADR 0101), probes
and runs axe. **Its output IS the receipt — paste it byte-exact, banner +
coverage line included** (#2760); `bun run land` re-derives them and refuses a
`skin`-lane PR that does not match. Only a `RECEIPT` run, never `DIAGNOSTIC`;
never reflow a row.

**A surface it could not reach prints `UNWALKED` and reds the run** — that is a
coverage failure, not a pass.

**Measure, never eyeball.** A screenshot of a clipped row reads as "the cards
are there" — that is how the bug above shipped. A UI PR with no receipt and no
"cannot reach the DOM" note is not done.

**Gameplay checks use solo mode** — one user, both seats. Never a second tab
for the opponent.

## Frontend Component Rules

<!-- source: .claude/rules/frontend-components.md -->

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

## GRE Development Rules

<!-- source: .claude/rules/gre-development.md -->

When modifying files in `convex/gre/` or `convex/cards/`.

### Rules compliance

CR-compliance is the default — never ask whether to follow it. **Print the
rule, never recall it** (ADR 0098): `bun run cr <id>`, vendored, offline. Every
mechanic cites its CR section in a comment, on ONE line that says `CR `. Flag
any deviation explicitly.

### DSL-first authoring (ADR 0045)

A new card's effect is an **Effect Script by default** (`effects: EffectOp[]`).
`resolve()` / `resolveSteps` / `effect` are for protocol-like cards only and
need an explicit `// protocol card: <why>` plus a note in the PR. **A missing
Op is not a justification** — that is stop-and-open-an-issue. Consult
`convex/cards/mechanicsRegistry.ts` first; it is the single name authority for
keywords and Ops.

- **Guard A — keyword-must-be-implemented (#962).** A shipped card's
  `staticAbilities[]` must resolve to a registry row with
  `status: "implemented"`, or carry a `KEYWORD_ALLOWLIST` row with a real open
  issue.
- **Guard B — documented-divergence-needs-issue (#962/#1900).** Every
  confession marker under `convex/cards/sets/**` carries `tracked-by: #NNN` or
  an out-of-scope note. Guard B polices markers, it does not licence them: the
  default is no marker — implement the clause.
- **A MECHANIC is implemented WHOLE**, never partially shipped behind a
  marker: every subrule of its CR section, on every surface.
- **Per-Op test regime.** A DSL card using only already-exercised Ops needs no
  hand-written test — the static sweep plus the generated smoke test cover it.
  A card introducing a **new Op** earns that Op its permanent test.

### Testing requirement

Tests in `convex/gre/__tests__/`, each naming its CR section. `bun run test`
zero failures after any change.

### Proof-of-failure (mandatory for every new guarding test)

**A test you have never seen fail is not evidence.** Break the code it guards,
watch it go red, revert, state what you broke. Applies to every test whose job
is to catch something. SURFACE assertions must traverse `projectPublicState` /
`buildTriggerStateView` — a hand-built view does not count.

### Card testing convention (resolve() cards and new Ops)

Colour-split per-set test files (ADR 0043); shared fixtures from
`convex/cards/__tests__/setup.ts`, never duplicated. **Every per-card test MUST
call something** — a block that reads definition fields and asserts them is the
definition written twice.

**Wire format test** is mandatory for `staticEffects[]` and for any
`activatedAbilities[]` outcome visible on the board: the projection strips fat
fields, so a GRE-only test passes while the client breaks silently.

### End-to-end targeting test (mandatory for new target types)

A new `TargetRequirement.type` is tested at GRE, backend and all three frontend
sites. **Every feature crossing GRE to game.ts to UI needs at least one
full-path integration test.**

### Frontend wiring analysis (mandatory for EVERY new card/mechanic)

A card correct in the GRE can be dead in the UI — the client sees only view
reducers, and every reducer can silently drop a field. This is the single most
common recurring bug class. **Walk the reducers before marking done**:
`projectPublicState`, `buildTriggerStateView`, `getStackAbilities`,
`matchesTargetRequirement` / `TARGET_LABEL`.

### Bot reachability analysis (mandatory for EVERY new card/mechanic)

Mirror of the above, other side of the engine: a card correct in the GRE can be
one the **Bot never plays**. Nothing catches that for a new card — the censuses
cover VALUATION only, and the `blade` receipt field fires on `BOT_GLOBS`, which
`cards/sets/**` never touches. **Walk three seams**: `enumerateMoves`
(reachable?), the choice surface (can it answer?), `OP_VALUERS` +
`OP_BENEFICENCE` (does it want to? — the sign fails open to neutral). Declare
the outcome in the PR like a preset scenario: a `must` blade entry, or one line
naming the seam that covers it. Walk: `docs/guides/bot-reachability.md`.
**Ignored and frozen are both unshipped.**

### Exhaustive target-type matching

Code switching on `TargetRequirement.type` uses an exhaustive helper or lists
every union member. New value: grep and update every consumer.

### Serialization requirement

Every optional `GameState` field goes in `PERSISTED_OPTIONAL_KEYS` or
`TRANSIENT_KEYS` (`serialize.ts`); the drift guard fails otherwise.

### Code patterns

Pure functions, no async. Card definitions are DATA. Types from
`convex/cards/types.ts` / `convex/gre/state.ts`, constants from
`convex/gre/constants.ts` — never local copies. Mana abilities use
`useStack: false` (CR 605.3a).

### Primitive reuse (mandatory)

Before adding a `SpellContext` primitive: decompose into existing ones,
generalize rather than add, keep it orthogonal (never card-shaped), prefer
composition over behaviour-changing flags. Still needed? Flag it in the PR.

### Card definition checklist

Mana cost against Scryfall; keywords via the Mechanics Registry;
`targetRequirement` for targeted spells; Effect Script by default. **One Oracle
line = ONE `TriggeredAbility`** with `event: GameEventType[]` (CR 603.2).
**Token/emblem art is mandatory setup** (CR 114/111) — a missing image renders
a placeholder silently.
