# `check:ui` walks only the surfaces its diff can reach — ADR 0104 §2 is amended for this lane alone

## Status

accepted (2026-09-15, PRD #3625 slice B, issue #3628). Amends ADR 0104 §2
("lane content is never diff-derived") for `check:ui` only. Builds on issue
#3627 (the scoper and the import graph) and issue #3626 (the per-run lane
account). **Amended 2026-09-30 (issue #4913)**: the argument is re-made at
SURFACE granularity for the specimen rows, type-only imports are no edge, and
the full walk moves to batch health — § Amendment below.

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
  PR's committed diff on the PR's tree before its rebase; `check:ui` also
  counted uncommitted and untracked files. Where the two differ the surface
  sets differ and the receipt is refused, so the divergence fails closed. What
  is not seen is a base-branch change, landed after the receipt was taken, that
  makes another route import the changed file: that route was never walked. A
  full `RECEIPT` walked every surface and has no such hole; what both kinds
  share is staleness — neither is pinned to a commit, so a later commit that
  keeps the surface set unchanged still verifies.
- **Fail-closed on a scope that cannot be derived.** If `land` cannot compute
  the scope, the diff owes a full `RECEIPT` — never "no receipt".

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

## Amendment (issue #4913) — surface granularity, and the full walk in health

### What the route-level argument missed

The argument above scopes a surface by its ROUTE's closure. That is exact for
a surface that measures a route. It is not for the ~30 specimen rows of
`/admin/design-system` (`dlg-*`, `pick-*`): each opens ONE dialog or picker
from fixture props and measures that layer, yet each declared the page's route
as its entry, so any file in the page's closure selected all of them. PR #4911
changed one admin hook and one admin panel, the hook was named by one section
of that page, and the run walked 34 surfaces × 5 viewports — 31 of them
dialogs and pickers the diff could not move. Meanwhile nothing walked every
surface outside PRs: health did not include `check:ui`.

### The argument, re-made for a specimen row

A specimen row's rendered layout is a function of:

1. **the module it mounts** — its `mounts` closure, exactly as a route's;
2. **its section** — the module of the page that renders the openers and the
   fixture props for that section's rows (`Surface.specimen.section`): a
   change there can move any row of the section, so it selects them all, and
   no other section's;
3. **the page's scaffolding** — the route's closure not descending into any
   specimen section: the frame every row is opened over, which still selects
   every row;
4. the global inputs of the original argument, unchanged.

Each closure is taken from the same static graph; the section closure does
not descend into a sibling row's mount, and the page closure does not descend
into any section. A file in none of a row's three closures cannot be on that
row's screen, unless one of the residuals below holds.

**Type-only imports are no edge.** `import type … from` and
`export type … from` are erased at build, so no code of the named module runs
on the importer's account; the graph keeps them aside (`typeImportsOf`). A
path reachable from the shell, the build or any surface ONLY through such
edges contributes no surface — it is not "unplaced", and it does not force
FULL: a type change that matters fails `check:ts`, not a browser walk. The
same edge was what put the specimen page's whole section on PR #4911's diff
(`sections-overlays.tsx` names the admin hook in an `import type`).

### Residuals, and the backstop

Accepted at this granularity, beside the two the original argument accepts:

- a section that renders one of its mounts UNCONDITIONALLY (not behind an
  opener) puts that module on screen for every row of the section; the
  scoper selects only the row that claims it. The section modules today open
  every specimen behind an opener, and the surface table's guard
  (`ui-gate-surface-entries.test.ts`) pins the model "the section imports
  each mount it opens", not this;
- a regression in a sibling section's frame under an open layer: the page
  surface (`design-system`) measures the page with no layer open, the row
  measures its layer over the page, and only the FULL walk measures the pair.

NOT residuals — refused by the same guard, because the scoper prunes by
node: a specimen section imported by anything but its route entries (a helper
`lib.tsx` took from it would leave the page scaffolding), and a row's mount
imported inside its section's pruned closure by anything but the section (a
fixture borrowing a constant from a sibling dialog would leave that row's
closure). A mount importing a sibling mount (the game-over dialog renders the
sideboarding one) is inside its own row's unpruned mount closure and is not
refused.

