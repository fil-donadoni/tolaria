# The check:ui seam is one namespace, absent in production, double-gated on the server

## Status

accepted (2026-11-12, issue #9271).

## Context

`bun run check:ui` reaches every state through the real UI: lobby flows, the
debug sheet's Scenarios list, fixture rows. That is safe and slow. Every
speed-up that jumps straight to a state (a declared position, the end of a
mocked draft, sideboarding between games) needed somewhere to live that cannot
become a production hole. The building blocks already existed, separately:

- the fail-closed local-deployment check, `isLocalDeploymentUrl`
  (`convex/lib/uiGateLaneAccount.ts`);
- the lane-account address predicate, `isLaneAccountEmail` (same module);
- the client's `import.meta.env.DEV` flag. The lane's own Vite dev server
  carries it, and a production `vite build` inlines it as `false`.

## Decision

**One namespace, both sides.** Every seam spelling starts with the marker
`UI_SEAM_MARKER` (`__uiseam`), declared in `convex/lib/uiSeamNamespace.ts`.
The module has no dependencies, so the lane's `scripts/` can import it too:

- client routes live under `UI_SEAM_ROUTE_PREFIX` (`/__uiseam/…`) and are
  listed in `src/lib/uiSeam/ui-seam-routes.ts`;
- query parameters use keys under `UI_SEAM_PARAM_PREFIX` (`__uiseam_…`). A seam
  route's `validateSearch` is `pickUiSeamParams`, which keeps only string values
  under that prefix;
- server functions live in ONE module, `convex/uiSeam.ts`.

Nothing outside this namespace may serve as a lane shortcut.

**Client gate: absent, not hidden.** `src/router.tsx` adds the seam routes
inside `if (import.meta.env.DEV)`. A production build drops that branch as dead
code, and with it every module only the branch reaches. A seam path in
production matches no route, so it renders the ordinary not-found page. No
product code reads a reserved parameter, so in production one is simply
ignored. The seam routes stay out of the typed `Register` tree: nothing in the
product links to them, and only the lane types their URL.

**Server gate: the real boundary.** A Convex function deploys to every
deployment, so every seam function's handler opens with
`await assertUiSeamCaller(ctx)` (`convex/lib/uiSeamGate.ts`). The gate refuses
unless BOTH conditions hold:

1. the deployment is local (`CONVEX_CLOUD_URL` passes `isLocalDeploymentUrl`;
   a missing or unparsable URL is refused);
2. the caller is signed in as a lane account (`ui-gate+<runId>@ui-gate.invalid`).
   **Being an admin is not enough.**

The checks run cheapest first: the environment, then the auth token, then the
gate's own single `users` read. A refusal therefore happens before any read or
write of the seam function's own, and its message names the condition that
failed.

**Mechanical guards, not prose.**

- `convex/__tests__/uiSeam.test.ts` has two parts. The dynamic part runs the
  real handlers through each refusal and asserts which database calls were
  made. The static part parses `convex/uiSeam.ts` with the TypeScript compiler
  and reds on any export that is not a public `query`/`mutation` whose
  handler's FIRST statement awaits `assertUiSeamCaller(ctx)`. Actions are
  refused because the gate reads `ctx.db`. Internal functions are refused
  because deploy access needs no seam. Re-exports are refused too.
- `bun run check:bundle` (`scripts/lib/ui-seam-bundle.ts`) reds when any
  emitted `.js`/`.css`/`.html`/`.map` asset of the production build contains
  the marker. The build is the cost, already paid by `check:bundle`
  (`HEALTH_ONLY_GUARDS`); the scan itself takes milliseconds.
- `src/routes/__tests__/router-ui-seam.test.ts` covers routing. With DEV true,
  the echo route matches. With DEV false, no route id starts with the prefix.

**Every spelling in the namespace module is a plain string literal.** On the
first production build, template literals built from the marker survived tree
shaking even with the DEV gate intact: the bundler cannot prove that a template
literal has no side effects. The bundle guard caught it. A test now asserts
that each literal starts with the marker.

**What may go there:** a route, a parameter or a query/mutation whose only
purpose is to bring the lane to a state faster than the UI can. **What may
not:** anything the product needs. That includes an auth shortcut: the lane
still signs up through the real Password flow (`convex/uiGateAccounts.ts`). It
also includes any change to the existing debug-sheet or admin gates, which stay
as they are.

The first member is the trivial echo pair. `uiSeam.echo` returns the caller's
run id and the `?__uiseam_echo=` value, and `/__uiseam/echo` renders the answer.
Later lane speed-up issues add their shortcuts to this namespace without
re-deciding the security model.

## Consequences

- A seam shortcut costs one route entry, one parameter key and one gated
  function, and inherits both gates.
- Importing `convex/lib/uiSeamNamespace.ts` from ordinary `src/` code puts the
  marker in production and reds `check:bundle`, by design.
- If the DEV gate is removed, `check:bundle` reds. This was proven by hand in
  the issue #9271 PR, by building with the gate's condition forced true.
