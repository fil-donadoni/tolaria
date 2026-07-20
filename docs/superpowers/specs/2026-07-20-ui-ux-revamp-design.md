# UI/UX Revamp — decisions & implementation plan

**Date:** 2026-07-20
**Status:** phase 1 shipped (`02775277`); phases 2–5 planned
**Prototype:** `/prototype/zone-motion` (folded in and deleted per repo convention; verdict captured in §3)

## 1. Origin

User-driven substantial UI/UX revamp of the whole app, starting from six reported
pain points: (1) suboptimal contrast in dialogs and the design system, (2) card
images looking bad after heavy bandwidth optimization, (3) stack + card-preview
need improvement, (4) zone-change animations wanted (hand→graveyard, hand→stack,
stack→battlefield…), (5) UI coherence, (6) limited section needs a deep rework.

Four parallel audits fed the plan:

| Audit                                         | Headline findings                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system (`index.css`, `ui/`, consumers) | `text-disabled` 3.13:1 and `danger` 3.43:1 contrast failures; dialog scrim `bg-black/10` + `ring-foreground/10` (1.27:1) makes dialogs float with no separation; 3 modal languages + 13 copy-pasted banner recipes; 313 chromatic Tailwind utilities in 63 files (ADR 0007 breach); dead components (`TitleTreatment`, `StatChip`, keyrune ~2.2 MB for 1 consumer); dead token classes `bg-surface-2` / `bg-surface-muted` referenced but never defined           |
| Board / stack / preview                       | Stack is a 50%-overlap cascade (only top card fully visible; no controller/target/order info; hidden behind a chip in portrait); preview has no hover (right-click/right-hold/long-press only), 256px dock, 3 overlapping context-menu-suppression hacks; image pipeline solid but mistuned                                                                                                                                                                       |
| Animations / performance                      | FLIP infrastructure (`SpatialSlot` + `LayoutGroup`) already exists and is tested (#252) but only hand↔battlefield participate; card instance ids are stable across zones; no event feed on the wire (GRE `pendingEvents` discarded after trigger collection); 2.7 MB monolithic bundle (GRE engine + full catalogue in main chunk), whole-board re-render per push, quadratic `buildTriggerStateView` scans, collapsed piles mounting 50+ `CardPreview` instances |
| Limited / lobby                               | `useMyLimitedEvents` exists but is never imported (in-progress drafts unreachable); rarity rendered nowhere; draft is a collapsible panel section, not a room; right-click opens pick menu AND preview simultaneously; sealed pool is a pure text list; pool builder has no filters/search/stats; no app shell, no "leave event", unnamed admin-only events                                                                                                       |

## 2. Method

Prototype-first per the shared `prototype` skill. A throwaway route
(`/prototype/zone-motion`, deleted after fold-in) offered three radically
different motion languages on a scripted mini-board — **A** FLIP shared-element
(production spring), **B** arc + emphasis (overshoot spring, hop, scale pop,
gold glow), **C** snappy minimal (150ms pop, no travel) — plus an image lab
rendering real Scryfall renditions at the real slot widths with DPR-aware
upscale badges. The user evaluated in the browser and ruled:

> **Variant A, with B's glow but without the bounce (excessive). Images OK;
> keep the art + computed-text preview (it shows live card state: modern
> oracle text, granted/removed abilities) — find an intermediate quality
> solution, not the full printed card.**

## 3. Decisions (validated)

- **D1 — Zone-change motion = shared-element FLIP (variant A) + one-shot gold
  arrival glow (variant B's accent), no arc/bounce.** The existing
  `SpatialSlot`/`LayoutGroup` backbone (#252) was extended to every zone:
  stack items (`game-stack.tsx`), pile tops (`cards-pile.tsx`), portrait hand
  (`board-hand-portrait.tsx`).
- **D2 — Detection via client-side snapshot diff, no backend event feed in
  v1.** `useRecentArrivals` diffs consecutive wire snapshots by stable
  instance id (value-compared, loop-safe) and holds arrivals for 900ms. The
  GRE event stream (`pendingEvents`, 23 event types) stays a future upgrade
  for direction-aware choreography (destroy vs bounce vs exile flying
  differently).
- **D3 — Battlefield permanent-stack arrival deferral.** A just-arrived
  permanent renders as its own singleton for the arrival window
  (`groupBattlefield(…, deferStackIds)`) instead of being absorbed into a fan
  whose `layoutId` belongs to the old lead — otherwise the flight dies
  mid-animation. It merges into the fan when the window expires.
- **D4 — Piles participate with their top 3 cards only, keyed by stable
  instance id** (was: every card, keyed by array index). Flight endpoints are
  only ever pile tops; this also removes the 50+ mounted `CardImage` +
  `CardPreview` per deep pile.
- **D5 — Per-surface rendition strategy.** `thumb` (146w, heaviest
  compression) only for slots ≤96px (collapsed piles, portrait hand,
  chips) with accurate `sizes`; mid slots (hand 120px, stack 128px,
  battlefield, pickers, fan dialog 208px) exclude `thumb` from the srcset so
  1× displays get `grid` 488w; large surfaces get real `sizes` so `display`
  672w is reachable; `image-preload` mirrors the board srcset (no more
  warming candidates nobody fetches).
- **D6 — Preview = art + computed text stays; art upgraded to the `art` WebP
  rendition (626×457) with `art_crop` JPG fallback.** The full printed card
  is rejected for the main preview: only the computed text shows live card
  state (modern Oracle on old printings, granted/removed abilities, effective
  P/T). The full-card render remains an option for the phase-2 preview
  redesign as a _secondary_ surface.
- **D7 — Accepted v1 limitations:** opponent casts from a hidden hand glow
  but don't fly (no visible source; needs a synthetic card-back flight);
  portrait stack (behind a chip) doesn't participate; a permanent destroyed
  from inside a fan pops instead of flying (no mounted `layoutId` on fan
  members).
- **D8 — All new motion is reduced-motion gated twice**: JS
  (`useReducedMotion` in `ArrivalGlow`/slots) and CSS (the `arrivalGlow`
  keyframe applied only inside the `no-preference` media block; the
  `motion-gating` guard test now covers it).

## 4. Shipped — phase 1 (`02775277`)

- Zone-change flights: hand → stack → battlefield/graveyard, draw, discard,
  destroy, bounce, exile, mill — with the arrival glow on the destination.
- Image rendition strategy (D5) + preview art upgrade (D6).
- Pile depth culling (D4) as a performance side effect.
- Tests: `useRecentArrivals` (7), `game-stack-flight` (3), `cards-pile`
  flight/depth (4, merged with the pre-existing 7), `battlefield-stacks`
  deferral (3), `card-image-srcset` (new), `images`/`preview-body` extended,
  `motion-gating` extended. Gates: `check:all` ✓, full suite 9813 ✓.

## 5. Implementation plan — phases 2–5

### Phase 2 — Stack & card-preview redesign

- **Stack**: replace the 50%-overlap cascade with a readable list — controller,
  name, chosen mode, target summary as text (not hover-only arrows), resolve
  order numbers, expand-on-hover for deep stacks, real portrait treatment.
  Remove the dead `leader-line-new` wiring (`game-stack.tsx`, `package.json`).
- **Preview**: discoverable trigger (hover-intent on desktop, keep
  right-click/long-press as power paths), larger surface (400–480px class),
  consolidate the three context-menu-suppression hacks into one model, keep
  the D6 art+computed-text content. Evaluate a secondary "printed card" view
  as an explicit toggle.
- **Method**: standalone HTML mockups, 2–3 A/B variants each, then fold the
  winner into real components.

### Phase 3 — Design system unification

- **Contrast**: raise `text-disabled` (3.13:1 → ≥4.5) and `danger`-as-text
  (3.43:1 → ≥4.5); dialog scrim `bg-black/10` → 40–60%; visible panel
  boundary (the 1.27:1 `ring-foreground/10`); input borders (1.19:1) and a
  visible focus indicator (now 1.41:1). Define or delete the
  `bg-surface-2`/`bg-surface-muted` dead classes (6 consumers currently render
  with no background).
- **Coherence**: one modal language (converge on GameDialog/Panel);
  centralize the banner recipe (13 copies, 52 inline corner brackets);
  resolve the button triplication (`.btn-tone-*` vs shadcn `Button` vs ad-hoc);
  tokenize the signal hues (turn/priority emerald-rose-amber, selection
  violet) and migrate the 313 chromatic utilities per ADR 0007; unify
  radius/scrim/z-index scales; prune or adopt the dead layer
  (`TitleTreatment`, `StatChip`, `OrnamentalDivider`, keyrune font).
- **Method**: direct implementation; contrast verified numerically (WCAG) in
  review; visual pass over lobby/board/limited screens at the end.

### Phase 4 — Limited rework

- **Continuity**: wire `useMyLimitedEvents` ("My Events" on `/limited` and
  lobby), event names, a leave mutation, share-link antechamber like
  `/join/$gameId`.
- **Draft as a room**: dedicated full-screen route — pack tray, pool dock,
  timer bar with progress, pick confirmation, rarity/color/MV sort (rarity is
  currently rendered nowhere), pass-direction indicator, fix the right-click
  pick-menu/preview collision, keyboard-operable pick flow.
- **Sealed/pool browsing**: replace the text-list pool with an image grid +
  grouping; reuse the catalogue deckbuilder's filter/sort/search stack in the
  pool builder; deck analytics (curve, color pips, type counts), basics
  stepper, optional auto-build (the bot algorithm exists server-side).
- **Shell**: persistent app nav + ambient ground on every page; fix the
  uncentered `Panel`-as-page on the event detail.
- **Method**: `design-an-interface` parallel mockups for the draft room, then
  a prototype route with real event data before production.

### Phase 5 — Client performance

- Route-level code splitting (the 2.7 MB monolith ships the GRE engine + full
  card catalogue via `brain-client.ts` / `useVsAiDriver.ts` — move behind
  dynamic import); delete dead deps (`pixi.js`, `pixi-filters`,
  `leader-line-new`, `react-json-tree` from the prod path, keyrune if phase 3
  doesn't adopt it).
- Re-render diet: split `GameContext` (static vs volatile), hoist
  `buildTriggerStateView` to one build per push (currently ~30×/push), split
  the arrow-anchor context (dispatcher vs data).
- Optimistic own-action feedback (flight on commit, masking the ~100–300ms
  mutation round-trip).
- Optional backend piece: persist a bounded per-commit event list
  (`PERSISTED_OPTIONAL_KEYS` + wire-format tests per AGENTS.md) for
  direction-aware flight choreography.

## 6. Open questions

- Preview redesign direction: art-forward vs framed full-card render with
  live-text overlay (phase 2 mockups decide).
- When to build the wire event feed: phase 5, or earlier if direction-aware
  choreography becomes a priority.
- A toast system beyond the board (limited/lobby currently use copy-pasted
  inline error banners) — fold into phase 3 or 4.

## References

- ADR 0007 (UI design system), ADR 0026 (library knowledge projection),
  PRD #249 (spatial board, slices #251/#252/#255), PRD #621 (permanent
  stacking).
- Phase-1 commit: `02775277` feat(ui): zone-change card flights, arrival
  glow, sharper card art.
