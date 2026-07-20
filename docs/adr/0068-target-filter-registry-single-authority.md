# Target-filter registry: a single compile-bound authority for target legality

## Status

accepted

## Context

Target legality for a spell/ability is decided by a `TargetRequirement`'s
filter fields (`excludeTypes`, `tappedFilter`, `subtypeFilter`, `colorFilter`,
`controller`, `spellTypeFilter`, `powerFilter`, …). That single logical
contract was, until now, implemented **independently at three server sites**:

1. **Offered set** — `getLegalTargets` (`gre/rules.ts`): which candidates the
   engine offers, per-candidate inline `if` per filter.
2. **Carry / lowering** — `pendingTargetFiltersFromRequirement` (`gre/rules.ts`):
   copies the resolved filters from the fat `TargetRequirement` onto the slim,
   Convex-serializable `PendingTarget` that survives the async choice + wire.
3. **Accepted set** — `selectTarget` (`game.ts`): the authoritative anti-spoof
   gate that validates the submitted target, again with its own per-filter `if`.

Nothing in the type system linked the three. The invariant "all three stay in
sync" was maintained only by author discipline, and it drifted: **Phelia,
Exuberant Shepherd** ("exile up to one **other** target **nonland** permanent")
had `excludeSource`→`excludeInstanceIds` and `excludeTypes: "Land"` honored by
`getLegalTargets` but silently dropped by the carry + `selectTarget`, so the
client offered — and the server accepted — Phelia exiling herself or a land
(the fix commit `78c0279c` patched permanents with a shared
`intrinsicPermanentTargetViolation`; an audit then found the SAME latent drift
for five more permanent filters — `combatRoleFilter`, `requireAbility`,
`excludeAbility`, `excludeColors`, `tappedFilter` — and for ~6 spell filters
still duplicated inline).

The always-on gates (`isProtectedFromColors`, `isGuardedAgainst` /
hexproof / shroud, `playerHasShroud`) are NOT part of this class — they are
not `TargetRequirement` fields, apply regardless of the requirement, and are
already shared functions called at each site.

## Decision

Replace the three hand-maintained per-filter implementations with **one
registry** that is the single authority for every requirement-declared target
filter, compile-bound to the requirement type so a new filter cannot be added
without wiring it everywhere.

1. **Filter Registry.** `convex/gre/targetFilters.ts` holds one
   `FilterDescriptor` per filter:

   ```ts
   interface FilterDescriptor<V> {
     lower(req: TargetRequirement): V | undefined;   // TargetRequirement field → PendingTarget field
     checks: Partial<Record<TargetKind, (candidate, value: V, ctx) => string | null>>;
   }
   ```

   - **`lower` once, `check` everywhere.** `lower` is the carry (resolves `X`,
     normalizes `string | string[]`); its output IS the `PendingTarget` field.
     `getLegalTargets` lowers first then runs `check` per candidate;
     `selectTarget` runs the SAME `check` against the already-lowered
     `PendingTarget`. Offered set == accepted set **by construction** — there is
     no second implementation to drift.
   - **Per-kind `checks` map + kind-eligibility rule.** Each check receives the
     correctly-typed candidate for its `TargetKind`
     (`permanent`→`CardInstanceState`, `spell`→`StackItem`,
     `player`→`PlayerState`, `card`→graveyard/hand card). Loop semantics: a
     filter whose value is `undefined` is skipped; a filter whose value is
     **present but whose kind is absent from `checks`** excludes that candidate
     (this is how `colorFilter`/`tappedFilter` exclude whole non-permanent
     kinds, matching current `getLegalTargets` behavior). A multi-kind filter
     (`controller`: permanent + player) supplies one check per kind.
   - **`check` owns the error message** (English, UI-text rule). `selectTarget`
     throws it; `getLegalTargets` treats non-null as "skip candidate".

2. **Compile-time forcing function.** The set of keys the registry MUST cover
   is derived by omission, not by hand:

   ```ts
   type StructuralKey = "type" | "count" | "min" | "max" | "equals"
     | "divideAsChosen" | "excludeSource" | "spellTargetsSelfSource";
   type FilterKey = keyof Omit<TargetRequirement, StructuralKey>;
   const REGISTRY = { … } satisfies Record<FilterKey, FilterDescriptor<unknown>>;
   ```

   Adding any field to `TargetRequirement` forces a conscious classification:
   either it is a filter (TypeScript demands a registry entry) or it is
   structural (must be added to `StructuralKey`). The code does not compile
   otherwise. This is the "cannot recur" guarantee the Phelia fix lacked.

3. **Full-kind coverage.** All target kinds (permanent, spell, player, card)
   route through the registry; the previously inline spell filters are extracted
   into `check` bodies. This closes the spell-flavored drift as well and is what
   makes "the accepted set can never diverge from the offered set" hold for
   every target, not just permanents.

4. **Server-authoritative; frontend stays permissive.** The registry unifies
   the three SERVER sites, where correctness lives. Frontend clickability keeps
   its documented over-permissive stance (show clickable, server rejects with
   the registry's message) — many checks read server-only state (effective P/T,
   live supertypes, continuous guards) not identically reproducible on the
   projected client state, and a permissive client can never *accept* an illegal
   target. `matchesTargetRequirement` / `matchesTargetController` /
   `matchesTargetExclusions` remain the client mirror.

5. **Strangler rollout.** Migrated in independent, green-at-each-step slices:
   (T1) registry scaffold + permanent entries, fold in the existing
   `intrinsicPermanentTargetViolation`, migrate the two permanent sites;
   (T2) spell entries + extract inline spell predicates, migrate the spell path;
   (T3) player + card entries, migrate those branches;
   (T4) **keystone** — flip `FilterKey` to `keyof Omit<…>` + `satisfies
   Record<FilterKey, …>`, which only compiles once every field has an entry,
   arming the forcing function. Each slice carries a parity test against
   current `getLegalTargets`/`selectTarget` behavior.

## Consequences

- A whole recurring bug class (offered≠accepted target divergence) becomes a
  compile error, not a runtime/UX bug caught by discipline.
- One place to read/change any target-filter's semantics; new filters pay the
  "one entry" cost once and are enforced at every site.
- `PendingTarget` stays plain serializable data (the registry is code; no
  closures on game state).
- The refactor touches the hottest engine path (targeting, ~thousands of
  tests). Mitigated by the strangler slices + parity tests + the full suite as
  the net.
- Residual, explicitly out of scope: frontend clickability parity (UX, seam #2),
  and the broader "view reducer drops a field" class (`buildTriggerStateView`,
  `projectPublicState`) documented in CLAUDE.md — a different class, not closed
  here.

## Alternatives considered

- **Membership recompute** (selectTarget calls `getLegalTargets`, checks
  `id ∈ offered`): kills the second copy outright, but must reconstruct the
  resolved requirement from the `PendingTarget` (X already chosen, dynamic
  `getTargetRequirement` already evaluated) and loses per-filter error messages.
  Rejected: reconstruction is a new divergence surface and worse UX.
- **Permanent-first registry only**: lower effort/risk now, but `FilterKey`
  could no longer be pure-`Omit` (spell*/player* would need a fragile hand-list),
  weakening the forcing function and leaving the verified spell drift open.
- **Everything in the registry** (protection/guard/shroud as synthetic
  always-on entries): dirties the key=field invariant and the exhaustiveness
  check for no gain — those gates are already shared and always-on. Kept
  separate.
