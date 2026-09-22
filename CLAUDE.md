# CLAUDE.md

Guidance for Claude Code in this repository. Norms here are terse by design;
each carries a `#NNN` / ADR ref where the full history lives — read the ref
before relitigating a rule.

## Project Overview

Tolaria is an MTG (Magic: The Gathering) gameplay engine for study and
experimentation: rules correctness and real-time reactivity between two
clients. Not commercial: an extensible engine with a working subset of cards.

Stack, toolchain, commands and the file map are NOT here — read on demand from
`docs/PROJECT.md` (§ 2 Stack & toolchain / Comandi essenziali, § 7.3 Struttura
del frontend, § 13 Mappa rapida dei file). None of it is something a session
must know BEFORE it opens a file, so none of it is resident
(`docs/agents/context-residency-audit.md`).

## Architecture

```
Client React (P1) ──┐
                    ├── Convex (game state) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

The gameplay domain is separated from the surrounding features (matchmaking,
profiles, collections).

### Game Rules Engine (GRE)

Runs **server-side** in Convex mutations. The client never validates rules —
it is only a view of the state.

- **Authoritative**: every move validated server-side before applying
- **Deterministic**: seeded PRNG (`rngSeed`/`rngCounter`) — no event log
- **Isolated**: rules logic independent of transport

### Authentication

`@convex-dev/auth` Password provider (email + password + nickname). Every
query/mutation touching user-owned data uses `getCurrentUser(ctx)` /
`getCurrentUserId(ctx)` from `convex/auth.ts`. `<AuthGate>` at the router
root: every route requires login. Email verification off in development.

### Player identity in games

`players[].id` is an opaque string handle used by the GRE as
`controllerId`/`ownerId`. 2-player: equals `Id<"users">`; solo:
`${userId}-p1` / `${userId}-p2`. Schema keeps it `v.string()` — do NOT type
it as `Id<"users">`. Game mutations derive id and nickname from `ctx.auth`;
clients cannot spoof identity.

### Data model

- `gameStates` — **one row per game, patched in place** by `saveGameState`,
  its sole writer: compacted snapshot + monotonic `seq`. No undo history.
- `gameTicks` — ~150-byte wake-up companion row, written with every
  `gameStates` save so a subscriber need not hold the fat row.
- **There is no event log.** `game_events` was designed, never built: the
  snapshot is the source of truth. Detail: `docs/PROJECT.md` § Data model.

User decks in `userDecks` (indexed by `userId`); preset decks in
`convex/deckPresets.ts` (`api.decks.list`). State saved **only at stable
points** (waiting for human input).

### Action flow

```
1. Client sends action → Convex mutation
2. GRE validates → applies in memory → generates internal events
3. Trigger scan → triggers go to stack (never auto-resolve)
4. SBAs applied (automatic, no priority)
5. Stable state → patch `gameStates` + its `gameTicks` companion → clients react
```

### Stack, priority, turn structure

Stack resolves one item at a time, top-down; after each resolution priority
restarts from the active player; both must pass consecutively to proceed.
Priority timeout 30s via `ctx.scheduler.runAfter`, seq-based cancellation.
Phases: BEGINNING (untap/upkeep/draw) → PRECOMBAT_MAIN → COMBAT (5 substeps) →
POSTCOMBAT_MAIN → ENDING. Untap and cleanup are automatic (no priority).

## Key boundary — authority, not imports

**ADR 0074**: the frontend MAY import pure engine modules from `convex/gre/`
and `convex/limited/` (the client-side Brain and Draft Lab do). What the
frontend never has is **authority**: no
client-side engine run produces persisted or trusted state; every real move
goes through a public mutation in `convex/game.ts` and is re-validated
server-side.

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
`draw`, `destroy`, `choice`, …) + four frozen constructs (`bind`, `ref`, `if`,
`forEach`), interpreted by `convex/gre/effects/interpreter.ts`. The
**Mechanics Registry** (`convex/cards/mechanicsRegistry.ts`) is the single
authority on keyword and Op names (CI-enforced) — an uncensused mechanic is
stop-and-open-an-issue, never an invented name. Testing is per-Op: a DSL card
on exercised Ops needs no hand-written test (sweep + generated smoke test); a
new Op earns its permanent test. `resolve()` needs an explicit justification
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

**Enforced by `.claude/hooks/spawn-guard.sh`**:

- Every `Agent` spawn MUST pass an explicit `model` (except `fork`):
  **`model: sonnet` for read-only/mechanical delegation** (locate, map,
  survey, research); the session tier only for genuinely hard work.
- Every `description` MUST be role-prefixed — `implement` / `review` /
  `fixup` / `investigate` / `research` / `verify` / `migrate` / `audit`.
- Cavecrew agents: `caveman:cavecrew-investigator` / `-builder` /
  `-reviewer`, always `model: sonnet`.

### Shell commands

**A multi-token command is a shell ARRAY, never a quoted string.**
`CMD="tool --a 1"` + `"$CMD"` runs a file named `tool --a 1`. Write
`CMD=(tool --a 1)` + `"${CMD[@]}"`; a wrapper (`/usr/bin/time`, `env`,
`xargs`) is no exception.

## Browser verification

The rule is `.claude/rules/chrome-debug.md`, resident and not repeated here;
procedure and click sequences: `docs/guides/browser-verification.md`,
`docs/guides/ui-runbooks.md`.

## Automated Development Workflow

### Skills

Work-intake skills converge on: grill → `/to-prd` → `/to-tickets` → issues
labelled `ready-for-agent`; **`/next-issue` drains that queue one issue per
session** (ADR 0110 — single-session pipeline). Pick intake by where work
comes FROM:

| Skill                | Trigger                         | Does                                                                     |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `/next-issue`        | Draining the queue              | ONE issue end-to-end: pick → worktree → implement → review → land        |
| `/new-card`          | One new card                    | Compile state decides: artefacts (`ready`) / mechanic / rule / hand tail |
| `/new-set`           | Whole set rollout               | Compile-first scope, ranked Grammar Gap tickets, residue, umbrella PRD   |
| `/new-qa-issue`      | Observed bug/enhancement        | Explores, drafts one agent-readable issue, posts after confirmation      |
| `/audit-tracker <N>` | Stale roll-up issue             | Re-verifies gaps vs HEAD, slices survivors, retires the tracker          |
| `/mtg-rules-check`   | Before any game mechanic        | CR text + implementation status                                          |
| `/gre-test`          | Adding/modifying GRE logic      | Generates vitest tests per project patterns                              |
| `/new-op`            | Card needs a missing DSL verb   | Walks all eight Op sites (+ emitting Grammar Rule) + permanent test      |
| `/grammar-rule`      | One Grammar Gap                 | Rule + golden fixture per form → recompile → `ready` delta → graduation  |
| `/bot-slice`         | Any play-Bot / draft-Bot change | Maps the AI subsystem, walks seams, enforces verification doctrine       |

**Workflow skills are versioned in this repo** (`.claude/skills/…`), changed
via branch + PR + gate (`project-skills.test.ts` guards against drift to the
user-level directory). A rule that CAN be enforced mechanically belongs in a
script the gate runs — prose is for judgment, not the home of invariants.

### Path-specific rules — index resident, full text on demand

Two tiers, because a rule nobody can afford to load is a rule nobody follows.
`.claude/rules/*.md` is **resident in every session and subagent** and holds
only the invariants; derivations and worked examples live in a nested
`CLAUDE.md` the harness loads **the first time a session reads a file under
that directory** (`docs/agents/context-residency-audit.md` § Lever 4).
Frontmatter `globs:` do NOT gate loading; nesting does.

| Touching    | Resident index                                                                            | Full text, on demand |
| ----------- | ----------------------------------------------------------------------------------------- | -------------------- |
| `convex/**` | `.claude/rules/gre-development.md`                                                        | `convex/CLAUDE.md`   |
| `src/**`    | `.claude/rules/frontend-components.md` + `chrome-debug.md`                                | `src/CLAUDE.md`      |
| the Bot     | `.claude/rules/bot-development.md` (whole; its `globs:` feeds `scripts/lib/bot-globs.ts`) | `/bot-slice`         |

A norm belongs in the index only if acting without it is a mistake **before**
any file is opened; everything else goes in the nested file.

### Development cycle

1. **Discuss** — user describes the feature/rule
2. **Verify rules** — `/mtg-rules-check` for CR text + current status
3. **Plan** — agree scope: implement now vs defer
4. **Implement** — Effect Script by default (ADR 0045); consult the Mechanics
   Registry before writing; `resolve()` only for protocol-like cards with
   recorded justification
5. **Test** — **the LANE decides what is owed** (ADR 0136 §8,
   `check:lane --plan`): a `cards` diff owes no test, proof-of-failure or
   seam walk — a test there = an unexercised Op (`/new-op`). Else: `resolve()`
   cards and new Ops owe tests at ALL layers (GRE unit, game.ts integration,
   frontend utils, wire format; every feature crossing GRE → game.ts → UI
   needs one full-path integration test); DSL cards on exercised Ops owe none.
   **Frontend wiring is not optional** (`.claude/rules/gre-development.md`
   § Frontend wiring analysis — walk the reducers). **Every guarding test must
   be proven to fail** (break the subject, watch red, revert, say what you
   broke — § Proof-of-failure).

6. **Validate** — targeted runs + the review round; no pre-PR gate, the lane
   is paid once by `land` (ADR 0136 §1)
7. **Preset scenario** — for any new card/gameplay feature (ADR 0044, DB is
   the source of truth #770/#1455): a `json` fence
   `{ "label", "spec": { "cards" } }` under a `## Preset scenario` heading.
   **`land` refuses without one** on a `convex/{cards/sets,gre}/**` diff and
   seeds it post-merge; a refactor owes nothing — say so there. `owner` is
   `"me"`/`"opp"`, never anything else (it silently loads as `"me"`). Sweep:
   `bun run seed:backlog`.
8. **Bot reachability** — a new card/mechanic must be one the Bot can PLAY: no
   freeze, no silent ignore. Three seams per
   `.claude/rules/gre-development.md` § Bot reachability; declare the outcome
   in the PR like a preset scenario.
9. **UI verify** — `bun run check:ui` whenever the diff can reach the DOM,
   nothing owed when it cannot (`.claude/rules/chrome-debug.md`)

### Quality gates (mandatory, no exceptions)

Rationale, lane contents and measurements: `docs/agents/quality-gates.md`.

| When      | Run                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Iterating | targeted only — `bunx vitest run <path>`. Formatting is automatic.                                      |
| Pre-PR    | `bunx vitest run <paths touched>` + review — **no lane gate** (ADR 0136)                                |
| Merge     | `bun run land <PR#>` — rebase, **`check:lane`**, merge into the base branch, under the mutex (ADR 0136) |
| Release   | **`bun run release`** — full gate on the base tip, then fast-forward the release branch (ADR 0116)      |

- **`check:lane` is paid ONCE, by `land`, on the rebased tip** (ADR 0136;
  skipped when tip and base were already gated green). Lanes: `skin`
  (`src/**`) / `engine` (`convex/**`, `scripts/**`, `data/**`) / `cards` /
  `docs` (prose, `check:docs`) / `full`; prose beside code adds `node[docs]`;
  anything unplaceable (`src/**` + `convex/**`, `package.json`, a lockfile,
  `.claude/**`) is `check:pr` **verbatim**. **No lane scopes a project's
  tests to the diff** — a project runs whole or not at all (ADR 0104).
- **Never hand-pick a subset of `check:pr`.**
- **`check:all` VERIFIES formatting**, it does not repair it — on drift run
  `bun run format` and re-run (#1807).
- **`bun run test` is three suites** — `test:app` → `test:bot` → `test:blade`.
  **Name any new bot/AI test `*.bot.test.ts`**; `bot-suite-boundary.test.ts`
  enforces it. Wall-clock assertions go in `*.perf.test.ts` — `test:perf`,
  a fourth suite, never gated (issue #3123).
- **Cover `src/` changes with targeted runs** — the dom project is outside the
  light gate.
- **There is no CI: the local gates are the only gates.** The full offline
  gate runs **per batch** (`health:main`, detached by `land` at the 5th
  landing since GREEN or 2 h after the first un-healthed one, ADR 0136 §6)
  and at release (`bun run release`, ADR 0116; by hand: `bun run health`).

**CPU admission control** (`scripts/gate.ts`) — sessions share this machine:

| Tier      | Commands                                                           | Behaviour                                                      |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| **heavy** | `bun run test`, `test:app`, `test:bot`, `check:all`                | machine-wide mutex, `min(ncpu - 1, 4)` workers (RAM-capped)    |
| **light** | `bunx vitest run <path>`, `check:pr`, `check:ts`, `lint`, `format` | no lock, vitest capped at 2 workers (`TOLARIA_VITEST_WORKERS`) |

**Session admission** is the tier above (ADR 0136 §6-7): `queue:plan` refuses
a pick while live `in-progress` claims are at `sessions.cap` — 3, the measured
PR/h knee, configuration not a literal, `--no-cap` the announced escape — or
while a health `RED` marker stands. `land` only warns, so a session already
mid-issue finishes.

A queued heavy gate is not a hang: **`bun run gate:who`** names the holder;
one that stops burning CPU is reclaimed (issue #2999).
**The full gate is blocked inside an issue worktree**
(`feat/issue-N`/`fix/issue-N` → exit 1); `TOLARIA_ALLOW_FULL_SUITE=1` is the
escape hatch `land` alone uses.

**Worktree isolation — the shared checkout is read-only.** Every file you
author goes in a worktree, **including one line of markdown** (an unfinished
ADR there reds `check:all` for every other session). Enforced by
`deny-guard.sh` § 0; gitignored paths stay writable; hatch
`TOLARIA_ALLOW_MAIN_EDIT=1 claude`. Docs-only: `bun run wt:docs <slug>` →
write → `bun run docs:ship` (seconds, no lock). Anything else: its own
worktree (`docs/agents/quality-gates.md` § Worktree isolation).

**Branches are configuration** (ADR 0116): `tolaria.config.json` names the
**base** (PRs target it, `land` merges into it) and **release** (production)
branches; only `lib/branches.ts`, `deny-guard.sh`, `gate-run.sh` read it, and
an `origin/<name>` literal elsewhere reds `branches.test.ts`.

**Merging goes through `bun run land <PR#>`, from the PR's own branch**
(#2537 — any directory checked out on it; the base and release branches are
refused). `land` holds the gate mutex across rebase → `check:lane` → push →
merge, so the tree that lands is the tree that was gated; it refuses a PR
whose base is not the base branch. No health per landing — `land` only
appends the tip and detaches the batch decision. Worktrees:
`bun run wt:new <N>`. `deny-guard.sh` § 1 denies a hand-typed `gh pr merge`
(hatch: `TOLARIA_ALLOW_MANUAL_MERGE=1`); if only the MERGE failed, retry
`bun scripts/pr-merge.ts <PR#>` (a second `land` re-pays the gate), **then
re-run `land`** — on a MERGED PR it runs only the housekeeping (#4159). A
`skin`-lane PR owes a byte-exact `check:ui` receipt only if its diff can reach
the DOM — a test-only `src/**` diff is exempt (ADR 0110 §4).

**Fresh worktrees need `bun run worktree:init`** — `216 files failed, 0 tests
failed` is a missing bootstrap, not a red baseline.

**Green-at-release (ADR 0116): the release branch only moves to a
health-proven base tip.** `land` proves the lane, the batch health proves the
rest between releases, `release` re-proves it on the exact tip. Either leaves
a durable `RED` marker on failure (`bun run health:status`): fix-forward FIRST
(`bun run health:fix`) —
never stack work on a red tip, never silence a test, "not my test" is not an
exemption.

**`check:ui` is a gate outside `check:all`** (the full gate is offline; this
lane needs a deployment and a browser): the PR receipt is the whole
enforcement (`.claude/rules/chrome-debug.md`).

## Rules Implementation Process

Always cross-reference against the official CR. Before writing code, discuss
uncovered details (edge cases, interactions, timing) and decide implement-now
vs defer together.

**The CR is vendored, and it is the only source** (ADR 0098):
`data/cr/comprehensive-rules.txt`, sliced by `bun run cr 605.1a` /
`bun run cr grep "<keyword>"` — offline, exact, never a fetched mirror.

**Never cite a rule number you have not printed.** `bun run cr:lint`
(`check:guards`) reds on an id that resolves to nothing and on a
`CR 701.N`/`702.N` line naming a keyword other than its section title.

**Every `CR` line you add or edit owes a ledger entry** (ADR 0133): `cr:lint`
reds on one missing from `data/cr/citations-ledger.json` and names the fix —
read the rule it prints, then `bun run cr:ledger confirm <file>:<line>`, ONE
line per call, `<line>` = the id's line, a wrapped citation read whole (#2514).
A wrong id is fixed on its line, then confirmed. `cr:check` / `cr:sync` track
a newer document, outside `check:all` (offline by
contract). Derivation: `docs/agents/gre-guards.md` § CR citation linting.

## Implemented engine capabilities

Once deferred, since **shipped** — do not treat as out of scope:

- **Layer system** (`gre/layers.ts`, CR 611/613): P/T (7a–7e), color (5),
  type add (4), ability grant/removal (6), control (2), text-changing (3).
  Anthems and ability-stripping are `staticEffects[]` with `applies`.
- **Replacement effects** (`gre/replacements.ts`)
- **Complex/choice triggers**, simultaneous-trigger APNAP ordering (CR 603.3b)
- **Effect Script DSL** + Mechanics Registry (ADR 0045/0046) — the mandatory
  authoring default

A capability that genuinely isn't built: flag it explicitly — most are.

## Out of Scope

- **Ante & subgames** (ADR 0010)

## Agent skills

- **Guides**: `docs/guides/` answers "how do I RUN this?" — index at
  `docs/guides/README.md`. Read on demand, never resident.
- **Issue tracker**: GitHub Issues, `gh` CLI (`docs/agents/issue-tracker.md`).
  In agent output and generated artifacts **qualify every reference:
  `issue #NNN` / `PR #NNN`.**
- **Findings drawer**: `docs/findings/` = what a subagent noticed but was not
  asked to fix — draft, never an issue (the loop drains the queue, never
  fills it). `bun run findings`; format in `docs/findings/README.md`.
- **Triage labels**: five canonical roles + model-routing labels. See
  `docs/agents/triage-labels.md`.
- **Domain docs**: `CONTEXT.md` + `docs/adr/`. ADRs are not auto-loaded —
  `docs/adr/README.md` is the queryable index; **every new ADR MUST add its
  index row** in the same change.

This project uses Convex: **always read `convex/_generated/ai/guidelines.md`
first** — it overrides training-data knowledge. Skills:
`npx convex ai-files install`.
