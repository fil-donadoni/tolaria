<!-- GENERATED FILE — DO NOT EDIT.
     Source: src/CLAUDE.md
     Regenerate: bun run agents:build
     Guarded by: scripts/__tests__/agents-md-drift.test.ts
     Edit the source, never this file. -->

# Frontend & browser-verification rules

Loaded **on demand** — this file enters context the first time a session reads
a file under `src/`, and costs nothing to a session that never does. The
resident indexes are `.claude/rules/frontend-components.md` and
`.claude/rules/chrome-debug.md`; this is the full text they point at.

## Component structure

- ONE component per file — no exceptions
- Extract visual state computation into named functions or dedicated files
- Use `useGameContext()` for shared game state — never prop-drill GameState
- All UI text MUST be in English

## Type safety

- Import types from `convex/` (source of truth) — never define local game types
- Import constants/helpers from `convex/gre/constants.ts` — no local copies
- Frontend MAY import pure engine modules from `convex/gre/` and `convex/limited/` (client Brain, Draft Lab) — no **authority**: no client-side engine run yields persisted or trusted state; every real move goes through a public `convex/game.ts` mutation, re-validated server-side (ADR 0074)

## After changes

- Targeted `bunx vitest run <paths touched>` (`dom` is outside the light gate); no pre-PR `check:all` — `land`'s `check:lane` pays lint + type-check (ADR 0136)
- **`bun run check:ui`** when a walk is OWED (§ below)

## Browser verification

**A change that can alter what a user SEES is not done until a real browser
has shown it.** happy-dom has no layout engine (no viewport, paint or stacking;
`getBoundingClientRect()` is zeroes), so "the card is in the document" passes
with the card in a 24px-tall container.

**OWED predicate** (issue #5459, `uiWalkOwed`, `scripts/lib/ui-scope.ts`;
`bun run check:ui -- --scope-only` prints `walk: owed — <path>: <rule>` /
`walk: not owed — <reason>`). Owed iff the diff touches a stylesheet,
`index.html`, public asset or design tokens; the shell / `components/chrome/`;
a `*layout*` component; `components/ui/`; a dialog/modal/popover/overlay/
portal/sheet/drawer/tooltip/dropdown/menu/toast component; a viewport/
responsive module; or a file declaring a `z-index`, scroll container or
`@media`/`matchMedia`/`useViewport*`. Leaf
components, copy, handlers, tests: not. Not owed → PR line
`check:ui: no walk owed (<reason>)` replaces the receipt; owed + no receipt →
`land` refuses. `--all`: the full proof, by hand only (#6143).

**Run `bun run check:ui` first** (#2580). It owns its own Vite + headless
Chrome, signs in, walks the runbook surfaces at all five viewports, probes and
runs axe, and fails on any broken Floor (`scripts/ui-gate/floors.ts`, ADR
0132). Its output IS the receipt — paste it. A surface it could not reach prints `UNWALKED` and reds
the run; that is a coverage failure, not a pass. Drive CDP by hand only for
what the lane does not cover, or to diagnose what it flagged.

**Paste it byte-exact** (#2760): `bun run land` re-derives the verdict block
and refuses a mismatch or a non-`PASS` line; the diagnostic block is never read
(`bun run verify:ui-receipt <PR#>` by hand). `RECEIPT` or `SCOPED`, never
`DIAGNOSTIC`; never reflow a line.

**Five viewports per surface touched** (ADR 0101), via `emulate`: desktop
`1440x900x2`, phone `390x844x3,mobile,touch` and
`844x390x3,mobile,touch,landscape`, tablet `820x1180x2,mobile,touch` and
`1180x820x2,mobile,touch,landscape`.

**Measure, never eyeball.** A screenshot of a clipped row reads as "the cards
are there" — that is how the bug above shipped. Run the probe
(`scripts/ui-gate/probe.js`, the same file the lane injects) and report
`zero / occ / stranded / starved / small` per viewport plus
`list_console_messages {types:["error"]}`. A UI PR with no receipt and no
"cannot reach the DOM" note is not done.

**Tooling:** the `chrome-devtools-mcp` plugin (CDP). The Claude-in-Chrome
extension cannot work in Arc — no `chrome.sidePanel`, so its per-site approval
is ungrantable and every call times out. Prefer `take_snapshot` (a11y tree +
uids) over screenshots for navigation; screenshots are evidence, not
diagnosis.

**Gameplay checks use solo mode** — one user, both seats, viewer auto-switches
to whoever holds priority. Never a second tab for the opponent.

Procedure and the probe: `docs/guides/browser-verification.md`. Click
sequences (solo game from cold, the active-game blocker, Limited deck builder,
debug scenarios, storage keys): `docs/guides/ui-runbooks.md`.
