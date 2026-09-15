# `check:ui` walks only the surfaces its diff can reach — ADR 0104 §2 is amended for this lane alone

## Status

accepted (2026-09-15, PRD #3625 slice B, issue #3628). Amends ADR 0104 §2
("lane content is never diff-derived") for `check:ui` only. Builds on issue
#3627 (the scoper and the import graph) and issue #3626 (the per-run lane
account).

## Context

`check:ui` walked every surface at five viewports on every `skin` PR. A
two-line fix inside the debug sheet paid for the deck builder, the Limited list,
the draft room and the design system. `--surface=` existed, but a subset run
printed `DIAGNOSTIC` and `land` accepted only a full `RECEIPT`.

ADR 0104 §2 forbids exactly the shortcut that would fix this: no check in a
lane's plan scopes its content to the files the diff touched. That rule was
written for vitest projects, and the failure it defends against is the census
failure: a guard whose job is to notice something the diff did NOT touch (a
catalogue sweep, a registry drift check, a barrel mock) goes silent the moment
the diff decides which tests run. Issue #2431 shipped that failure once.

Issue #3627 built the scoper (`scripts/lib/ui-scope.ts`): each surface declares
its route entry modules, a static import graph of `src/**` gives each entry's
closure, and a changed path selects the surfaces whose closure contains it. The
scope was printed at the start of every run, but not used to narrow the walk.

## The argument

A surface's rendered layout is a function of three inputs, and nothing else:

1. **its route module's import closure** — every component, hook and helper
   the route renders. The scoper computes it from the real static graph,
   including literal dynamic `import()`, so it is scoped EXACTLY;
2. **the global styling inputs** — stylesheets, design tokens, shared UI
   primitives (`src/components/ui/**`), the app shell, the router,
   `index.html`, `public/**`, the build configuration's closure and the lane's
   own walks, probe and budgets. Any of them can move every surface, and any
   change to one forces the full run;
3. **deployment data** — the account's games, decks, fixtures. The per-run lane
   account (issue #3626) pins it: every run starts from the same empty account,
   so a scoped surface's numbers do not depend on whoever used the account last.

Scoping (1) exactly and never scoping (2) leaves no input a changed file can
reach without selecting the surface it moves.

**The census failure mode is kept out by the fail-closed rules, not by luck.**
`check:ui` has no guard whose job is to notice an untouched file: every surface
is a measurement of one route, not a sweep across the catalogue. The one way a
diff-derived scope could go silent is a changed file the scoper fails to place,
and the scoper answers that the way `check:lane`'s `classifyPath` does: a path
no rule places and no closure contains forces FULL. "Unknown" means "run
everything".

## Decision

1. **A `check:ui` run started with neither `--surface=` nor `--all` walks the
   scope of its diff** against the configured base branch. FULL walks every
   surface and prints `RECEIPT`, as before.
2. **A narrower scope prints a third banner kind, `SCOPED`**, naming the diff
   base and every surface in scope; the coverage line counts against that set.
   An empty scope walks nothing (no deployment, no browser) and prints a
   `SCOPED` receipt that says so. A hand-picked `--surface=` subset still prints
   `DIAGNOSTIC`, even when it names the same surfaces: only the scoper may
   narrow a receipt.
3. **`land` re-derives the scope from the PR's own diff**, with the same
   function `check:ui` ran (`landingDiffScope`, `verify-receipt.ts`), and
   re-renders the banner from THAT scope — the pasted surface list is never
   trusted. A `SCOPED` receipt is refused when a scoped surface is missing, a
   surface outside the scope is present, the base differs, or the diff forces
   FULL. The budget census checks only the surfaces in the scope.
4. **A full `RECEIPT` satisfies any diff**; running more than owed is never
   refused. **A `DIAGNOSTIC` satisfies none** — refused explicitly, since its
   banner re-renders consistently from its own rows.
5. **The exemption does not extend to vitest projects.** ADR 0104 §2 stands
   unchanged for every `--project` invocation in every lane. A test suite is
   exactly the place census guards live; a browser walk of one route is not.

## Consequences

- A session fixing one isolated component waits for the surfaces that
  component reaches, not for the whole app. A diff touching a shared primitive
  or a stylesheet still pays the full run.
- The scoper's rules are now load-bearing for a gate. Loosening one (say,
  moving a directory out of the "shared UI primitive" rule) narrows receipts,
  and belongs in a reviewed change to `ui-scope.ts` with its tests.
- **Accepted hole — Tailwind's class scan.** Tailwind v4 builds utilities from
  class names found in every non-ignored file. Deleting the last literal
  occurrence of a class from a file outside a surface's closure can drop a rule
  that surface assembles only at runtime. A class written literally in the
  surface's own components keeps the rule alive, so the hole is limited to
  runtime-built class strings. Recorded in `ui-scope.ts`, not closed.
- **Residual — the graph at landing time.** `land` derives the scope from the
  PR's diff on the PR's tree before its rebase, the same tree the receipt was
  walked on. A base-branch change that makes another route import the changed
  file after the receipt was taken is not seen; a full `RECEIPT` has the same
  pre-rebase blind spot today.

## What would change the answer

- A surface whose layout depends on an input outside the three above (a runtime
  fetch of remote styling, a feature flag read from the deployment) makes the
  argument incomplete for that surface: it moves into the FULL rules, or the
  argument is re-made.
- A census-style check added to `check:ui` (one whose job is to notice a
  surface the diff did not touch) could not be scoped, and would run on every
  receipt.

## Alternatives considered

- **Glob lists per surface.** Rejected by the PRD: coverage written as globs
  rots when a component moves or a route gains an import. The real static graph
  cannot drift from the code.
- **Accept a hand-picked `--surface=` subset in `land`.** Rejected: nothing ties
  the subset to the diff, which is how the #2742 bypass looked.
- **Scope vitest projects the same way.** Rejected, and outside this ADR: ADR
  0104 §2's argument applies to them in full.
