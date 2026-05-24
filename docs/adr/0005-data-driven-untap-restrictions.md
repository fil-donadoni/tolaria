# ADR 0005 — Data-driven untap-step restrictions

**Status:** Accepted (2026-05-24)

## Context

CR 502.1 lets cards cap or skip the active player's untap step (Winter Orb,
Smoke, Stasis, Meekstone, and the per-permanent "doesn't untap" axis on
Basalt Monolith / Mana Vault / Paralyze). The pre-ADR engine encoded each
restriction as a bespoke `staticAbilities` keyword marker:

- `limits-acl-untap` (Winter Orb / Static Orb — original ACL Oracle)
- `limits-creature-untap-to-one` (Smoke)
- `prevents-untap-of-power-3-or-greater` (Meekstone)
- `skip-untap-step` (Stasis)
- `does-not-untap` (per-permanent — Basalt Monolith / Mana Vault / Paralyze)

`untapStep` in `convex/gre/phases.ts` hardcoded the predicate for each
keyword and selected the untap target deterministically (first tapped
match, no prompt). This was sufficient for the LEA slice but accrued three
problems:

1. **Every new printing adds an enum branch in the engine.** A printing
   that caps "no more than two artifacts" or "no more than one creature
   with power ≥3" requires a new keyword + a new untap-step branch — the
   antithesis of the data-driven factory family established by ADR 0002.
2. **Oracle drift.** The `limits-acl-untap` keyword encoded the LEA
   printing of Winter Orb. Modern Scryfall Oracle ([ADR 0004][adr-0004])
   caps lands only. The hardcoded branch made the Oracle fix a behavior
   change spread across keyword, dispatcher, display map, and tests.
3. **No prompt support.** Deterministic "first tapped match" silently
   removes player agency. Under CR 502.1 + 701.39 the cap is permissive —
   the active player MAY untap zero (a tactical zero-branch — see ADR
   0003). Without a prompt path, a player can never declare the skip.

## Decision

Encode untap-step restrictions as **data** in a new
`StaticUntapRestriction` member of the `StaticEffect` union, built by an
`untapRestriction(...)` factory under
`convex/cards/abilities/static/`. The engine's `untapStep` collapses to a
dispatcher: it collects every `StaticUntapRestriction` instance from both
battlefields in deterministic order (active player first, battlefield
order within each player) and either auto-resolves the cap or enqueues a
new `untap-pick` `PendingChoice` routed to the active player.

### Factory signature

```ts
untapRestriction({
    id: "winter-orb-land-cap",
    oracleText: "Untap up to one land (Winter Orb).",
    filter: { types: "Land" },
    maxUntap: 1,
    scope: "each-player", // default
});
```

`filter` is the existing `PermanentFilter` (CR 110.1). `maxUntap` defaults
to `0` (Stasis-style hard skip). `scope: "each-player"` is the only
shipping value; reserved enum keeps room for future controller-scoped
restrictions without a breaking change.

### Engine dispatcher

```ts
function untapStep(state: GameState): void {
    if (hasGlobalStaticAbility(state, "skip-untap-step")) {
        /* clear flags, return */
    }
    const restrictions = collectUntapRestrictions(state);
    const cursor = state.pendingUntapStep?.restrictionCursor ?? 0;
    for (let i = cursor; i < restrictions.length; i++) {
        const r = restrictions[i].restriction;
        const eligibles = activeBF.filter(
            (c) =>
                c.isTapped &&
                !c.staticAbilities.includes("does-not-untap") &&
                matchesPermanentFilter(c, r.filter)
        );
        // ADR 0003: auto-resolve when there's no real choice.
        if (r.maxUntap === 0 || eligibles.length === 0) continue;
        // Otherwise enqueue an `untap-pick` prompt; suspend the step.
        enqueueUntapPick(state, i, r);
        return;
    }
    // Final pass: untap unrestricted permanents, clear flags universally.
}
```

The cursor on `state.pendingUntapStep` survives the suspend/resume cycle
around `selectResolutionChoice` / `confirmUntapPick`. When a choice is
committed, the engine untaps the chosen ids on the chooser's
battlefield, re-enters `untapStep`, and either yields to the next
restriction's prompt or falls through to the per-permanent untap +
flag-cleanup pass.

### Pending-choice family

`ZonePickKind` gains `"untap-pick"`. `PendingChoice.count` is widened
from `number` to `number | { min: number; max: number }` — the range
shape encodes "the player may declare zero through N selections" so the
ADR 0003 tactical zero-branch is reachable. Existing fixed-N callers
(sacrifice / keep-hand / mulligan-bottom) keep working unchanged; new
callers use the range shape.

