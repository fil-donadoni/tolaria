---
title: A faster linter would not pay yet — eslint --cache buys the same wall time with no rule gap, oxlint needs 19 divergent findings settled first
discoveredBy: 3647
status: draft
confidence: medium
---

**What was asked.** Issue #3647 (PRD #3643): would a faster linter pay? Run the
current eslint configuration and a candidate over the whole tree on this machine,
three runs each with the load beside every figure, and diff the findings. No
adoption; nothing in `package.json` changes.

**Candidate.** oxlint 1.83.0 (`bunx oxlint@1.83.0`, nothing installed). It could
express the ruleset, so biome was not run as a linter — its migration output is
recorded in the rule-gap section for comparison only.

## Method

- **Baseline:** `bunx eslint .` — eslint 9.39.4, typescript-eslint 8.59.4,
  eslint-plugin-react-hooks 7.1.1, eslint-plugin-react-refresh 0.5.2, the
  checked-in `eslint.config.js`. This is exactly `bun run lint`, the step
  `check:all:inner` runs over the whole tree. `check:lane` already scopes eslint
  to the diff's paths, so the full-tree figure matters only for `check:all`,
  `check:pr` (the `full` lane) and `release`.
- **Effective ruleset:** `eslint --print-config` on one `.ts` and one `.tsx`
  file — 84 enabled rules, identical for both extensions. No rule is type-aware.
- **Candidate config:** each of the 84 rules mapped 1:1 onto oxlint's
  `--rules -f json` catalogue with the same severity and options, all oxlint
  categories off, so nothing runs that eslint does not run. 81 map; the 3 that
  do not are the rule gap below. `@oxlint/migrate` produced 93 rules (it adds
  the `eslint:recommended` rules that typescript-eslint switches off for TS) and
  cannot express the `ignores` list of the ADR 0046 override, so the config was
  written by hand instead: that override became an explicit `off` override.
- **Ignores:** the `globalIgnores` list, rewritten as oxlint globs. A bare
  `.opencode` pattern does not match in oxlint (the first run reported 6
  `no-explicit-any` hits inside `.opencode/plugins/`); `.opencode/**` does.
- **Parity probe:** a scratch tree seeded with one violation each of the rules
  this repo leans on — a set-module import outside a test (ADR 0046), the same
  import inside `__tests__/` (must stay silent), `rules-of-hooks` twice,
  `set-state-in-effect`, `only-export-components`, `prefer-const`. Both linters
  reported the same 6 findings at the same lines and stayed silent on the test
  file.
- **Timing:** eslint and oxlint runs interleaved (e, o, e, o, e, o) so load
  drift hits both; then three single-file runs each. Wall is the process wall
  clock around `bunx`, so it includes bun's startup. Load is the 1/5/15-minute
  load average at the start of each run. 8 CPUs.

## Timing

| Run                                 |           Wall (s) | Exit | Load at start (1 / 5 / 15 min) |
| ----------------------------------- | -----------------: | ---: | ------------------------------ |
| eslint, whole tree #1               |              42.65 |    0 | 6.46 / 12.54 / 11.77           |
| oxlint, whole tree #1               |               0.31 |    1 | 4.84 / 11.33 / 11.36           |
| eslint, whole tree #2               |              43.33 |    0 | 4.84 / 11.33 / 11.36           |
| oxlint, whole tree #2               |               0.63 |    1 | 4.10 / 10.23 / 10.95           |
| eslint, whole tree #3               |              42.48 |    0 | 4.10 / 10.23 / 10.95           |
| oxlint, whole tree #3               |               0.34 |    1 | 3.61 / 9.22 / 10.54            |
| eslint, one file #1 / #2 / #3       | 0.80 / 0.54 / 0.54 |    0 | 3.61 / 9.22 / 10.54            |
| oxlint, one file #1 / #2 / #3       | 0.07 / 0.07 / 0.07 |    0 | 3.61 / 9.22 / 10.54            |
| eslint `--cache`, cold              |              45.58 |    0 | 2.47 / 8.31 / 10.15            |
| eslint `--cache`, warm #1 / #2 / #3 | 1.74 / 1.42 / 1.44 |    0 | 3.29 / 7.72 / 9.84             |

