# Draw-replacement: unified event, discovered centrally, applied at a resumable draw seam

## Status

accepted

## Context

Issue #735 shipped Zur's Weirding and Enduring Renewal on a **parallel**
`CardDefinition.drawRevealReplacement` field — a narrow DSL bolted onto two draw
sites (the turn-based draw step and the DSL `draw` Op) with its own bespoke
`draw-reveal-pay` suspension. It lives entirely outside the general CR 614
replacement loop in `replacements.ts`.

That stopgap leaves three structural gaps:

- **Not CR-general.** A draw is a replaceable event (CR 614); modelling it as a
  card-specific field rather than a `ReplacementEventKind` doesn't compose. New
  draw-replacement families — Hullbreacher (redirect a draw to a Treasure),
  Leovold (prevent draws past the first each turn), Quantum Riddler (draw N → N+1
  on a hand-size condition), dredge (mill-and-return instead of drawing),
  miracle's shared first-draw signal — have nowhere to hang.
- **Effect draws are blind (#1250).** ~38 `resolve()` closures call the
  synchronous `drawCards` primitive, which cannot pause for an interactive
  replacement (Zur's "any other player may pay 2 life"). Under Zur's, those draws
  silently skip the pay option. The draw step and DSL Op suspend; the 38 closures
  can't.
- **#894's dead seam.** #894 was opened to add "choice-injection inside a
  synchronous replacement" (`ReplacementApplyContext` is a sync mutator with no
  choice point) to make Zur's work. It never landed, yet #735 shipped anyway — by
  sidestepping the sync path with a phase-level `PendingChoice`. The sync
  choice-injection seam was never actually needed.

The engine is **pure synchronous functions**: a `resolve()` closure is one
opaque call and cannot suspend mid-body (that would re-run the closure on resume
→ double-draw). Only the **DSL interpreter** is step-indexed and resumable
(`resolutionStep`), which is why the DSL `draw` Op — and only it, plus the draw
step — can pause for a choice today.

## Decision

**A draw is a first-class `"draw"` `ReplacementEventKind`, discovered through the
central replacement system but applied at a resumable draw seam — never through
the synchronous `ReplacementApplyContext` mutator path.**

1. **Unify (discovery).** Add `"draw"` to `ReplacementEventKind` / the
   `ReplacementEvent` union. The replacement system owns **discovery, source-zone
   scanning, `applies` predicates, and CR 616.1 ordering** (the affected player
   orders multiple applicable draw-replacements). This is the one canonical seam;
   #735's `drawRevealReplacement` migrates onto it and is retired.

2. **Single choke point (application).** Every draw funnels through one
   suspend-capable draw seam so draw-replacement fires at **all** draw sites
   (draw step, DSL Op, effect draws) — this subsumes #779 and #1250 into one
   mechanism and retires the `draw-reveal-pay` special case. Because a draw event
   may require a choice (dredge "may mill", Zur's "may pay", CR 616.1
   pick-which, a count bump), it is **applied at the resumable seam** and drives
   its choices through `PendingChoice`/`resolutionStep`. Draw-replacement is the
   one replacement kind that resolves at a resumable site instead of via the sync
   mutator — so #894's "choice inside a synchronous replacement" is never needed
   and #894 is obsolete.

3. **Effect draws migrate to the DSL `draw` Op.** The ~38 `resolve()` draw
   callers move onto the DSL `draw` Op (the resumable path). A **catalogue-wide
   CI guard** forbids a `resolve()`/`resolveSteps` closure from calling the draw
   primitive: draws go through the Op. A genuinely protocol-like card that must
   both draw and use inexpressible logic is a **stop-and-issue** (tracked stub),
   never shipped silently broken — the broken shape is unauthorable by
   construction, not merely rare. The raw synchronous `drawCards` remains only
   for internal non-interactive plumbing.

4. **Rich event payload + predicate scope.** The `"draw"` event carries
   `{ drawingPlayer, drawIndexThisTurn (0-based), isTurnBasedDrawStepDraw,
   requestedCount }`. Scope is expressed by the `applies(event, source)`
   **predicate** (`event.drawingPlayer !== source.controllerId` = "each
   opponent"), **not** a `controller | all-players | each-opponent` enum — CR
   models replacements as "a player / an opponent" conditions, which an enum
   can't generalize. A replacement outcome may **modify the count** (Quantum
   Riddler N → N+1), redirect (Hullbreacher → Treasure), or skip (Leovold).
   `drawnThisTurn` is promoted from write-only to a read-side source for
   `drawIndexThisTurn`; this same first-draw signal feeds miracle later.

**Scope of the initial rollout (#779):** the seam + migration of #735's two
cards (slice 1), the 38-caller migration + CI guard closing #1250 (slice 2), and
Hullbreacher + Leovold (slice 3). **Dredge** (CR 702.52 — graveyard-source, may,
mill+return) and **miracle** (CR 702.94 — first-draw trigger + special cast
window) are explicit follow-ups the seam is *designed* to accommodate but does
not implement here. **Quantum Riddler** is deferred to a future **Warp** keyword
issue (its draw-replacement half — the count-bump case — is exercised by an
interpreter test until a card uses it). The general "opponent drew a card"
trigger the earlier survey flagged is **not** on this path (modern Leovold rides
the shipped #1193 targeted-trigger foundation, not a draw trigger) and is dropped
from scope.

## Consequences

- One CR-correct draw-replacement seam; new families are `applies` predicates +
  outcome shapes, not new fields.
- #1250 is closed structurally, not patched: after migration every draw site is
  replacement-aware, and the CI guard keeps it that way.
- #894 is closed as obsolete — its premise (choice inside a sync replacement) is
  designed out.
- Cost paid once: the 38-caller migration and the primitive/seam contract are the
  real work; thereafter reuse is free.
- A protocol card that must draw interactively is blocked until resumable
  `resolve()` exists — an accepted, tracked limitation (≈0 cards today), never a
  silent break.
