---
title: "the node vitest project (bunx vitest run --project node, check-lane.ts's own command) genuinely runs under Node — bun:sqlite and the Bun global are BOTH unavailable there"
discoveredBy: 2623
status: draft
confidence: high
---

**What is wrong.** `scripts/check-lane.ts` runs the `node` vitest project via
a literal `bunx vitest run --project node` (and `--project node --project
dom` for the `full` lane) — this is `check-lane.ts`'s own command list, not a
personal shorthand. `bunx` resolves the `vitest` binary through its
`#!/usr/bin/env node` shebang and the whole worker tree executes under plain
Node, not Bun. Two consequences, confirmed by hand while building #2623's test
file:

- `import { Database } from "bun:sqlite"` at module top level makes importing
  that module fail outright — `Cannot find package 'bun:sqlite'` — even
  though the module never actually calls `new Database(...)` (e.g. because
  the store file is absent). The bare `import` statement is enough; ESM
  resolves it unconditionally at load time before any guard can run.
- The `Bun` global itself is undefined (`ReferenceError: Bun is not defined`)
  the moment any code path reachable at import time (or exercised by a test)
  calls `Bun.serve` / `Bun.file` / any other `Bun.*` API.

CLAUDE.md's Quality gates table documents the iterating command as `bunx
vitest run <path>` — same footgun, same root cause, for anyone iterating on a
single file rather than the whole lane.

**Evidence.**

- `scripts/check-lane.ts:258,260,302` — `"bunx vitest run --project node
src/ scripts/"`, `"bunx vitest run --project dom"`,
  `"bunx vitest run --project node"`.
- `scripts/telemetry-serve.ts:18` (pre-#2623) —
  `import { Database } from "bun:sqlite";` at top level.
- `bunx vitest run scripts/__tests__/telemetry-serve.test.ts` →
  `Cannot find package 'bun:sqlite'` (reproduced before the fix below).
- After moving the `Database` construction behind a `createRequire(...)
("bun:sqlite")` call, gated so it only ever runs when
  `existsSync(DB_PATH)` is true (never true in a fresh worktree/test env):
  the SAME `bunx vitest run --project node` invocation still threw
  `ReferenceError: Bun is not defined` from an in-repo `startServer()` test
  that called `Bun.serve` directly — a second, independent hit of the same
  root cause, this time with no `bun:` module involved at all.
- `bun --bun vitest run <path>` / `bunx --bun vitest run <path>` both
  succeed on the same file — `--bun` is the fix, but neither
  `check-lane.ts`'s commands nor CLAUDE.md's documented iterating command
  passes it.
- `bun run check:lane` (the actual pre-PR gate) reproduced the exact same
  `node[all]` failure end-to-end on this branch before the fix, confirming
  this is not an artifact of running `bunx` by hand.

**Why it may not deserve its own issue.** Before this PR, nothing in the repo
had a test importing a `bun:sqlite`-touching module or calling a `Bun.*` API
(`grep -rl "bun:sqlite" scripts/ convex/ --include='*.test.ts'` and an
equivalent grep for `Bun\.` in test files were both empty), so the gap was
latent — every prior `bunx vitest run <path>` iteration happened to target
files that only need Node builtins and Web-standard globals (`Request`,
`Response`, `URL`, `fetch`). #2623 worked around it entirely on the
`telemetry-serve.ts` side (lazy `bun:sqlite`, and the new test never calls
`Bun.serve` — it probes ports via `node:net` instead, and verifies
`startServer()`'s `Bun.serve` behavior only via a manual run recorded in the
PR). That workaround is file-local and doesn't fix the underlying gap: the
NEXT script test that needs a real `Bun.*` API (not just `bun:sqlite`) will
hit the identical wall. The fix, if wanted, is either a one-line `--bun` flag
added to `check-lane.ts`'s node-project commands (changes the runtime for the
whole `node` project, not just one file — I'm not confident that's safe by
default without checking whether anything in that project currently relies on
Node-specific behavior Bun's compat layer doesn't match) or a doc note in
CLAUDE.md's Quality gates table. I did not make either change myself since
both are outside `scripts/telemetry-serve.ts`'s scope and the safe option
depends on a broader compatibility check I didn't do.