- **Medians, whole tree:** eslint 42.65 s, oxlint 0.34 s — about 125x. eslint
  linted 4341 files, oxlint 4339. An earlier eslint warm-up run at load 23.12
  took 43.68 s wall, 72.34 s user: eslint is mostly single-threaded here and
  barely load-sensitive at this range; oxlint used all 8 threads.
- **oxlint exits 1** on every whole-tree run because of the 19 findings below;
  the times include reporting them.
- **The one-file row** is what `check:lane` pays per lintable path today:
  0.54 s against 0.07 s.
- **eslint `--cache`** (cache file in the session scratchpad) costs 3 s more
  cold and 1.4 s warm. Every enabled rule is single-file and none is type-aware,
  so a content-keyed cache cannot go stale on a change in another file.

## Rule gap

Rules the candidate cannot run, and what each guards in this repo.

| eslint rule                        | oxlint 1.83.0                       | What it guards here                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-octal`                         | not in catalogue                    | Legacy octal literals (`017`). Every linted file is an ES module, i.e. strict-mode code, where such a literal is a syntax error — `@oxlint/migrate` lists it as "superseded by strict mode". Nothing lost.                                                                             |
| `react-hooks/config`               | not in catalogue                    | Validates the React Compiler options handed to the lint plugin. `eslint.config.js` passes none (`reactHooks.configs.flat.recommended`), and `vite.config.ts` runs `reactCompilerPreset()` with defaults, so there is nothing to validate. oxlint runs the compiler with fixed options. |
| `react-hooks/gating`               | not in catalogue                    | Validates the compiler's gating (feature-flag) options. No gating is configured anywhere. Nothing lost today; lost the day gating is adopted.                                                                                                                                          |
| `no-restricted-imports` (ADR 0046) | runs, needs a hand-written override | The registry seam. Expressible and proven by the probe, but `@oxlint/migrate` drops the override's `ignores` list with a warning — a config regenerated by the tool would fire on every test fixture that imports a set module.                                                        |

Every other rule — including all 14 remaining `react-hooks` rules
(`immutability`, `refs`, `purity`, `set-state-in-effect`, …),
`react-refresh/only-export-components` and the 20 typescript-eslint rules — has a
native oxlint implementation. Those are **ports**, not the same code: the finding
diff shows where they disagree.

For comparison, biome 2.5.13's `migrate eslint` reported 85 rules migrated and
21 not implemented, 14 of them React Compiler rules (`immutability`, `refs`,
`purity`, `set-state-in-effect`, `static-components`, `use-memo`, …), and emitted
`noRestrictedImports` with no options — the ADR 0046 patterns gone. Biome would
lose most of the React Compiler coverage `src/` relies on, which is why oxlint
was the candidate.

## Finding diff

eslint reported **0** findings over the whole tree; the 33 `eslint-disable`
suppressions it applied (16 `no-explicit-any`, 11 `exhaustive-deps`,
5 `only-export-components`, 1 `no-control-regex`) were all honoured by oxlint —
none of those lines appears below. oxlint reported **19** findings, in 12 files.
None is eslint-only.

| File                                                                            | Line(s)            | oxlint rule                        | Cause                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/__tests__/limitedPairingMatch.test.ts`                                  | 555                | `no-unsafe-optional-chaining`      | `(x?.y as T).z`. eslint's core rule does not look through a TS `as` / `!` wrapper, oxlint does — verified with a probe: `(a?.b as T).c` and `(a?.b)!.c` fire only in oxlint, a bare `(a?.b).c` fires in both. A real throw if `x` is undefined. |
| `convex/gre/__tests__/modalDoubleFaced.test.ts`                                 | 121, 154           | `no-unsafe-optional-chaining`      | same                                                                                                                                                                                                                                            |
| `convex/gre/__tests__/scenarioBuilder.test.ts`                                  | 1105, 1107, 3572   | `no-unsafe-optional-chaining`      | same                                                                                                                                                                                                                                            |
| `convex/gre/__tests__/serialize.test.ts`                                        | 152                | `no-unsafe-optional-chaining`      | same                                                                                                                                                                                                                                            |
| `src/components/board/__tests__/put-back-picker.test.tsx`                       | 132                | `no-unsafe-optional-chaining`      | same                                                                                                                                                                                                                                            |
| `src/components/debug/__tests__/scenario-spec-fields.test.tsx`                  | 171, 207, 229, 260 | `no-unsafe-optional-chaining`      | same                                                                                                                                                                                                                                            |
| `src/hooks/__tests__/useBattlefieldInteraction.abilityViewBuilds.test.tsx`      | 154                | `react/immutability`               | A test `Harness` component writes the hook result to an outer `handle.current` during render. The two React Compiler ports disagree; root cause not isolated.                                                                                   |
| `src/hooks/__tests__/useBattlefieldInteraction.grantedManaAbility.test.tsx`     | 216                | `react/immutability`               | same pattern                                                                                                                                                                                                                                    |
| `src/hooks/__tests__/useBattlefieldInteraction.manaTapOther.test.tsx`           | 201                | `react/immutability`               | same pattern                                                                                                                                                                                                                                    |
| `src/hooks/__tests__/useBattlefieldInteraction.nonTapManaChoice.test.tsx`       | 175, 176           | `react/refs`, `react/immutability` | same pattern, plus `ref.current = …` during render                                                                                                                                                                                              |
| `src/components/board/__tests__/board-battlefield-mana-tap-other-pick.test.tsx` | 188                | `react/immutability`               | same pattern, inside a custom hook wrapper                                                                                                                                                                                                      |
| `dashboard/lib/tail.ts`                                                         | 60                 | `react/set-state-in-effect`        | `setState(EMPTY)` synchronously at the top of a `useEffect`. The one production-code divergence; eslint's port does not report it. Root cause not isolated.                                                                                     |

