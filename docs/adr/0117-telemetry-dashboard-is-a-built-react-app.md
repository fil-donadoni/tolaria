# The telemetry dashboard is a built React app, and the manifest is its serving allow-list

## Status

accepted (PRD #3148 S0, issue #3149; supersedes the no-build-step constraint
#2625 shipped under)

## Context

`scripts/telemetry-dashboard.html` plus `scripts/dashboard/**` was the only
surface in this repo built without the stack everything else standardised on:
37 plain ES modules, ~8,100 lines, 1,602 lines of hand-written CSS, no build
step, and a hand-rolled tooltip engine, focus trap, tab router and theme
toggle. `telemetry-serve.ts` served it from `DASHBOARD_ASSET_NAMES`, an
EXACT-MATCH map of 37 hand-written filenames.

The no-build-step constraint was deliberate when the dashboard was one file
(#2625): an operator's `bun run telemetry:dash` had to work from a fresh
checkout with nothing but `bun install`. What it bought — no toolchain — it
paid for in re-implementations. The cost is not aesthetic; PRD #3148 records
it concretely: the session-tail drawer closes on `Escape` only while focus is
inside it and not at all on a click outside, because both behaviours are
hand-written and only the easy half was written; every table is string
concatenation, so a cell is HTML the caller must remember to escape;
`dialog.js` exists because the focus trap had to be extracted the second time
a modal appeared.

React 19, Tailwind 4 and shadcn are already dependencies, already gated,
already the house style in `src/`.

## Decision

**1. The dashboard is a Vite app** — `dashboard/` at the repo root, built by
`vite.dashboard.config.ts` (`bun run telemetry:dash:build`). It is a SECOND
Vite config, not an entry added to the first: it shares nothing with the game
client but the design system. `@`/`~` resolve to `src/`, so the shadcn
primitives are importable rather than copied.

**2. The build manifest replaces the asset allow-list.** A bundle's filenames
carry content hashes, so a list of literals cannot survive — nobody can write
`index-iaOdGxez.js` in advance. `telemetry-serve.ts` reads Vite's
`manifest.json` ONCE at boot and serves exactly the files it names.

**The property that must not weaken is the one the literals had, and it is
not "no traversal reaches disk" — it is that no filter has to be right.** The
request contributes a lookup KEY and nothing else: never joined with a path,
never decoded, never normalised, never `startsWith`-compared against a root.
`..`, `%2e%2e%2f`, `%252e%252e%252f`, a backslash, an absolute path, a
symlink, a null byte, `__proto__` — all of them are keys that are not in the
`Map`, so the refusal is BY CONSTRUCTION, and each is a row in
`telemetry-serve.test.ts` that also asserts nothing was read. What changed is
only where the names come from. Two smaller decisions keep the claim total
rather than conditional on the bundler's good behaviour: a manifest name that
would leave the output directory is REFUSED, not clamped, and the built
`index.html` is excluded from the asset map, so `/assets/index.html` can never
hand out a shell without the action token.

**3. A missing build is a 503 that names the command**, never a blank page and
never a crash. A fresh checkout has no build; the server's job there is to say
`bun run telemetry:dash:build`. `/api/*` keeps answering — the routes do not
depend on the view layer.

**4. In `--dev`, Vite serves the page and proxies `/api` to the Bun server**,
not the other way round. HMR is a WebSocket upgrade plus a module graph, and
proxying it through a hand-written Bun handler would be a second, worse
implementation of Vite's own dev server. Vite binds the well-known port, so
`bun run telemetry:dash --dev` still means "open 127.0.0.1:5174"; the Bun
server takes an ephemeral one, and its `Origin` allow-list is built from the
port the PAGE has, still from `loopbackOrigins`' literals.

The per-boot action token (#2628) reaches the dev document through the child
process's ENVIRONMENT — `telemetry-serve.ts --dev` spawns Vite and passes it —
and through nothing else. An `/api/action-token` route was rejected: it would
be a second, permanent way to obtain a privileged credential, live in
production too, existing purely for a developer convenience.

**5. The strangler is the point.** S0 ports no component: `dashboard/App.tsx`
renders the exact shell markup the hand-written HTML rendered — same ids, same
classes, same ARIA — and hands over to the unchanged vanilla modules after
`flushSync` commits the render. S1-S3 replace subtrees; S4 deletes
`scripts/dashboard/**`. The page is a React tree at every commit and behaves
identically at every commit.

**6. The Now/History data boundary is guarded on BOTH graphs.** PRD #2621 D1
requires the Now view to read no database route, and `telemetry-serve.test.ts`
enforced it by crawling every module statically reachable from `main.js`. That
crawl survives untouched — the vanilla modules are still the behaviour — and a
second crawl now walks the React graph from `dashboard/main.tsx` with the same
allow-list of routes. A guard on the vanilla graph ALONE would go quietly
vacuous exactly as the port progressed: by S4 it would crawl an empty
directory and pass forever.

## Consequences

- `bun run telemetry:dash` now requires a build. That is the cost of the
  decision, paid explicitly: the 503 names the command.
- `dashboard/dist/` is gitignored (`dist`, already matched) and prettier
  ignored.
- `tsconfig.dashboard.json` joins the project references, with `allowJs` on so
  the React entry can resolve the legacy `.js` handover. Both settings expire
  with `scripts/dashboard/**` at S4.
- The dashboard remains outside `check:ui`: its runbooks sign into the game
  app, and adding it is a separate decision, not a precondition (PRD #3148).
