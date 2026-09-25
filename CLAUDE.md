# CLAUDE.md

Terse by design: each norm carries a `#NNN` / ADR ref holding its history —
read it before relitigating a rule.

## Project Overview

Tolaria: MTG (Magic: The Gathering) gameplay engine for study and
experimentation — rules correctness, real-time reactivity between two clients.
Not commercial: extensible engine, working subset of cards.

Stack, toolchain, commands, file map are not resident (nothing needed before
opening a file, `docs/agents/context-residency-audit.md`): `docs/PROJECT.md`
§ 2 Stack & toolchain / Comandi essenziali, § 7.3 Struttura del frontend,
§ 13 Mappa rapida dei file.

## Architecture

```
Client React (P1) ──┐
                    ├── Convex (game state) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

Gameplay domain separate from surrounding features (matchmaking, profiles,
collections).

### Game Rules Engine (GRE)

Runs **server-side** in Convex mutations; the client never validates rules, it
only views state. **Authoritative** (every move validated server-side before
applying), **deterministic** (seeded PRNG `rngSeed`/`rngCounter`, no event
log), **isolated** (rules independent of transport).

### Authentication

`@convex-dev/auth` Password provider (email + password + nickname). Every
query/mutation on user-owned data uses `getCurrentUser(ctx)` /
`getCurrentUserId(ctx)` (`convex/auth.ts`). `<AuthGate>` at router root: every
route requires login. Email verification off in development.

### Player identity in games

`players[].id`: opaque string handle, the GRE's `controllerId`/`ownerId`;
2-player = `Id<"users">`, solo = `${userId}-p1` / `${userId}-p2`. Schema keeps
`v.string()` — do NOT type it `Id<"users">`. Game mutations derive id and
nickname from `ctx.auth`; clients cannot spoof identity.

### Data model

- `gameStates` — **one row per game, patched in place** by `saveGameState`
  (sole writer): compacted snapshot + monotonic `seq`. No undo history.
- `gameTicks` — ~150-byte wake-up companion row written with every
  `gameStates` save, so subscribers need not hold the fat row.
- **No event log.** `game_events` was designed, never built; the snapshot is
  the source of truth (`docs/PROJECT.md` § Data model).

User decks: `userDecks` (by `userId`); presets: `convex/deckPresets.ts`
(`api.decks.list`). State saved **only at stable points** (awaiting human
input).

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
BEGINNING (untap/upkeep/draw) → PRECOMBAT_MAIN → COMBAT (5 substeps) →
POSTCOMBAT_MAIN → ENDING. Untap, cleanup automatic (no priority).

## Key boundary — authority, not imports

**ADR 0074**: the frontend MAY import pure engine modules from `convex/gre/`,
`convex/limited/` (client Brain, Draft Lab); it never has **authority** — no
client-side engine run yields persisted or trusted state; every real move goes
through a public `convex/game.ts` mutation, re-validated server-side.

## Card Definition System

Cards are **data**, not imperative code. Three levels:

1. **Pure data** — vanilla creatures, basic lands
2. **Declarative** — triggered/activated/static abilities as templates;
   one-shot effects as an **Effect Script** (`effects: EffectOp[]`, ADR 0045),
   the mandatory DSL-first default
3. **Imperative `resolve()`** — protocol-like cards only (Word of Command,
   Camouflage), never the default

**Effect Script DSL** (ADR 0045/0046): ordered `EffectOp[]` (`dealDamage`,
`draw`, `destroy`, `choice`, …) + four frozen constructs (`bind`, `ref`, `if`,
`forEach`), run by `convex/gre/effects/interpreter.ts`. **Mechanics Registry**
(`convex/cards/mechanicsRegistry.ts`) = sole authority on keyword and Op names
(CI-enforced); uncensused mechanic → stop and open an issue, never invent a
name. Per-Op testing, `resolve()` justification: `gre-development.md`
§ DSL-first authoring.

Key types: `convex/cards/types.ts` (`CardDefinition`, `ActivatedAbility`,
`ManaCost`, `SpellContext`, `TargetRequirement`, `EffectOp`). SBAs are global
rules in `sba.ts`; cards declare only `sbaMods` exceptions.

## Code Organization

- **One component per file**; no inline/helper components beside the parent.
- **Extract, don't inline**: growing logic → named functions/files.
- **Types centralized**: `convex/` is the source of truth (`cards/types.ts`,
  `gre/types.ts`, `gre/state.ts`); `src/types/` re-exports; no local types in
  components.
- **Constants/helpers shared**: `LAND_SUBTYPE_MANA`, `PERMANENT_TYPES`,
  `isCreature`, `isLand`, … in `convex/gre/constants.ts` — no local copies.

## Collaboration Mode

**Autonomous**: Claude implements, tests, validates end-to-end; user sets
features and strategy. Ask only on significant architecture choices or genuine
CR ambiguity affecting behavior.

### Subagent model routing (cost)

**Enforced by `.claude/hooks/spawn-guard.sh`**:

- Every `Agent` spawn MUST pass an explicit `model` (except `fork`):
  **`model: sonnet` for read-only/mechanical work** (locate, map, survey,
  research); session tier only for genuinely hard work.
- Every `description` MUST be role-prefixed: `implement` / `review` / `fixup` /
  `investigate` / `research` / `verify` / `migrate` / `audit`.
- Cavecrew: `caveman:cavecrew-investigator` / `-builder` / `-reviewer`, always
  `model: sonnet`.

### Shell commands

**A multi-token command is a shell ARRAY, never a quoted string**:
`"$CMD"` with `CMD="tool --a 1"` runs a file named `tool --a 1`; use
`CMD=(tool --a 1)` + `"${CMD[@]}"`, wrappers (`/usr/bin/time`, `env`, `xargs`)
included.

## Automated Development Workflow

### Skills

Intake converges on grill → `/to-prd` → `/to-tickets` → issues labelled
`ready-for-agent`; **`/next-issue` drains that queue one issue per session**
(ADR 0110, single-session pipeline). Pick by where work comes FROM:

- `/next-issue` (drain queue): ONE issue, pick → worktree → implement →
  review → land
- `/new-card` (one card): compile state decides artefacts (`ready`) /
  mechanic / rule / hand tail
- `/new-set` (set rollout): compile-first scope, ranked Grammar Gap tickets,
  residue, umbrella PRD
- `/new-qa-issue` (observed bug/enhancement): explore, draft one
  agent-readable issue, post after confirmation
- `/audit-tracker <N>` (stale roll-up): re-verify gaps vs HEAD, slice
  survivors, retire tracker
- `/mtg-rules-check` (before any mechanic): CR text + implementation status
- `/gre-test` (GRE logic): vitest tests per project patterns
- `/new-op` (missing DSL verb): all eight Op sites (+ emitting Grammar Rule) +
  permanent test
- `/grammar-rule` (one Grammar Cluster): rules + golden fixture per form →
  recompile → `ready` delta → graduation
- `/bot-slice` (any play/draft Bot change): maps AI subsystem, walks seams,
  enforces verification doctrine

**Workflow skills are versioned here** (`.claude/skills/…`): branch + PR +
gate (`project-skills.test.ts` guards drift to the user-level dir). A rule that
CAN be enforced mechanically belongs in a gated script; prose is for judgment,
not invariants.

### Path-specific rules — index resident, full text on demand

`.claude/rules/*.md`: **resident in every session and subagent**, invariants
only. Derivations/examples: a nested `CLAUDE.md`, loaded **the first time a
session reads a file under its directory** — a rule nobody can afford to load
is one nobody follows (`docs/agents/context-residency-audit.md` § Lever 4).
Frontmatter `globs:` do NOT gate loading; nesting does.

- `convex/**`: `gre-development.md` → `convex/CLAUDE.md`
- `src/**`: `frontend-components.md` + `chrome-debug.md` → `src/CLAUDE.md`
- Bot: `bot-development.md` (whole; its `globs:` feed
  `scripts/lib/bot-globs.ts`) → `/bot-slice`

Resident only if acting without it is a mistake **before** opening any file.

### Development cycle

1. **Discuss** — user describes the feature/rule
2. **Verify rules** — `/mtg-rules-check`: CR text + current status
3. **Plan** — scope: implement now vs defer
4. **Implement** — DSL-first (§ Card Definition System)
5. **Test** — **the LANE decides what is owed** (ADR 0136 §8,
   `check:lane --plan`): `cards` diff owes no test, proof-of-failure or seam
   walk (a test there = unexercised Op → `/new-op`). Else `resolve()` cards and
   new Ops owe ALL layers (GRE unit, game.ts integration, frontend utils, wire
   format) + one full-path GRE → game.ts → UI test; DSL cards on exercised Ops
   owe none. **Frontend wiring not optional**; **every guarding test proven to
   fail** (`gre-development.md` § Frontend wiring analysis, § Proof-of-failure).
6. **Validate** — targeted runs + review; no pre-PR gate, `land` pays the lane
   once (ADR 0136 §1)
7. **Preset scenario** — any new card/gameplay feature (ADR 0044; DB is source
   of truth, #770/#1455): `json` fence `{ "label", "spec": { "cards" } }` under
   a `## Preset scenario` heading. **`land` refuses without one** on a
   `convex/{cards/sets,gre}/**` diff, seeds it post-merge; a refactor owes
   nothing (say so there). `owner` only `"me"`/`"opp"` (else silently `"me"`).
   Sweep: `bun run seed:backlog`.
8. **Bot reachability** — Bot must PLAY it (`gre-development.md` § Bot
   reachability)
9. **UI verify** — `bun run check:ui` iff the diff can reach the DOM
   (`.claude/rules/chrome-debug.md`)

### Quality gates (mandatory, no exceptions)

Rationale, lanes, measurements: `docs/agents/quality-gates.md`.

- **Iterating**: targeted only, `bunx vitest run <path>`; formatting automatic.
- **Pre-PR**: `bunx vitest run <paths touched>` + review — **no lane gate** (ADR 0136).
- **Merge**: `bun run land <PR#>` — rebase, **`check:lane`**, merge into base,
  under the mutex (ADR 0136).
- **Release**: **`bun run release`** — full gate on base tip, then fast-forward
  release branch (ADR 0116).
- **`check:lane` paid ONCE, by `land`, on the rebased tip** (ADR 0136; skipped
  if tip and base already gated green). Lanes: `skin` (`src/**`) / `engine`
  (`convex/**`, `scripts/**`, `data/**`) / `cards` / `docs` (prose,
  `check:docs`, incl. `.claude/skills/**/*.md`, `.claude/rules/*.md`) /
  `full`; prose beside code adds `node[docs]`; unplaceable (`src/**` +
  `convex/**`, `package.json`, lockfile, rest of `.claude/**`: hooks,
  settings, skill scripts) = `check:pr` **verbatim**. **No lane scopes a
  project's tests to the diff**: whole or not at all (ADR 0104).
- **Never hand-pick a subset of `check:pr`.**
- **`check:all` VERIFIES formatting**, never repairs: drift → `bun run format`,
  re-run (#1807).
- **`bun run test` = `test:app` → `test:bot` → `test:blade`.** **New bot/AI
  test → `*.bot.test.ts`** (`bot-suite-boundary.test.ts`). Wall-clock
  asserts → `*.perf.test.ts` (`test:perf`, 4th suite, never gated, #3123).
- **Cover `src/` changes with targeted runs** (dom project outside light gate).
- **No CI: local gates are the only gates.** Full offline gate **per batch**
  (`health:main`, detached by `land` at 5th landing since GREEN or 2 h after
  first un-healthed, ADR 0136 §6) and at release (by hand `bun run health`).
- **CPU admission** (`scripts/gate.ts`, shared machine): **heavy** =
  `bun run test`, `test:app`, `test:bot`, `check:all` → machine-wide mutex,
  `min(ncpu - 1, 4)` workers (RAM-capped); **light** = `bunx vitest run`,
  `check:pr`, `check:ts`, `lint`, `format` → no lock, vitest ≤2 workers
  (`TOLARIA_VITEST_WORKERS`). Queued heavy gate ≠ hang: **`bun run gate:who`**
  names holder; one no longer burning CPU is reclaimed (#2999). **Full gate
  blocked in issue worktrees** (`feat/issue-N`/`fix/issue-N` → exit 1);
  `TOLARIA_ALLOW_FULL_SUITE=1` is `land`'s own hatch.
- **Session admission** (ADR 0136 §6-7): `queue:plan` refuses a pick while
  live `in-progress` claims hit `sessions.cap` (3 = measured PR/h knee; config,
  not literal; `--no-cap` = announced escape) or a health `RED` marker stands.
  **Claim = `bun run queue:claim N`, one locked act** re-reading the cap
  (#4375; hand-typed label denied). `land` only warns: mid-issue sessions
  finish.

**Worktree isolation — shared checkout is read-only.** Every authored file →
worktree, **even one markdown line** (unfinished ADR there reds `check:all` for
all sessions). `deny-guard.sh` § 0; gitignored paths writable; hatch
`TOLARIA_ALLOW_MAIN_EDIT=1 claude`. Docs-only: `bun run wt:docs <slug>` →
write → `bun run docs:ship` (seconds, no lock); else `bun run wt:new <N>`
(`quality-gates.md` § Worktree isolation). **Fresh worktree needs
`bun run worktree:init`** — `216 files failed, 0 tests failed` = missing
bootstrap, not red baseline.

**Branches are configuration** (ADR 0116): `tolaria.config.json` names
**base** (PRs target it, `land` merges into it) and **release** (production);
only `lib/branches.ts`, `deny-guard.sh`, `gate-run.sh` read it; an
`origin/<name>` literal elsewhere reds `branches.test.ts`.

**Merging goes through `bun run land <PR#>`, from the PR's own branch** (#2537;
any directory on it; base/release refused). `land` holds the gate mutex across
rebase → `check:lane` → push → merge (tree landed = tree gated), refuses a PR
not based on base; no health per landing (appends tip, detaches batch
decision). `deny-guard.sh` § 1 denies hand-typed `gh pr merge` (hatch
`TOLARIA_ALLOW_MANUAL_MERGE=1`); if only the MERGE failed, retry
`bun scripts/pr-merge.ts <PR#>` (second `land` re-pays the gate), **then
re-run `land`** — on a MERGED PR it only does housekeeping (#4159).

**Green-at-release (ADR 0116): release branch moves only to a health-proven
base tip.** `land` proves the lane, batch health the rest, `release` re-proves
the exact tip. Failure leaves durable `RED` marker (`bun run health:status`):
fix-forward FIRST (`bun run health:fix`); never stack work on a red tip, never
silence a test; "not my test" is no exemption.

## Rules Implementation Process

Always cross-reference the CR. Before coding, discuss uncovered details
(edge cases, interactions, timing); decide implement-now vs defer together.

**The CR is vendored, the only source** (ADR 0098):
`data/cr/comprehensive-rules.txt` via `bun run cr 605.1a` /
`bun run cr grep "<keyword>"` — offline, exact, never a fetched mirror.

**Never cite a rule number you have not printed.** `bun run cr:lint`
(`check:guards`) reds on an id resolving to nothing and on a
`CR 701.N`/`702.N` line naming a keyword other than its section title.

**Every `CR` line you add or edit owes a ledger entry** (ADR 0133): `cr:lint`
reds on one missing from `data/cr/citations-ledger.json`, naming the fix — read
the printed rule, `bun run cr:ledger confirm <file>:<line>`, ONE line per call,
`<line>` = the id's line, wrapped citation read whole (#2514). Wrong id: fix
its line, then confirm. `cr:check` / `cr:sync` track a newer document, outside
`check:all` (offline by contract). Derivation: `docs/agents/gre-guards.md`
§ CR citation linting.

## Implemented engine capabilities

Once deferred, now **shipped** — not out of scope. Unbuilt? Flag explicitly
(rare).

- **Layer system** (`gre/layers.ts`, CR 611/613): P/T (7a–7e), color (5),
  type add (4), ability grant/removal (6), control (2), text-changing (3).
  Continuous statics (anthems, ability-stripping) are data:
  `staticEffects[]` with `applies`.
- **Replacement effects** (`gre/replacements.ts`)
- **Complex/choice triggers**, simultaneous-trigger APNAP ordering (CR 603.3b)
- **Effect Script DSL** + Mechanics Registry (ADR 0045/0046) — mandatory
  authoring default

## Out of Scope

- **Ante & subgames** (ADR 0010)

## Agent skills

- **Guides**: `docs/guides/` = "how do I RUN this?" (index
  `docs/guides/README.md`), on demand.
- **Issue tracker**: GitHub Issues via `gh` (`docs/agents/issue-tracker.md`).
  In agent output and artifacts **qualify every ref: `issue #NNN` /
  `PR #NNN`.**
- **Findings drawer**: `docs/findings/` = what a subagent noticed but was not
  asked to fix; draft, never an issue (the loop drains the queue, never fills
  it). `bun run findings`; format `docs/findings/README.md`.
- **Triage labels**: five canonical roles + model-routing labels
  (`docs/agents/triage-labels.md`).
- **Every issue you file is stamped**: `area:*` + a type always, `## Band`
  only with no prioritised parent (`triage-labels.md` § Every new issue).
- **Domain docs**: `CONTEXT.md` + `docs/adr/`. ADRs not auto-loaded:
  `docs/adr/README.md` is the index; **every new ADR MUST add its index row** in
  the same change.

Convex: **always read `convex/_generated/ai/guidelines.md` first** (overrides
training data). Skills: `npx convex ai-files install`.