18 of 19 are in test files. The 12 optional-chaining findings are true positives
with a known, mechanical cause. The 7 React Compiler findings are the part that
matters for adoption: two implementations of the same rule, same options, same
file, different verdicts — so "oxlint is green" would not mean "eslint would be
green", in either direction.

## Recommendation

**Do not adopt oxlint now. If the full-tree lint is worth shortening, take
`eslint --cache` first.**

1. **The cost is narrower than 43 s suggests.** The per-PR path (`check:lane`)
   lints only the diff's files, at about 0.5 s a file. The full 43 s is paid by
   `check:all` / `check:pr` (the `full` lane, which `land` also runs for a mixed
   diff) and by `release`. This trial did not measure lint's share of
   `check:all`.
2. **`eslint --cache` recovers 41 of the 43 s on a warm tree** with zero rule
   gap, zero finding diff and no new dependency — the same move issue #3646 made
   for prettier. It is sound here because no enabled rule is type-aware or
   cross-file. Its open question is where the cache file lives: a per-worktree
   cache is always cold in an ephemeral worktree, so the win lands only in a
   checkout that persists (the primary one, `release`) unless the cache is
   shared.
3. **oxlint is ~125x faster and covers 81 of 84 rules, losing nothing this repo
   uses** — but adopting it means settling 19 findings eslint does not see,
   carrying a hand-maintained config the migration tool cannot regenerate, and
   accepting a second React Compiler port that already disagrees with the
   reference one in 7 places. Running both (oxlint as a fast pre-pass, eslint
   still the gate) doubles the React Compiler verdicts instead of replacing one.

**Why this may not deserve a ticket.** The 12 optional-chaining findings are
real but all in test code, where an undefined value fails the test anyway — a
cleanup pass, not a bug. Adopting `eslint --cache` is a one-flag change whose
value depends on how often a warm full-tree lint actually runs, which the
telemetry DB can answer before anyone files work.