**The full walk now runs in batch health.** `check:ui --all` is the last
`HEALTH_SCRIPTS` step (`scripts/lib/health-step.ts`): it runs after every
offline verdict, on the batch's tip, under the same RED marker as the other
steps — a failing surface leaves `RED`, `bun run health:fix` is the exit. It
is the one health step that is not offline (it needs the local deployment and
a browser), which is why it lives there and not in `check:all` (§ Decision 5
and `docs/agents/quality-gates.md` § check:ui both stand). Every residual —
the two above, the Tailwind class scan, the base-branch graph drift — is what
this walk exists to catch, at batch cadence instead of on every PR.

Three costs of that placement, priced rather than hidden:

- **Any non-`PASS` exit is a `RED`**, an `INFRA` cell or an unreachable
  deployment included — the same semantics as every other step, as the
  issue asked, and the opposite of a walk that can go quietly amber. A RED
  from the machine, not the tree, is cleared by re-running `bun run health`
  on the same tip (a red `last.json` does not short-circuit), and
  `health:status` names the failing step so the reader knows which it was.
- **Under `--under-lock`** (the per-batch gate, ADR 0136 §6) the heavy mutex
  is held for the whole run, so the walk — 4 to 29 min measured for a full
  scope, 60 min run deadline — lengthens the one block a queued `land` waits
  on by that much, once per batch. The walk also takes the `check:ui` lane
  lock, so it never overlaps a PR's own run on the backend.
- **The walk tests the tip's frontend against the functions the shared local
  deployment currently serves**: `check:ui` never pushes Convex functions
  (a second `convex dev` against the same backend is what the lane refuses),
  on a PR as in health. A batch whose functions no session pushed can red or
  green against another tree's functions; pushing the tip from health is a
  separate decision, not taken here.

### Decision, amended

6. **A specimen row is scoped by its section and its mounts**, never by the
   route closure every row on its page shares. `land` re-derives the scope
   with the same function (`landingDiffScope`), so a receipt walked under the
   old 34-surface scope is refused on the same terms as any stale one.
7. **A type-only import is no edge**, and a path reachable only through one
   contributes no surface.
8. **`check:ui --all` is a batch-health step**, RED-marker semantics
   included. A PR receipt stays `SCOPED` (or FULL when a global input forces
   it); `check:ui` is still not in `check:pr` or `land`.

> **Superseded in part by issue #4962.** The two bullets above on "any
> non-`PASS` exit is a `RED`" and on the walk "under `--under-lock`" no longer
> hold: nine of the walk's first ten health verdicts were RED on the
> environment. The per-batch gate now releases the heavy mutex before the walk
> (`health-main --phase=offline`, then `--phase=walk`); a fatal exit, a down
> deployment, or a walk whose failing rows are all the machine's records
> `infra`, not `RED`; and a walk failure raises the marker only after 5
> consecutive non-infra walks. The rule lives in `docs/agents/quality-gates.md`
> § check:ui; `release` still requires the walk green.

Measured on the tree at the amendment (`landingDiffScope`): the two `src/**`
files of PR #4911 — the ones its 34-surface receipt was scoped on — 34 → 3
surfaces (`admin-scenarios`, `admin-bot-findings`,
`admin-bot-findings-classes`; the merge commit also carries a CR-ledger
entry, which is unplaced and forces FULL in either scoper); one board dialog
(`pause-menu-dialog.tsx`)
42 → 14 (its own row, the page, and the game surfaces that mount it); one
cast-picker section frame 31 → 10; the page's shared scaffolding
(`design-system/lib.tsx`) 31 → 31, as it must.

### Survey — no other rows gain a narrower key

Every other group of surfaces sharing a route entry (six on the lobby, seven
on the deck builder, the game surfaces, the Limited surfaces) reaches its
overlay by WALKING the route: the route is on screen under the layer and on
the path to it, so the route closure is the surface's closure, not an
over-approximation. The specimen page is the one place a surface's walk
mounts a module the page does not otherwise render.