`selectResolutionChoice` accumulates ids and auto-commits at
`selected.length === max`. `confirmUntapPick` is the explicit early-commit
mutation surfaced as a "Skip untap" / "Done" button when `min === 0`.

### Oracle fix (Winter Orb)

Winter Orb migrates from `staticAbilities: ["limits-acl-untap"]` to
`staticEffects: [untapRestriction({ filter: { types: "Land" }, maxUntap: 1 })]`
per [ADR 0004][adr-0004]. The cap binds lands only — artifacts and
creatures untap normally. The legacy keyword and the
`hasGlobalStaticAbility("limits-acl-untap")` branch in `untapStep` are
removed, along with the `isAclPermanent` helper.

### Rollout

Slice S0 (this ADR) migrates only Winter Orb. Slices S1–S3 follow:

- S1 — migrate Smoke to `untapRestriction({ filter: { types: "Creature" }, maxUntap: 1 })`; cover multi-restriction sequencing (WO + Smoke).
- S2 — migrate Stasis to `untapRestriction({ filter: {}, maxUntap: 0 })`.
- S3 — migrate Meekstone to `untapRestriction({ filter: { types: "Creature", powerAtLeast: 3 }, maxUntap: 0 })`.

After S3 the legacy keyword markers (`limits-creature-untap-to-one`,
`prevents-untap-of-power-3-or-greater`, `skip-untap-step`) are removed
from `untapStep`. Until then the dispatcher keeps both axes for
backwards compatibility.

The per-permanent `does-not-untap` axis is orthogonal — left untouched
by this refactor.

## Rationale

1. **Composability over enum growth.** A `PermanentFilter` + integer cap
   covers Winter Orb / Smoke / Stasis / Meekstone / hypothetical future
   "no more than 2 artifacts" prints with zero engine churn. Mirrors the
   trigger-factory family (ADR 0002) — card authors learn one factory
   shape, the engine has one dispatcher.
2. **Single source of truth for Oracle compliance.** A printing that
   changes from ACL to land-only ([ADR 0004][adr-0004]) is a one-line
   filter change in the card def. No engine, display map, or test
   churn.
3. **Prompt path unlocks the tactical zero-branch.** Under the old
   keyword approach the active player could never decline an untap.
   Under the dispatcher, ADR 0003's "untap zero" surfaces naturally as
   the `{ min: 0, max: N }` count shape.
4. **Auto-resolve is preserved.** `maxUntap === 0` (Stasis-style hard
   skip) and `eligibles.length === 0` (vacuous) bypass the prompt
   entirely. Only cap-style restrictions with at least one eligible
   permanent surface the choice.

## Consequences

- New `convex/cards/abilities/static/untapRestriction.ts` factory + tests
  under `convex/cards/abilities/static/__tests__/`.
- `StaticEffect` union gains `StaticUntapRestriction` (no `applies`
  predicate — the engine reads `filter` directly).
- `PendingChoice.count` widens to `number | { min, max }`; helpers
  `getPendingChoiceMin` / `getPendingChoiceMax` read either shape.
  Existing fixed-N call sites continue to work without modification.
- `ZonePickKind` gains `"untap-pick"`; UI label registry extended.
- `state.pendingUntapStep` cursor field added — present only while a
  multi-restriction untap step is mid-processing.
- `untapStep` no longer hardcodes `limits-acl-untap` or `isAclPermanent`;
  it iterates `StaticUntapRestriction` instances.
- `advancePhase` returns early if `pendingChoices` was enqueued during
  `performPhaseEntry` (UNTAP can now suspend the auto-phase recursion).
- New mutation `confirmUntapPick` commits a partial selection (Skip).
- UI `PendingChoicePrompt` renders a "Skip untap" / "Done" button when
  `min === 0`.
- Winter Orb migrated to the factory with the modern Oracle land-only
  filter. The legacy `limits-acl-untap` keyword + its display entry are
  removed.
- Debug `PRESET_SCENARIOS` gains a Winter Orb golden-path entry for the
  multi-land prompt.

## Out of scope

- Smoke / Stasis / Meekstone migrations (slices S1–S3).
- Removing the legacy `does-not-untap` keyword — orthogonal axis, no
  factory replacement planned.
- Mass selection UX (drag-select, "untap all eligible" button) — the
  prompt is one-click-per-pick for now.

[adr-0004]: ./0004-modern-oracle-and-current-cr.md
